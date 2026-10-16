import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Encoder } from "@colyseus/schema";
import {
  ENTITY_FIELDS, MAX_PLAYERS, MSG, NAME_MAX_LENGTH, PLAYER_INFO_FIELDS, RACE, TICK_RATE,
} from "@whosclaude/shared";
import { Crosshair, Entity, GameState, PlayerInfo } from "../src/GameState.js";
import { advance, checkInvariants, createRoom, internals, join, settle, startMatch, useTestServer } from "./helpers.js";

const ctx = useTestServer();

describe("anti-fuite : rien ne distingue un joueur d'un PNJ avant la révélation", () => {
  it("les champs publics sont exactement ceux prévus", () => {
    expect(Object.keys(new Entity().toJSON()).sort()).toEqual([...ENTITY_FIELDS].sort());
    expect(Object.keys(new PlayerInfo().toJSON()).sort()).toEqual([...PLAYER_INFO_FIELDS].sort());
  });

  it("un client espion ne reçoit rien sur les entités des autres joueurs", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b, spy]);
    a.room.send(MSG.input, { dir: 0, aimX: 300, aimY: 300 });
    b.room.send(MSG.input, { dir: 0, aimX: 500, aimY: 200 });
    await settle();
    advance(room, 2);
    const target = room.state.entities.get(b.assigns[0].entityId)!;
    a.room.send(MSG.fire, { aimX: target.x, aimY: target.y }); // déclenche un message "shot"
    await settle();
    advance(room, 1);
    await settle(100);

    const revealIndex = spy.log.findIndex((m) => m.type === MSG.reveal);
    const beforeReveal = spy.log.slice(0, revealIndex === -1 ? undefined : revealIndex);
    expect(new Set(beforeReveal.map((m) => m.type))).toEqual(new Set([MSG.assign, MSG.shot]));
    expect(spy.assigns).toHaveLength(1);

    const othersEntityIds = [a, b].map((p) => p.assigns[0].entityId);
    const othersCrosshairIds = [a, b].map((p) => p.assigns[0].crosshairId);
    const transcript = JSON.stringify(beforeReveal);
    for (const id of [...othersEntityIds, ...othersCrosshairIds]) expect(transcript).not.toContain(id);
  });

  it("dans l'état décodé côté client, une entité de joueur a la même forme qu'un PNJ", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, spy] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, spy]);
    await settle(100);
    const seen = spy.room.state.entities as Map<string, { toJSON(): object }>;
    const shapes = new Set([...seen.values()].map((e) => Object.keys(e.toJSON()).sort().join(",")));
    expect(seen.size).toBe(RACE.entityCount);
    expect(shapes.size).toBe(1);

    // Les identifiants ont tous le même format : rien ne permet de trier joueurs et PNJ.
    const ids = [...seen.keys()];
    expect(ids.every((id) => /^[a-z0-9]+$/.test(id))).toBe(true);
    // Aucune donnée « joueur » n'est rattachée à une entité dans la liste publique.
    const publicPlayers = JSON.stringify(spy.room.state.players);
    for (const id of ids) expect(publicPlayers).not.toContain(id);
  });
});

describe("fuzzing des messages réseau", () => {
  const types = [MSG.input, MSG.fire, MSG.settings, MSG.ready, MSG.startMatch, "inconnu"];

  it("des messages arbitraires ne cassent ni la room ni ses invariants", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            from: fc.nat(1),
            type: fc.constantFrom(...types),
            payload: fc.oneof(
              fc.anything(),
              fc.record({ dir: fc.anything(), aimX: fc.double(), aimY: fc.double() }),
              fc.record({ rounds: fc.oneof(fc.integer(), fc.double()), modeId: fc.string() }),
            ),
            ticks: fc.nat(10),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        async (commands) => {
          const room = await createRoom(ctx.colyseus);
          const players = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
          for (const { from, type, payload, ticks } of commands) {
            players[from].room.send(type, payload);
            await settle(5);
            advance(room, ticks / TICK_RATE);
          }
          await settle();
          checkInvariants(room);
          expect(room.clients.length).toBe(2); // personne n'a été déconnecté par une erreur
          await Promise.all(players.map((p) => p.room.leave()));
        },
      ),
      { numRuns: 25 },
    );
  });

  it("des options de connexion arbitraires donnent toujours un pseudo valide", async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (name) => {
        const room = await createRoom(ctx.colyseus);
        const clientRoom = await ctx.colyseus.connectTo(room, { name });
        await settle(5);
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

void internals;
