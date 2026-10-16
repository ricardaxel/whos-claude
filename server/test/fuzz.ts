import fc from "fast-check";
import { expect } from "vitest";
import { ARENA, MSG, type Phase } from "@whosclaude/shared";
import type { GameRoom } from "../src/GameRoom.js";
import { advance, checkInvariants, internals, send, waitFor, type Player } from "./helpers.js";

const MESSAGE_TYPES = [MSG.input, MSG.fire, MSG.settings, MSG.ready, MSG.startMatch, "inconnu"];

/** Charges utiles : du n'importe quoi, mais aussi des messages plausibles pour atteindre la manche. */
const payloadArb = fc.oneof(
  { arbitrary: fc.anything(), weight: 3 },
  { arbitrary: fc.constant({ ready: true }), weight: 2 },
  {
    arbitrary: fc.record({
      dir: fc.oneof(fc.integer({ min: -2, max: 8 }), fc.anything()),
      aimX: fc.oneof(fc.integer({ min: -50, max: ARENA.width + 50 }), fc.double()),
      aimY: fc.oneof(fc.integer({ min: -50, max: ARENA.height + 50 }), fc.double()),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      rounds: fc.oneof(fc.integer({ min: -5, max: 15 }), fc.double()),
      modeId: fc.constantFrom("race", "__proto__", "constructor", ""),
    }),
    weight: 1,
  },
);

/**
 * Commandes jouées par le fuzz : des messages arbitraires, mais aussi des actions de jeu
 * ciblées. Sans elles, l'enchaînement prêt → lancer → attendre est trop rare et le fuzz
 * ne sortirait jamais du salon (les handlers de manche ne seraient jamais exercés).
 */
export type Command =
  | { kind: "send"; from: number; type: string; payload: unknown }
  | { kind: "ready"; from: number; ready: boolean }
  | { kind: "start"; from: number }
  | { kind: "run"; from: number; forward: boolean }
  | { kind: "fireAt"; from: number; target: number }
  | { kind: "fireAtPlayer"; from: number; victim: number }
  | { kind: "tick"; seconds: number }
  /** Un joueur court jusqu'à l'arrivée : permet d'enchaîner les manches jusqu'au podium. */
  | { kind: "finish"; from: number }
  | { kind: "leave"; from: number };

export function commandArb(players: number, { leaves }: { leaves: boolean }): fc.Arbitrary<Command> {
  const from = fc.nat(players - 1);
  return fc.oneof(
    { arbitrary: fc.record({ kind: fc.constant("send" as const), from, type: fc.constantFrom(...MESSAGE_TYPES), payload: payloadArb }), weight: 4 },
    { arbitrary: fc.record({ kind: fc.constant("ready" as const), from, ready: fc.boolean() }), weight: 2 },
    { arbitrary: fc.record({ kind: fc.constant("start" as const), from }), weight: 2 },
    { arbitrary: fc.record({ kind: fc.constant("run" as const), from, forward: fc.boolean() }), weight: 2 },
    { arbitrary: fc.record({ kind: fc.constant("fireAt" as const), from, target: fc.nat() }), weight: 1 },
    { arbitrary: fc.record({ kind: fc.constant("fireAtPlayer" as const), from, victim: fc.nat(players - 1) }), weight: 2 },
    {
      arbitrary: fc.record({
        kind: fc.constant("tick" as const),
        seconds: fc.oneof(fc.constantFrom(0.05, 0.25, 1), fc.integer({ min: 2, max: 12 })),
      }),
      weight: 4,
    },
    { arbitrary: fc.record({ kind: fc.constant("finish" as const), from }), weight: 2 },
    { arbitrary: fc.record({ kind: fc.constant("leave" as const), from }), weight: leaves ? 1 : 0 },
  );
}

/** Scénario de lancement (client 1 prêt, l'hôte lance, fin du décompte), à préfixer au fuzz. */
export const LAUNCH: Command[] = [
  { kind: "ready", from: 1, ready: true },
  { kind: "start", from: 0 },
  { kind: "tick", seconds: 3.1 },
];

/** Séquences de commandes ; avec `launch`, la moitié commence par le scénario de lancement. */
export function sequenceArb(players: number, options: { leaves: boolean; launch: boolean }) {
  const random = fc.array(commandArb(players, options), { minLength: 1, maxLength: 40, size: "medium" });
  if (!options.launch) return random;
  return fc.oneof(random, random.map((commands) => [...LAUNCH, ...commands]));
}

/** Joue une séquence de commandes en vérifiant les invariants après chacune ; renvoie les phases vues. */
export async function runCommands(room: GameRoom, players: Player[], commands: Command[]) {
  const phases = new Set<Phase>([room.state.phase]);
  const left = new Set<number>();
  for (const command of commands) {
    if ("from" in command && left.has(command.from)) continue;
    switch (command.kind) {
      case "send":
        await send(room, players[command.from], command.type, command.payload);
        break;
      case "ready":
        await send(room, players[command.from], MSG.ready, { ready: command.ready });
        break;
      case "start":
        await send(room, players[command.from], MSG.startMatch);
        break;
      case "run":
        await send(room, players[command.from], MSG.input, { dir: command.forward ? 0 : -1, aimX: 480, aimY: 320 });
        break;
      case "fireAtPlayer": {
        const victim = internals(room).roundPlayers.get(players[command.victim].sessionId);
        const target = victim && room.state.entities.get(victim.entityId);
        if (target) await send(room, players[command.from], MSG.fire, { aimX: target.x, aimY: target.y });
        break;
      }
      case "fireAt": {
        const entities = [...room.state.entities.values()];
        if (entities.length === 0) break;
        const target = entities[command.target % entities.length];
        await send(room, players[command.from], MSG.fire, { aimX: target.x, aimY: target.y });
        break;
      }
      case "tick":
        advance(room, command.seconds);
        break;
      case "finish":
        if (room.state.phase !== "playing") break;
        await send(room, players[command.from], MSG.input, { dir: 0, aimX: 480, aimY: 320 });
        advance(room, 14);
        break;
      case "leave":
        left.add(command.from);
        await players[command.from].room.leave();
        await waitFor(() => !room.state.players.has(players[command.from].sessionId), "départ traité");
        break;
    }
    checkInvariants(room);
    phases.add(room.state.phase);
  }
  // Personne n'a été déconnecté par une erreur.
  expect(room.clients.length).toBe(players.length - left.size);
  return phases;
}

