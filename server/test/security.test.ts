import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Encoder } from "@colyseus/schema";
import { getStateCallbacks } from "colyseus.js";
import {
  ARENA, ENTITY_FIELDS, MAX_PLAYERS, MSG, NAME_MAX_LENGTH, PLAYER_INFO_FIELDS, RACE, TICK_RATE, type Phase,
} from "@whosclaude/shared";
import { Crosshair, Entity, GameState, PlayerInfo } from "../src/GameState.js";
import type { GameRoom } from "../src/GameRoom.js";
import {
  advance, createRoom, internals, join, send, shoot, startMatch, syncState, useTestServer, waitFor,
} from "./helpers.js";
import { runCommands, sequenceArb } from "./fuzz.js";

const ctx = useTestServer();

describe("anti-fuite : rien ne distingue un joueur d'un PNJ avant la révélation", () => {
  it("les champs publics sont exactement ceux prévus", () => {
    expect(Object.keys(new Entity().toJSON()).sort()).toEqual([...ENTITY_FIELDS].sort());
    expect(Object.keys(new PlayerInfo().toJSON()).sort()).toEqual([...PLAYER_INFO_FIELDS].sort());
  });

  it("messages : un client espion ne reçoit rien sur les entités des autres joueurs", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b, spy]);
    await send(room, a, MSG.input, { dir: 0, aimX: 300, aimY: 300 });
    await send(room, b, MSG.input, { dir: 0, aimX: 500, aimY: 200 });
    advance(room, 2);
    await shoot(room, a, b.assigns[0].entityId);
    finishRound(room); // a franchit l'arrivée (2 survivants : le tir seul ne clôt pas la manche)
    await waitFor(() => spy.reveals.length === 1, "révélation reçue par l'espion");

    const revealIndex = spy.log.findIndex((m) => m.type === MSG.reveal);
    const beforeReveal = spy.log.slice(0, revealIndex);
    expect(new Set(beforeReveal.map((m) => m.type))).toEqual(new Set([MSG.assign, MSG.shot]));
    expect(spy.assigns).toHaveLength(1);

    const transcript = JSON.stringify(beforeReveal);
    for (const p of [a, b]) {
      expect(transcript).not.toContain(p.assigns[0].entityId);
      expect(transcript).not.toContain(p.assigns[0].crosshairId);
    }
  });

  it("flux d'état : les entités des joueurs ne changent que des champs qui changent aussi chez les PNJ", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];

    // L'espion enregistre, entité par entité, quels champs ont changé jusqu'à la révélation.
    const changed = new Map<string, Set<string>>();
    const $ = getStateCallbacks(spy.room);
    $(spy.room.state).entities.onAdd((entity: any, id: string) => {
      const fields = new Set<string>();
      changed.set(id, fields);
      for (const field of ENTITY_FIELDS) {
        $(entity).listen(field, (_value: unknown, previous: unknown) => {
          if (previous !== undefined && spy.reveals.length === 0) fields.add(field);
        });
      }
    });

    await startMatch(room, [a, b, spy]);
    await send(room, a, MSG.input, { dir: 0, aimX: 100, aimY: 100 });
    await send(room, b, MSG.input, { dir: 0, aimX: 800, aimY: 500 });
    advance(room, 3);
    await syncState(room, spy);
    await send(room, a, MSG.input, { dir: -1, aimX: 100, aimY: 100 });
    advance(room, 1);
    await syncState(room, spy);

    // Un PNJ et un joueur meurent : le champ `alive` change dans les deux camps.
    // Le PNJ visé est mis en pause le temps du tir, pour qu'il ne sorte pas du viseur.
    const { controllers } = internals(room);
    const npcId = [...room.state.entities.keys()].find((id) => controllers.get(id)!.playerId === null)!;
    (controllers.get(npcId) as unknown as { timer: number }).timer = 999;
    room.state.entities.get(npcId)!.dir = -1;
    await shoot(room, spy, npcId);
    await shoot(room, a, b.assigns[0].entityId);
    await syncState(room, spy);
    expect(room.state.entities.get(npcId)!.alive).toBe(false);

    await send(room, a, MSG.input, { dir: 0, aimX: 100, aimY: 100 });
    finishRound(room);
    await waitFor(() => spy.reveals.length === 1, "révélation");

    const playerIds = new Set(spy.reveals[0].players.map((p) => p.entityId));
    const npcFields = new Set<string>();
    for (const [id, fields] of changed) if (!playerIds.has(id)) fields.forEach((f) => npcFields.add(f));
    for (const id of playerIds) {
      for (const field of changed.get(id) ?? []) expect(npcFields, `champ « ${field} » propre aux joueurs`).toContain(field);
    }
    expect(npcFields).toContain("x");
  });

  it("état décodé : une entité de joueur a la même forme qu'un PNJ, et rien ne les relie aux joueurs", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, spy]);
    await waitFor(() => spy.room.state.entities.size === RACE.entityCount, "entités reçues");
    const seen = spy.room.state.entities as Map<string, { toJSON(): object }>;
    const shapes = new Set([...seen.values()].map((e) => Object.keys(e.toJSON()).sort().join(",")));
    expect(shapes.size).toBe(1);

    const ids = [...seen.keys()];
    expect(ids.every((id) => /^[a-z0-9]+$/.test(id))).toBe(true);
    const publicPlayers = JSON.stringify(spy.room.state.players);
    for (const id of ids) expect(publicPlayers).not.toContain(id);
  });
});

/** Avance jusqu'à la fin de manche (un joueur qui avance finit par franchir l'arrivée). */
function finishRound(room: GameRoom) {
  for (let i = 0; i < 30 * TICK_RATE && room.state.phase === "playing"; i++) advance(room, 1 / TICK_RATE);
  expect(room.state.phase).toBe("roundEnd");
}

// --- Fuzzing ---

describe("fuzzing des messages réseau", () => {
  it("depuis le salon : jamais d'erreur, et une bonne part des séquences atteint une manche", async () => {
    let runs = 0;
    let reachedPlaying = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(2, { leaves: false, launch: true }), async (commands) => {
        const room = await createRoom(ctx.colyseus);
        const players = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
        const phases = await runCommands(room, players, commands);
        runs++;
        if (phases.has("playing")) reachedPlaying++;
        await Promise.all(players.map((p) => p.room.leave()));
      }),
      { numRuns: 60 },
    );
    console.log(`fuzz salon : ${reachedPlaying}/${runs} séquences atteignent une manche`);
    // Garde-fou : si les générateurs dérivent, le fuzz ne testerait plus que le salon.
    // ~47 % en moyenne sur 60 runs : 25 % laisse plus de 3 écarts-types de marge.
    expect(reachedPlaying / runs).toBeGreaterThanOrEqual(0.25);
  });

  it("en pleine manche, à 3 joueurs : tirs, éliminations, départs, enchaînement des manches", async () => {
    const reached = new Map<Phase, number>();
    await fc.assert(
      // 1 manche : on atteint vite podium et salon ; 2 manches : on teste l'enchaînement.
      fc.asyncProperty(fc.constantFrom(1, 2), sequenceArb(3, { leaves: true, launch: false }), async (rounds, commands) => {
        const room = await createRoom(ctx.colyseus);
        const players = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
        await startMatch(room, players, rounds);
        const phases = await runCommands(room, players, commands);
        for (const phase of phases) reached.set(phase, (reached.get(phase) ?? 0) + 1);
        await Promise.all(players.map((p) => p.room.connection.isOpen && p.room.leave()));
      }),
      { numRuns: 60 },
    );
    console.log("fuzz manche, phases atteintes :", Object.fromEntries(reached));
    expect(reached.get("roundEnd") ?? 0).toBeGreaterThan(0);
    expect(reached.get("podium") ?? 0).toBeGreaterThan(0);
  });

  it("des options de connexion arbitraires donnent toujours un pseudo valide", async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (name) => {
        const room = await createRoom(ctx.colyseus);
        const clientRoom = await ctx.colyseus.connectTo(room, { name });
        await waitFor(() => room.state.players.has(clientRoom.sessionId), "arrivée");
        const info = room.state.players.get(clientRoom.sessionId)!;
        expect(info.name.length).toBeGreaterThan(0);
        expect(Array.from(info.name).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
        await clientRoom.leave();
      }),
      { numRuns: 30 },
    );
  });
});

describe("budget réseau", () => {
  /** État d'une manche pleine : toutes les entités, le maximum de joueurs. */
  function fullState() {
    const state = new GameState();
    for (let i = 0; i < RACE.entityCount; i++) {
      const e = new Entity();
      e.x = 60 + i;
      e.y = 30 * i;
      state.entities.set(`e${i.toString(36).padStart(7, "0")}`, e);
    }
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = new PlayerInfo();
      p.name = "x".repeat(NAME_MAX_LENGTH);
      p.color = i;
      state.players.set(`session${i}`, p);
      const c = new Crosshair();
      c.color = i;
      state.crosshairs.set(`c${i.toString(36).padStart(7, "0")}`, c);
    }
    return state;
  }

  it("l'état complet et un patch de tick restent petits", () => {
    const state = fullState();
    const encoder = new Encoder(state);
    const full = encoder.encodeAll().byteLength;
    encoder.discardChanges();

    // Tick typique : tout le monde bouge, tous les viseurs aussi.
    state.entities.forEach((e) => {
      e.x += 3.5;
      e.y += 1.25;
    });
    state.crosshairs.forEach((c) => {
      c.x += 10;
      c.y += 10;
    });
    const patch = encoder.encode().byteLength;

    console.log(`budget réseau : état complet ${full} o, patch de tick ${patch} o (${patch * TICK_RATE} o/s)`);
    expect(full).toBeLessThan(1500);
    expect(patch).toBeLessThan(500);
  });
});
