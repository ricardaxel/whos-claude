import { describe, expect, it } from "vitest";
import { MSG, RACE, ROUNDS } from "@whosclaude/shared";
import {
  advance, advanceUntil, createRoom, internals, join, settle, startMatch, useTestServer,
} from "./helpers.js";

const ctx = useTestServer();

describe("salon", () => {
  it("le premier arrivé est l'hôte ; pseudos nettoyés ; couleurs uniques", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room, "  Alice‮ ");
    const b = await join(ctx.colyseus, room, "");
    await settle();
    expect(room.state.hostId).toBe(a.sessionId);
    expect(room.state.players.get(a.sessionId)!.name).toBe("Alice");
    expect(room.state.players.get(b.sessionId)!.name).toBe("Joueur 2");
    expect(room.roomId).toMatch(/^[A-Z]{4}$/);
  });

  it("seul l'hôte règle le match, et les valeurs sont bornées", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    const guest = await join(ctx.colyseus, room);
    guest.room.send(MSG.settings, { rounds: 7 });
    await settle();
    expect(room.state.totalRounds).toBe(ROUNDS.default);

    for (const [rounds, expected] of [[99, ROUNDS.max], [0, ROUNDS.min], [2.5, ROUNDS.min], [4, 4]] as const) {
      host.room.send(MSG.settings, { rounds });
      await settle();
      expect(room.state.totalRounds).toBe(expected);
    }
    host.room.send(MSG.settings, { modeId: "__proto__" });
    await settle();
    expect(room.state.modeId).toBe("race");
  });

  it("le match ne démarre que si les autres sont prêts, et seulement par l'hôte", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    const guest = await join(ctx.colyseus, room);
    host.room.send(MSG.startMatch);
    await settle();
    expect(room.state.phase).toBe("lobby");

    guest.room.send(MSG.ready, { ready: true });
    guest.room.send(MSG.startMatch);
    await settle();
    expect(room.state.phase).toBe("lobby");

    host.room.send(MSG.startMatch);
    await settle();
    expect(room.state.phase).toBe("countdown");
  });

  it("l'hôte qui part passe la main au plus ancien", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    const b = await join(ctx.colyseus, room);
    await join(ctx.colyseus, room);
    await a.room.leave();
    await settle();
    expect(room.state.hostId).toBe(b.sessionId);
  });

  it("personne ne rejoint en plein match", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    await startMatch(room, [host]);
    await expect(join(ctx.colyseus, room)).rejects.toThrow();
  });
});

describe("manche", () => {
  it("chacun ne reçoit que sa propre attribution", async () => {
    const room = await createRoom(ctx.colyseus);
    const players = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, players);
    const { roundPlayers } = internals(room);

    expect(room.state.entities.size).toBe(RACE.entityCount);
    expect(room.state.crosshairs.size).toBe(players.length);
    for (const p of players) {
      expect(p.assigns).toHaveLength(1);
      expect(p.assigns[0]).toEqual({
        entityId: roundPlayers.get(p.sessionId)!.entityId,
        crosshairId: roundPlayers.get(p.sessionId)!.crosshairId,
      });
    }
    const entityIds = players.map((p) => p.assigns[0].entityId);
    expect(new Set(entityIds).size).toBe(players.length);
  });

  it("une seule balle, et on ne peut pas se tirer dessus", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const self = room.state.entities.get(a.assigns[0].entityId)!;

    a.room.send(MSG.fire, { aimX: self.x, aimY: self.y });
    await settle();
    advance(room, 2);
    await settle();
    expect(self.alive).toBe(true);
    expect(room.state.crosshairs.get(a.assigns[0].crosshairId)!.loaded).toBe(false);

    const other = room.state.entities.get(b.assigns[0].entityId)!;
    a.room.send(MSG.fire, { aimX: other.x, aimY: other.y });
    await settle();
    advance(room, 2);
    expect(other.alive).toBe(true);
  });

  it("tuer le dernier adversaire fait gagner la manche", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b], 2);
    const target = room.state.entities.get(b.assigns[0].entityId)!;

    a.room.send(MSG.fire, { aimX: target.x, aimY: target.y });
    await settle();
    advanceUntil(room, "roundEnd", 3);
    await settle();

    expect(target.alive).toBe(false);
    expect(room.state.crosshairs.has(b.assigns[0].crosshairId)).toBe(false);
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
    expect(a.shots.at(-1)!.victim).toBe("player");
    expect(a.reveals.at(-1)!.winnerPlayerId).toBe(a.sessionId);
  });

  it("tirer sur un PNJ le tue sans finir la manche", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const { controllers } = internals(room);
    // Un PNJ à l'arrêt : on fige l'IA en restant en phase de jeu sans avancer le temps.
    const [npcId, npc] = [...room.state.entities.entries()].find(([id]) => controllers.get(id)!.playerId === null)!;

    a.room.send(MSG.fire, { aimX: npc.x, aimY: npc.y });
    await settle();
    // Le viseur part du centre : moins d'une seconde de trajet, pendant laquelle le PNJ peut bouger.
    // On le ramène sous le viseur à chaque tick pour isoler la règle testée.
    for (let i = 0; i < 40 && npc.alive; i++) {
      const aim = internals(room).roundPlayers.get(a.sessionId)!;
      npc.x = aim.aimX;
      npc.y = aim.aimY;
      room.tick(0.05);
    }
    await settle();
    expect(room.state.entities.get(npcId)!.alive).toBe(false);
    expect(a.shots.at(-1)!.victim).toBe("npc");
    expect(room.state.phase).toBe("playing");
  });

  it("franchir l'arrivée fait gagner", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    await startMatch(room, [a]);
    a.room.send(MSG.input, { dir: 0, aimX: 0, aimY: 0 });
    await settle();
    advanceUntil(room, "roundEnd", 20);
    await settle();
    expect(room.state.entities.get(a.assigns[0].entityId)!.x).toBeGreaterThanOrEqual(RACE.finishX);
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
  });

  it("un joueur qui part en pleine manche rend son entité aux PNJ", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const entityId = b.assigns[0].entityId;
    await b.room.leave();
    await settle();
    expect(internals(room).controllers.get(entityId)!.playerId).toBeNull();
    expect(room.state.crosshairs.size).toBe(1);
    const before = room.state.entities.get(entityId)!.x;
    advance(room, 6);
    expect(room.state.entities.get(entityId)!.x).toBeGreaterThan(before); // l'IA a repris la main
  });
});

describe("match", () => {
  it("N manches, podium, puis retour au salon", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b], 2);

    for (let round = 1; round <= 2; round++) {
      expect(room.state.round).toBe(round);
      const target = room.state.entities.get(b.assigns.at(-1)!.entityId)!;
      a.room.send(MSG.fire, { aimX: target.x, aimY: target.y });
      await settle();
      advanceUntil(room, "roundEnd", 3);
      advanceUntil(room, round < 2 ? "playing" : "podium", 15);
      await settle();
    }

    expect(room.state.entities.size).toBe(0);
    expect(room.state.players.get(a.sessionId)!.score).toBe(2);
    advanceUntil(room, "lobby", 15);
    expect([...room.state.players.values()].every((p) => !p.ready)).toBe(true);
    expect(room.state.round).toBe(0);
    expect(b.assigns).toHaveLength(2);
    expect(new Set(b.assigns.map((x) => x.entityId)).size).toBe(2); // nouveaux ids à chaque manche
  });
});
