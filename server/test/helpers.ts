import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ClientRoom } from "colyseus.js";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import {
  ARENA, CROSSHAIR_COLORS, MSG, ROOM_NAME, ROUNDS, TICK_RATE,
  type AssignMessage, type RevealMessage, type ShotMessage,
} from "@whosclaude/shared";
import { createGameServer } from "../src/app.js";
import { GameRoom } from "../src/GameRoom.js";

const TEST_PORT = 2598;

/** Démarre un serveur de test par fichier ; le temps n'avance que via advance(). */
export function useTestServer() {
  const ctx = { colyseus: undefined as unknown as ColyseusTestServer };
  beforeAll(async () => {
    GameRoom.autoTick = false;
    ctx.colyseus = await boot(createGameServer(), TEST_PORT);
  });
  afterEach(async () => ctx.colyseus.cleanup());
  afterAll(async () => ctx.colyseus.shutdown());
  return ctx;
}

/** Client de test qui enregistre tout ce qu'il reçoit. */
export interface Player {
  room: ClientRoom;
  sessionId: string;
  assigns: AssignMessage[];
  shots: ShotMessage[];
  reveals: RevealMessage[];
  /** Tous les messages, dans l'ordre, avec leur type. */
  log: { type: string; message: unknown }[];
}

export async function join(colyseus: ColyseusTestServer, room: GameRoom, name = "Joueur"): Promise<Player> {
  const clientRoom = await colyseus.connectTo(room, { name });
  const player: Player = { room: clientRoom, sessionId: clientRoom.sessionId, assigns: [], shots: [], reveals: [], log: [] };
  const record = <T>(type: string, list: T[]) => (message: T) => {
    list.push(message);
    player.log.push({ type, message });
  };
  clientRoom.onMessage(MSG.assign, record(MSG.assign, player.assigns));
  clientRoom.onMessage(MSG.shot, record(MSG.shot, player.shots));
  clientRoom.onMessage(MSG.reveal, record(MSG.reveal, player.reveals));
  // Tout autre type de message est aussi journalisé : un message inattendu doit se voir.
  clientRoom.onMessage("*", (type, message) => player.log.push({ type: String(type), message }));
  return player;
}

export async function createRoom(colyseus: ColyseusTestServer) {
  return (await colyseus.createRoom(ROOM_NAME, {})) as unknown as GameRoom;
}

/** Laisse le temps aux messages de traverser le réseau local. */
export const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** Avance la simulation de `seconds`, tick par tick, en vérifiant les invariants. */
export function advance(room: GameRoom, seconds: number) {
  const dt = 1 / TICK_RATE;
  for (let t = 0; t < seconds; t += dt) {
    room.tick(dt);
    checkInvariants(room);
  }
}

/** Avance jusqu'à la phase voulue (ou échoue après maxSeconds). */
export function advanceUntil(room: GameRoom, phase: string, maxSeconds = 60) {
  const dt = 1 / TICK_RATE;
  for (let t = 0; t < maxSeconds && room.state.phase !== phase; t += dt) {
    room.tick(dt);
    checkInvariants(room);
  }
  expect(room.state.phase).toBe(phase);
}

/** Accès aux données privées de la room (jamais synchronisées). */
export function internals(room: GameRoom) {
  return room as unknown as {
    roundPlayers: Map<string, { entityId: string; crosshairId: string; alive: boolean; aimX: number; aimY: number }>;
    controllers: Map<string, { playerId: string | null }>;
  };
}

/** Lance un match : tout le monde prêt, l'hôte démarre, on va jusqu'à la manche jouable. */
export async function startMatch(room: GameRoom, players: Player[], rounds = 1) {
  const host = players.find((p) => p.sessionId === room.state.hostId)!;
  host.room.send(MSG.settings, { rounds });
  for (const p of players) if (p !== host) p.room.send(MSG.ready, { ready: true });
  await settle();
  host.room.send(MSG.startMatch);
  await settle();
  advanceUntil(room, "playing");
  await settle();
}

/** Ce qui doit toujours être vrai, quel que soit l'enchaînement d'actions. */
export function checkInvariants(room: GameRoom) {
  const { state } = room;
  const { roundPlayers, controllers } = internals(room);
  const ids = [...state.players.keys()];

  if (ids.length > 0) expect(ids).toContain(state.hostId);
  const colors = [...state.players.values()].map((p) => p.color);
  expect(new Set(colors).size).toBe(colors.length);
  for (const c of colors) expect(c).toBeLessThan(CROSSHAIR_COLORS.length);

  expect(state.totalRounds).toBeGreaterThanOrEqual(ROUNDS.min);
  expect(state.totalRounds).toBeLessThanOrEqual(ROUNDS.max);
  // Pendant un match, au plus un point par manche jouée (au salon, on affiche le match précédent).
  if (state.phase !== "lobby") {
    const scoreSum = [...state.players.values()].reduce((sum, p) => sum + p.score, 0);
    expect(scoreSum).toBeLessThanOrEqual(state.round);
  }

  for (const [sessionId, rp] of roundPlayers) {
    expect(state.players.has(sessionId)).toBe(true);
    expect(controllers.get(rp.entityId)?.playerId).toBe(sessionId);
    expect(rp.aimX).toBeGreaterThanOrEqual(0);
    expect(rp.aimX).toBeLessThanOrEqual(ARENA.width);
  }
  state.crosshairs.forEach((c) => {
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(ARENA.width);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(ARENA.height);
  });
}
