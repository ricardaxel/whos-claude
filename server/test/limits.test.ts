import { afterEach, describe, expect, it } from "vitest";
import { CLOSE_KICKED, MSG, ROOM_NAME } from "@whosclaude/shared";
import { GameRoom } from "../src/GameRoom.js";
import { addressKey, allowMatchmake, LIMITS } from "../src/limits.js";
import { createRoom, join, joinFrom, send, startMatch, useTestServer, waitFor } from "./helpers.js";

const ctx = useTestServer();
const defaults = { ...LIMITS };
afterEach(() => {
  Object.assign(LIMITS, defaults, { maxRooms: 10_000, maxRoomsPerIp: 10_000, matchmakeBurst: 10_000 });
});

/**
 * Requête HTTP brute de création, sans jamais ouvrir le WebSocket (ce que fait un script).
 * Colyseus répond toujours 200 : le refus est dans le corps (`code`, `error`).
 */
async function httpCreate(ip: string) {
  const response = await fetch(`http://localhost:${ctx.port}/matchmake/create/${ROOM_NAME}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: "{}",
  });
  return (await response.json()) as { room?: { roomId: string }; code?: number; error?: string };
}

describe("adresses comptées", () => {
  it("IPv4 telle quelle, IPv4 « mappée » ramenée à l'IPv4, IPv6 comptée par /64", () => {
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(addressKey("2001:0db8:00aa:00bb::9")).toBe("2001:db8:aa:bb::/64");
    expect(addressKey("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("débit de matchmaking : une rafale, puis une requête toutes les N secondes", () => {
    Object.assign(LIMITS, { matchmakeBurst: 3, matchmakeRefillSeconds: 2 });
    const ip = "198.51.100.1";
    expect([1, 2, 3, 4].map(() => allowMatchmake(ip, 0))).toEqual([true, true, true, false]);
    expect(allowMatchmake("198.51.100.2", 0)).toBe(true); // une autre adresse n'est pas gênée
    expect(allowMatchmake(ip, 1000)).toBe(false);
    expect(allowMatchmake(ip, 2000)).toBe(true);
  });
});

describe("plafonds de rooms", () => {
  it("des créations HTTP en rafale, sans WebSocket, sont freinées dès la requête", async () => {
    LIMITS.matchmakeBurst = 5;
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await httpCreate("192.0.2.66"));
    expect(results.filter((r) => r.room)).toHaveLength(5);
    expect(results.at(-1)).toMatchObject({ code: 429, error: expect.stringMatching(/Trop de demandes/) });
    expect(ctx.colyseus.getRoomById(results[0].room!.roomId)).toBeDefined();
    // Une autre adresse crée toujours sa partie.
    expect((await httpCreate("192.0.2.77")).room).toBeDefined();
  });

  it("une room créée par HTTP et jamais occupée ferme après la réservation de place", async () => {
    const { room } = await httpCreate("192.0.2.88");
    const created = ctx.colyseus.getRoomById(room!.roomId) as unknown as GameRoom;
    expect((created as unknown as { seatReservationTime: number }).seatReservationTime).toBe(GameRoom.seatReservationSeconds);
  });

  it("une même adresse n'ouvre pas plus de N parties à la fois", async () => {
    LIMITS.maxRoomsPerIp = 2;
    const first = await createRoom(ctx.colyseus);
    await join(ctx.colyseus, first);
    await join(ctx.colyseus, await createRoom(ctx.colyseus));

    const third = await createRoom(ctx.colyseus);
    await expect(join(ctx.colyseus, third)).rejects.toThrow(/Trop de parties créées/);

    // Rejoindre une partie existante n'est pas limité (une soirée sur le même wifi).
    await join(ctx.colyseus, first);
  });

  it("une partie fermée libère sa place", async () => {
    LIMITS.maxRoomsPerIp = 1;
    const first = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, first);
    await host.room.leave();
    await waitFor(() => !ctx.colyseus.getRoomById(first.roomId), "fermeture de la room");

    await join(ctx.colyseus, await createRoom(ctx.colyseus));
  });

  it("plafond global de parties ouvertes", async () => {
    LIMITS.maxRooms = 1;
    await join(ctx.colyseus, await createRoom(ctx.colyseus));
    await expect(createRoom(ctx.colyseus)).rejects.toThrow(/Trop de parties en cours/);
  });
});

describe("exclusion par l'hôte", () => {
  it("l'exclu part aussitôt, sans attente de reconnexion, et son adresse est refusée un temps", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await joinFrom(ctx, room, "203.0.113.1", "Hôte");
    const guest = await joinFrom(ctx, room, "203.0.113.2", "Invité");
    const closed = new Promise<number>((resolve) => guest.onLeave(resolve));

    host.send(MSG.kick, { playerId: guest.sessionId });
    expect(await closed).toBe(CLOSE_KICKED);
    await waitFor(() => !room.state.players.has(guest.sessionId), "retrait immédiat du joueur");

    await expect(joinFrom(ctx, room, "203.0.113.2")).rejects.toThrow(/exclu/);
    await joinFrom(ctx, room, "203.0.113.3"); // les autres adresses entrent toujours
  });

  it("un joueur sur le même wifi que l'hôte est exclu sans que l'adresse soit bannie", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room, "Hôte");
    const guest = await join(ctx.colyseus, room, "Invité");
    const closed = new Promise<number>((resolve) => guest.room.onLeave(resolve));

    await send(room, host, MSG.kick, { playerId: guest.sessionId });
    expect(await closed).toBe(CLOSE_KICKED);
    await join(ctx.colyseus, room, "Autre"); // même adresse que l'hôte : toujours admise
  });

  it("le bannissement expire", async () => {
    const before = GameRoom.banSeconds;
    GameRoom.banSeconds = 0;
    try {
      const room = await createRoom(ctx.colyseus);
      const host = await joinFrom(ctx, room, "203.0.113.5");
      const guest = await joinFrom(ctx, room, "203.0.113.4");
      host.send(MSG.kick, { playerId: guest.sessionId });
      await waitFor(() => room.state.players.size === 1, "exclusion");
      await joinFrom(ctx, room, "203.0.113.4");
    } finally {
      GameRoom.banSeconds = before;
    }
  });

  it("seul l'hôte exclut, jamais lui-même, et seulement dans le salon", async () => {
    const room = await createRoom(ctx.colyseus);
    const [host, guest] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];

    await send(room, guest, MSG.kick, { playerId: host.sessionId });
    await send(room, host, MSG.kick, { playerId: host.sessionId });
    await send(room, host, MSG.kick, { playerId: "inconnu" });
    await send(room, host, MSG.kick, null);
    expect(room.state.players.size).toBe(2);

    await startMatch(room, [host, guest]);
    await send(room, host, MSG.kick, { playerId: guest.sessionId });
    expect(room.state.players.size).toBe(2);
  });
});
