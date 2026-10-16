import { afterEach, describe, expect, it } from "vitest";
import { MSG } from "@whosclaude/shared";
import { GameRoom } from "../src/GameRoom.js";
import { advance, createRoom, internals, join, send, startMatch, useTestServer, waitFor, type Player } from "./helpers.js";

const ctx = useTestServer();
const DEFAULT_DELAY = GameRoom.reconnectionSeconds;
afterEach(() => (GameRoom.reconnectionSeconds = DEFAULT_DELAY));

/** Coupure brutale (écran verrouillé, wifi qui flanche) : la socket tombe sans « au revoir ». */
function dropConnection(player: Player) {
  const token = player.room.reconnectionToken;
  player.room.connection.close();
  return token;
}

/** Revient avec le jeton ; les messages reçus continuent d'alimenter le même joueur de test. */
async function reconnect(player: Player, token: string) {
  const room = await ctx.colyseus.sdk.reconnect(token);
  room.onMessage(MSG.assign, (m) => player.assigns.push(m));
  room.onMessage(MSG.reveal, (m) => player.reveals.push(m));
  room.onMessage("*", (type, message) => player.log.push({ type: String(type), message }));
  player.room = room as Player["room"];
  return room;
}

describe("reconnexion", () => {
  it("au salon : le joueur garde sa place, son pseudo, sa couleur et son statut d'hôte", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room, "Alice");
    await join(ctx.colyseus, room, "Bob");
    const before = { ...room.state.players.get(host.sessionId)!.toJSON() };

    const token = dropConnection(host);
    await waitFor(() => room.clients.length === 1, "déconnexion vue par le serveur");
    expect(room.state.hostId).toBe(host.sessionId); // pas de migration pendant l'attente
    expect(room.state.players.size).toBe(2);

    const back = await reconnect(host, token);
    expect(back.sessionId).toBe(host.sessionId);
    await waitFor(() => room.clients.length === 2, "retour vu par le serveur");
    expect(room.state.players.get(host.sessionId)!.toJSON()).toEqual(before);
    expect(room.state.hostId).toBe(host.sessionId);
  });

  it("en pleine manche : l'IA conduit l'entité pendant la coupure, puis le joueur la retrouve", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b], 1, "assassins");
    const entityId = b.assigns[0].entityId;
    await send(room, b, MSG.move, { dir: 0 });

    const token = dropConnection(b);
    await waitFor(() => room.clients.length === 1, "déconnexion vue par le serveur");
    const controller = internals(room).controllers.get(entityId) as unknown as { playerId: string; autopilot: boolean };
    expect(controller.playerId).toBe(b.sessionId); // le lien joueur est conservé
    expect(controller.autopilot).toBe(true);
    // L'IA a repris la main : l'entité ne file pas tout droit vers l'est jusqu'au mur.
    const dirs = new Set<number>();
    for (let i = 0; i < 200; i++) {
      advance(room, 0.05);
      dirs.add(room.state.entities.get(entityId)!.dir);
    }
    expect(dirs.size).toBeGreaterThan(1);

    await reconnect(b, token);
    await waitFor(() => b.assigns.length === 2, "attribution renvoyée");
    expect(b.assigns[1].entityId).toBe(entityId);
    expect(controller.autopilot).toBe(false);
    await send(room, b, MSG.move, { dir: 6 });
    advance(room, 0.1);
    expect(room.state.entities.get(entityId)!.dir).toBe(6); // c'est de nouveau le joueur qui dirige
  });

  it("personne d'autre ne reçoit de message pendant une coupure et un retour", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b, spy]);
    const seen = spy.log.length;

    const token = dropConnection(b);
    await waitFor(() => room.clients.length === 2, "déconnexion vue par le serveur");
    advance(room, 1);
    await reconnect(b, token);
    await waitFor(() => b.assigns.length === 2, "attribution renvoyée");
    advance(room, 1);
    expect(spy.log.slice(seen)).toEqual([]);
  });

  it("passé le délai, le départ devient définitif : l'entité revient aux PNJ", async () => {
    GameRoom.reconnectionSeconds = 0.2;
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const entityId = b.assigns[0].entityId;

    dropConnection(b);
    await waitFor(() => !room.state.players.has(b.sessionId), "départ définitif", 3000);
    expect(internals(room).controllers.get(entityId)!.playerId).toBeNull();
  });
});

describe("fin de manche après un départ", () => {
  it("assassins à deux : si l'un part, l'autre gagne au tick suivant", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b], 1, "assassins");
    await b.room.leave(); // départ volontaire : pas d'attente de reconnexion
    await waitFor(() => !room.state.players.has(b.sessionId), "départ traité");
    advance(room, 0.05);
    expect(room.state.phase).toBe("roundEnd");
    await waitFor(() => a.reveals.length === 1, "révélation");
    expect(a.reveals[0].winnerPlayerId).toBe(a.sessionId);
  });
});

describe("salon : être prêt engage sur les réglages", () => {
  it("un changement de mode ou de manches remet tout le monde « pas prêt »", async () => {
    const room = await createRoom(ctx.colyseus);
    const [host, guest] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await send(room, guest, MSG.ready, { ready: true });
    await send(room, host, MSG.settings, { rounds: room.state.totalRounds }); // rien ne change
    expect(room.state.players.get(guest.sessionId)!.ready).toBe(true);

    await send(room, host, MSG.settings, { modeId: "assassins" });
    expect(room.state.players.get(guest.sessionId)!.ready).toBe(false);

    await send(room, guest, MSG.ready, { ready: true });
    await send(room, host, MSG.settings, { rounds: 7 });
    expect(room.state.players.get(guest.sessionId)!.ready).toBe(false);
  });
});
