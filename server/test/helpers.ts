import { createServer, type AddressInfo } from "node:net";
// Importer le paquet charge aussi ses extensions de Room (waitForMessage…).
import { ColyseusTestServer } from "@colyseus/testing";
import type { Server } from "colyseus";
import type { Room as ClientRoom } from "colyseus.js";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import {
  ARENA, CROSSHAIR_COLORS, ENTITY_RADIUS, MSG, PLAYFIELD, ROOM_NAME, ROUNDS, TICK_RATE,
  type AssignMessage, type KnifeMessage, type ModeId, type RevealMessage, type ShotMessage,
} from "@whosclaude/shared";
import { createGameServer } from "../src/app.js";
import { GameRoom } from "../src/GameRoom.js";

/** Port libre choisi par le système : deux suites lancées en parallèle ne se gênent jamais. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Démarre un serveur de test par fichier ; le temps n'avance que via advance().
 * `configure` permet d'enregistrer des rooms de test supplémentaires.
 * Pas de boot() : avec une instance de Server, il ignore le port et prend 2568 en dur.
 */
export function useTestServer(configure?: (server: Server) => void) {
  const ctx = { colyseus: undefined as unknown as ColyseusTestServer, port: 0 };
  beforeAll(async () => {
    GameRoom.autoTick = false;
    const server = createGameServer();
    configure?.(server);
    ctx.port = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : await freePort();
    await server.listen(ctx.port);
    ctx.colyseus = new ColyseusTestServer(server);
  });
  afterEach(async () => ctx.colyseus.cleanup());
  afterAll(async () => ctx.colyseus.shutdown());
  return ctx;
}

// --- Attentes déterministes (jamais de setTimeout « au cas où ») ---

/** Attend qu'une condition devienne vraie ; échoue avec `what` au bout de `timeout` ms. */
export async function waitFor(condition: () => boolean, what = "condition", timeout = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`waitFor : ${what} toujours faux après ${timeout} ms`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Envoie un message et attend que le serveur l'ait traité (ou ignoré).
 * waitForMessage(type) encapsule le gestionnaire de ce type et ne résout qu'après lui.
 * (waitForNextMessage ne convient pas : son setTimeout résout l'attente *suivante*
 * quand on enchaîne les envois.)
 */
export async function send(room: GameRoom, player: Player, type: string, payload?: unknown) {
  const handled = room.waitForMessage(type);
  player.room.send(type, payload);
  await handled;
}

/**
 * Attend que l'état des entités vu par ce client rejoigne celui du serveur.
 * Les patches partent sur un intervalle réel (50 ms) alors que les messages partent
 * tout de suite : sans cette attente, un message peut doubler les patches qui le précèdent.
 * (clientRoom.waitForNextPatch ne se résout pas avec cette version de colyseus.js.)
 */
export async function syncState(room: GameRoom, player: Player) {
  await waitFor(() => {
    const seen = player.room.state.entities as Map<string, { x: number; y: number; alive: boolean }>;
    if (seen.size !== room.state.entities.size) return false;
    for (const [id, e] of room.state.entities) {
      const c = seen.get(id);
      // Positions encodées en float32 : comparaison à une tolérance près.
      if (!c || Math.abs(c.x - e.x) > 1e-3 || Math.abs(c.y - e.y) > 1e-3 || c.alive !== e.alive) return false;
    }
    return true;
  }, "état client synchronisé");
}

// --- Clients de test ---

/** Client de test qui enregistre tout ce qu'il reçoit. */
export interface Player {
  room: ClientRoom;
  sessionId: string;
  assigns: AssignMessage[];
  shots: ShotMessage[];
  reveals: RevealMessage[];
  knives: KnifeMessage[];
  /** Tous les messages, dans l'ordre, avec leur type. */
  log: { type: string; message: unknown }[];
}

export async function join(colyseus: ColyseusTestServer, room: GameRoom, name = "Joueur"): Promise<Player> {
  const clientRoom = await colyseus.connectTo(room, { name });
  const player: Player = { room: clientRoom, sessionId: clientRoom.sessionId, assigns: [], shots: [], reveals: [], knives: [], log: [] };
  const record = <T>(type: string, list: T[]) => (message: T) => {
    list.push(message);
    player.log.push({ type, message });
  };
  clientRoom.onMessage(MSG.assign, record(MSG.assign, player.assigns));
  clientRoom.onMessage(MSG.shot, record(MSG.shot, player.shots));
  clientRoom.onMessage(MSG.reveal, record(MSG.reveal, player.reveals));
  clientRoom.onMessage(MSG.knife, record(MSG.knife, player.knives));
  // Tout autre type de message est aussi journalisé : un message inattendu doit se voir.
  clientRoom.onMessage("*", (type, message) => player.log.push({ type: String(type), message }));
  return player;
}

export async function createRoom(colyseus: ColyseusTestServer, roomName = ROOM_NAME) {
  return (await colyseus.createRoom(roomName, {})) as unknown as GameRoom;
}

// --- Temps et match ---

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
    roundPlayers: Map<string, { entityId: string; crosshairId: string | null; alive: boolean; aimX: number; aimY: number }>;
    controllers: Map<string, { playerId: string | null }>;
  };
}

/** Lance un match : tout le monde prêt, l'hôte démarre, on va jusqu'à la manche jouable. */
export async function startMatch(room: GameRoom, players: Player[], rounds = 1, modeId: ModeId = "race") {
  const host = players.find((p) => p.sessionId === room.state.hostId)!;
  await send(room, host, MSG.settings, { rounds, modeId });
  for (const p of players) if (p !== host) await send(room, p, MSG.ready, { ready: true });
  await send(room, host, MSG.startMatch);
  advanceUntil(room, "playing");
  await waitFor(() => players.every((p) => p.assigns.length === room.state.round), "attribution reçue par chaque joueur");
}

/** Tire sur une entité et laisse le viseur l'atteindre. */
export async function shoot(room: GameRoom, shooter: Player, entityId: string) {
  const target = room.state.entities.get(entityId)!;
  const shotsBefore = shooter.shots.length;
  await send(room, shooter, MSG.fire, { aimX: target.x, aimY: target.y });
  for (let i = 0; i < 2 * TICK_RATE && shooter.shots.length === shotsBefore; i++) {
    advance(room, 1 / TICK_RATE);
    await new Promise((resolve) => setImmediate(resolve));
  }
  await waitFor(() => shooter.shots.length > shotsBefore, "message de tir");
}

/**
 * Coup de couteau sur une entité : l'attaquant est d'abord placé juste à côté de sa cible
 * (manipulation directe de l'état serveur, pour isoler la règle testée du déplacement).
 */
export async function stab(room: GameRoom, attacker: Player, targetEntityId: string) {
  const self = room.state.entities.get(internals(room).roundPlayers.get(attacker.sessionId)!.entityId)!;
  const target = room.state.entities.get(targetEntityId)!;
  // Juste à côté de la cible, du côté où il y a de la place (jamais dans un mur).
  const side = target.x + 2 <= PLAYFIELD.right - ENTITY_RADIUS ? 1 : -1;
  self.x = target.x + side * 2; // collé à la cible : c'est forcément elle la plus proche
  self.y = target.y;
  const before = attacker.knives.length;
  await send(room, attacker, MSG.stab);
  await waitFor(() => attacker.knives.length > before, "message de couteau");
}

/** Élimine une entité avec l'arme du mode en cours (balle ou couteau). */
export async function eliminate(room: GameRoom, killer: Player, targetEntityId: string) {
  if (room.state.modeId === "assassins") await stab(room, killer, targetEntityId);
  else await shoot(room, killer, targetEntityId);
}

/** Ce qui doit toujours être vrai, quel que soit l'enchaînement d'actions. */
export function checkInvariants(room: GameRoom) {
  const { state } = room;
  const { roundPlayers, controllers } = internals(room);
  const ids = [...state.players.keys()];

  if (ids.length > 0) expect(ids).toContain(state.hostId);
  const players = [...state.players.values()];
  expect(new Set(players.map((p) => p.color)).size).toBe(players.length);
  expect(new Set(players.map((p) => p.name.normalize("NFKC").toLowerCase())).size).toBe(players.length);
  for (const p of players) expect(p.color).toBeLessThan(CROSSHAIR_COLORS.length);

  expect(state.totalRounds).toBeGreaterThanOrEqual(ROUNDS.min);
  expect(state.totalRounds).toBeLessThanOrEqual(ROUNDS.max);
  // Pendant un match, au plus un point par manche jouée (au salon, on affiche le match précédent).
  if (state.phase !== "lobby") {
    const scoreSum = players.reduce((sum, p) => sum + p.score, 0);
    expect(scoreSum).toBeLessThanOrEqual(state.round);
  }

  for (const [sessionId, rp] of roundPlayers) {
    expect(state.players.has(sessionId)).toBe(true);
    expect(controllers.get(rp.entityId)?.playerId).toBe(sessionId);
    expect(rp.aimX).toBeGreaterThanOrEqual(0);
    expect(rp.aimX).toBeLessThanOrEqual(ARENA.width);
  }
  // Vérifié à chaque tick sur chaque entité : comparaisons simples (expect est trop
  // coûteux dans cette boucle), avec une erreur explicite en cas de violation.
  state.entities.forEach((e, id) => {
    if (!inside(e, PLAYFIELD)) throw new Error(`entité ${id} hors de la salle : (${e.x}, ${e.y})`);
  });
  state.crosshairs.forEach((c, id) => {
    if (!inside(c, { left: 0, top: 0, right: ARENA.width, bottom: ARENA.height })) {
      throw new Error(`viseur ${id} hors de l'arène : (${c.x}, ${c.y})`);
    }
  });
}

function inside(p: { x: number; y: number }, box: { left: number; top: number; right: number; bottom: number }) {
  return p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
}
