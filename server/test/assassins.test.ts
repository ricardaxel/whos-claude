import { describe, expect, it } from "vitest";
import { ARENA, ASSASSINS, ENTITY_RADIUS, IDLE, MSG, SPEED, TICK_RATE, type Dir } from "@whosclaude/shared";
import { Entity, GameState } from "../src/GameState.js";
import { AssassinsMode } from "../src/modes/AssassinsMode.js";
import {
  advance, advanceUntil, createRoom, internals, join, type Player, send, stab, startMatch, useTestServer, waitFor,
} from "./helpers.js";
import type { GameRoom } from "../src/GameRoom.js";

describe("AssassinsMode", () => {
  const mode = new AssassinsMode();

  it("répartit tout le monde dans la pièce, sans chevauchement", () => {
    const spawns = mode.spawnPositions();
    expect(spawns).toHaveLength(ASSASSINS.entityCount);
    for (const p of spawns) {
      expect(p.x).toBeGreaterThanOrEqual(ENTITY_RADIUS);
      expect(p.x).toBeLessThanOrEqual(ARENA.width - ENTITY_RADIUS);
      expect(p.y).toBeGreaterThanOrEqual(ENTITY_RADIUS);
      expect(p.y).toBeLessThanOrEqual(ARENA.height - ENTITY_RADIUS);
    }
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        expect(Math.hypot(spawns[i].x - spawns[j].x, spawns[i].y - spawns[j].y)).toBeGreaterThan(2 * ENTITY_RADIUS);
      }
    }
  });

  it("toutes les directions sont permises, pas de sprint, pas de viseur, un couteau", () => {
    for (let dir = -1; dir <= 7; dir++) expect(mode.mapInput(dir as Dir)).toBe(dir);
    expect(mode).toMatchObject({ sprintMultiplier: 1, crosshairs: false, knife: true });
    expect(mode.hasWon()).toBe(false);
  });

  it("les PNJ errent dans plusieurs directions, avec des pauses", () => {
    const entity = new Entity();
    entity.x = ARENA.width / 2;
    entity.y = ARENA.height / 2;
    const brain = { timer: 0 };
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      mode.thinkNpc(entity, brain, 0.05);
      seen.add(entity.dir);
    }
    expect(seen.has(IDLE)).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("la lumière apparaît en début de manche et erre dans la pièce sans dépasser sa vitesse", () => {
    const state = new GameState();
    mode.startRound(state);
    expect(state.light.radius).toBe(ASSASSINS.light.radius);
    const dt = 1 / TICK_RATE;
    for (let i = 0; i < 2000; i++) {
      const before = { x: state.light.x, y: state.light.y };
      mode.updateWorld(state, dt);
      expect(Math.hypot(state.light.x - before.x, state.light.y - before.y)).toBeLessThanOrEqual(ASSASSINS.light.speed * dt + 1e-6);
      expect(state.light.x).toBeGreaterThanOrEqual(0);
      expect(state.light.x).toBeLessThanOrEqual(ARENA.width);
      expect(state.light.y).toBeGreaterThanOrEqual(0);
      expect(state.light.y).toBeLessThanOrEqual(ARENA.height);
    }
  });
});

describe("manche d'assassins", () => {
  const ctx = useTestServer();

  async function setup(count = 2) {
    const room = await createRoom(ctx.colyseus);
    const players = [];
    for (let i = 0; i < count; i++) players.push(await join(ctx.colyseus, room));
    await startMatch(room, players, 1, "assassins");
    return { room, players };
  }

  it("pas de viseur, une lumière et un minuteur", async () => {
    const { room, players } = await setup();
    expect(room.state.crosshairs.size).toBe(0);
    expect(players[0].assigns[0].crosshairId).toBeNull();
    expect(room.state.light.radius).toBe(ASSASSINS.light.radius);
    expect(room.state.timeLeft).toBe(ASSASSINS.roundSeconds);
    advance(room, 1.5);
    expect(room.state.timeLeft).toBe(ASSASSINS.roundSeconds - 1);
  });

  it("on se déplace dans les 8 directions, à vitesse normale même en demandant un sprint", async () => {
    const { room, players } = await setup();
    const entity = room.state.entities.get(players[0].assigns[0].entityId)!;
    const start = { x: entity.x, y: entity.y };
    await send(room, players[0], MSG.move, { dir: 1, sprint: true }); // sud-est
    advance(room, 1);
    expect(entity.x).toBeGreaterThan(start.x);
    expect(entity.y).toBeGreaterThan(start.y);
    expect(Math.hypot(entity.x - start.x, entity.y - start.y)).toBeCloseTo(SPEED, 0);
  });

  it("le couteau tue la cible la plus proche à portée, et tout le monde voit le geste", async () => {
    const { room, players } = await setup(3);
    const [a, b, c] = players;
    const victimId = b.assigns[0].entityId;
    await stab(room, a, victimId);

    expect(room.state.entities.get(victimId)!.alive).toBe(false);
    for (const p of players) await waitFor(() => p.knives.length === 1, "geste vu par chacun");
    expect(c.knives[0]).toEqual({ entityId: a.assigns[0].entityId, victim: "player" });
    expect(room.state.phase).toBe("playing"); // il reste deux joueurs en vie
  });

  it("un coup dans le vide ne tue personne ; le couteau a un temps de recharge", async () => {
    const { room, players } = await setup();
    const [a] = players;
    const self = room.state.entities.get(a.assigns[0].entityId)!;
    // Personne à portée : on éloigne tout le monde.
    room.state.entities.forEach((e, id) => {
      if (id !== a.assigns[0].entityId) e.x = self.x + 200 > ARENA.width ? self.x - 200 : self.x + 200;
    });
    await send(room, a, MSG.stab);
    await waitFor(() => a.knives.length === 1, "geste");
    expect(a.knives[0].victim).toBeNull();

    // Recharge : un second coup immédiat est ignoré, puis accepté après le délai.
    await send(room, a, MSG.stab);
    advance(room, 0.1);
    expect(a.knives).toHaveLength(1);
    advance(room, ASSASSINS.knifeCooldown);
    await send(room, a, MSG.stab);
    await waitFor(() => a.knives.length === 2, "second geste");
  });

  it("on ne se poignarde pas soi-même, et les tirs n'existent pas dans ce mode", async () => {
    const { room, players } = await setup();
    const [a] = players;
    const self = room.state.entities.get(a.assigns[0].entityId)!;
    room.state.entities.forEach((e, id) => {
      if (id !== a.assigns[0].entityId) e.x = self.x + 200 > ARENA.width ? self.x - 200 : self.x + 200;
    });
    await send(room, a, MSG.stab);
    await waitFor(() => a.knives.length === 1, "geste");
    expect(self.alive).toBe(true);

    await send(room, a, MSG.fire, { aimX: self.x, aimY: self.y });
    advance(room, 2);
    expect(a.shots).toHaveLength(0);
  });

  it("le dernier survivant gagne", async () => {
    const { room, players } = await setup();
    const [a, b] = players;
    await stab(room, a, b.assigns[0].entityId);
    advance(room, 1 / TICK_RATE); // la fin de manche est constatée au tick suivant
    expect(room.state.phase).toBe("roundEnd");
    await waitFor(() => a.reveals.length === 1, "révélation");
    expect(a.reveals[0].winnerPlayerId).toBe(a.sessionId);
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
  });

  /** Fin au temps : renvoie le message de révélation reçu par `watcher`. */
  async function timeUp(room: GameRoom, watcher: Player) {
    advanceUntil(room, "roundEnd", ASSASSINS.roundSeconds + 1);
    await waitFor(() => watcher.reveals.length === 1, "révélation");
    return watcher.reveals[0];
  }
  const entityOf = (p: Player) => p.assigns.at(-1)!.entityId;

  it("à la fin du temps, sans élimination, personne ne gagne", async () => {
    const { room, players } = await setup();
    const reveal = await timeUp(room, players[0]);
    expect(reveal).toMatchObject({ winnerPlayerId: null, timeUp: true });
    expect([...room.state.players.values()].every((p) => p.score === 0)).toBe(true);
  });

  it("à la fin du temps, le joueur qui a éliminé le plus de joueurs gagne ; les PNJ ne comptent pas", async () => {
    const { room, players: [a, b, c, d] } = await setup(4);
    await stab(room, a, entityOf(b)); // a : 1 joueur
    const npcs = [...room.state.entities.keys()].filter((id) => ![a, b, c, d].some((p) => entityOf(p) === id));
    await stab(room, c, npcs[0]); // c : 2 PNJ, qui ne comptent pas
    advance(room, ASSASSINS.knifeCooldown);
    await stab(room, c, npcs[1]);

    const reveal = await timeUp(room, d);
    expect(reveal).toMatchObject({ winnerPlayerId: a.sessionId, winnerEntityId: entityOf(a), timeUp: true });
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
  });

  it("le meilleur tueur gagne même s'il est mort entre-temps", async () => {
    const { room, players: [a, b, c, d, e] } = await setup(5);
    await stab(room, a, entityOf(b));
    advance(room, ASSASSINS.knifeCooldown);
    await stab(room, a, entityOf(c)); // a : 2
    await stab(room, d, entityOf(a)); // d : 1, a est mort

    const reveal = await timeUp(room, e);
    expect(reveal.winnerPlayerId).toBe(a.sessionId);
  });

  it("à égalité d'éliminations, personne ne gagne", async () => {
    const { room, players: [a, b, c, d] } = await setup(4);
    await stab(room, a, entityOf(b));
    await stab(room, c, entityOf(d));

    const reveal = await timeUp(room, a);
    expect(reveal).toMatchObject({ winnerPlayerId: null, winnerEntityId: null, timeUp: true });
  });

  it("le dernier survivant gagne sans attendre la fin du temps", async () => {
    const { room, players: [a, b] } = await setup();
    await stab(room, a, entityOf(b));
    advance(room, 1 / TICK_RATE);
    expect(room.state.phase).toBe("roundEnd");
    await waitFor(() => a.reveals.length === 1, "révélation");
    expect(a.reveals[0]).toMatchObject({ winnerPlayerId: a.sessionId, timeUp: false });
  });

  it("la course garde sa pièce éclairée et n'a pas de minuteur", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    await startMatch(room, [a], 1, "race");
    expect(room.state.light.radius).toBe(0);
    expect(room.state.timeLeft).toBe(0);
    expect(internals(room).roundPlayers.get(a.sessionId)!.crosshairId).not.toBeNull();
  });
});
