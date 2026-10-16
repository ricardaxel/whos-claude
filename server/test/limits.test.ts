import { afterEach, describe, expect, it } from "vitest";
import { CLOSE_KICKED, MSG } from "@whosclaude/shared";
import { LIMITS } from "../src/limits.js";
import { createRoom, join, send, startMatch, useTestServer, waitFor } from "./helpers.js";

const ctx = useTestServer();
const defaults = { ...LIMITS };
afterEach(() => Object.assign(LIMITS, defaults));

describe("plafonds de rooms", () => {
  it("une même adresse ne crée pas plus de N parties à la fois", async () => {
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
  it("l'exclu part aussitôt, sans attente de reconnexion, et ne peut plus revenir", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room, "Hôte");
    const guest = await join(ctx.colyseus, room, "Invité");
    const closed = new Promise<number>((resolve) => guest.room.onLeave(resolve));

    await send(room, host, MSG.kick, { playerId: guest.sessionId });
    expect(await closed).toBe(CLOSE_KICKED);
    await waitFor(() => !room.state.players.has(guest.sessionId), "retrait immédiat du joueur");

    // Les tests viennent tous de la même adresse : elle est désormais refusée dans cette room.
    await expect(join(ctx.colyseus, room)).rejects.toThrow(/exclu/);
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
