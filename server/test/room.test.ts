import { describe, expect, it } from "vitest";
import type { Client } from "colyseus";
import { LOOK_COUNT, MSG, RACE, ROUNDS, type JoinOptions } from "@whosclaude/shared";
import { GameRoom } from "../src/GameRoom.js";
import {
  advance, advanceUntil, createRoom, internals, join, send, shoot, startMatch, useTestServer, waitFor,
} from "./helpers.js";

/**
 * Room dont l'autorisation peut être suspendue après la vérification de phase,
 * pour rejouer la course « startMatch traité pendant un onAuth asynchrone ».
 */
class SlowAuthRoom extends GameRoom {
  static gate: Promise<void> | null = null;
  static waiting = false;
}
Object.defineProperty(SlowAuthRoom.prototype, "onAuth", {
  value: async function (this: GameRoom, client: Client, options: JoinOptions) {
    const allowed = GameRoom.prototype.onAuth.call(this, client, options);
    if (SlowAuthRoom.gate) {
      SlowAuthRoom.waiting = true;
      await SlowAuthRoom.gate;
    }
    return allowed;
  },
});

const ctx = useTestServer((server) => server.define("slow-auth", SlowAuthRoom));

describe("salon", () => {
  it("le premier arrivé est l'hôte ; pseudos nettoyés ; couleurs uniques", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room, "  Alice‮ ");
    const b = await join(ctx.colyseus, room, "");
    await waitFor(() => room.state.players.size === 2);
    expect(room.state.hostId).toBe(a.sessionId);
    expect(room.state.players.get(a.sessionId)!.name).toBe("Alice");
    expect(room.state.players.get(b.sessionId)!.name).toBe("Joueur 1");
    expect(room.roomId).toMatch(/^[A-Z]{4}$/);
  });

  it("deux joueurs ne peuvent pas porter le même pseudo", async () => {
    const room = await createRoom(ctx.colyseus);
    const players = [];
    for (const name of ["Alice", "Alice", "Alice", "", ""]) players.push(await join(ctx.colyseus, room, name));
    const names = players.map((p) => room.state.players.get(p.sessionId)!.name);
    expect(names).toEqual(["Alice", "Alice (2)", "Alice (3)", "Joueur 1", "Joueur 2"]);

    // Un départ libère le nom : le suivant le récupère au lieu de créer un doublon.
    await players[3].room.leave();
    await waitFor(() => room.state.players.size === 4);
    const next = await join(ctx.colyseus, room, "");
    expect(room.state.players.get(next.sessionId)!.name).toBe("Joueur 1");
  });

  it("seul l'hôte règle le match, et les valeurs sont bornées", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    const guest = await join(ctx.colyseus, room);
    await send(room, guest, MSG.settings, { rounds: 7 });
    expect(room.state.totalRounds).toBe(ROUNDS.default);

    for (const [rounds, expected] of [[99, ROUNDS.max], [0, ROUNDS.min], [2.5, ROUNDS.min], [4, 4]] as const) {
      await send(room, host, MSG.settings, { rounds });
      expect(room.state.totalRounds).toBe(expected);
    }
    await send(room, host, MSG.settings, { modeId: "__proto__" });
    expect(room.state.modeId).toBe("race");
  });

  it("le match ne démarre que si les autres sont prêts, et seulement par l'hôte", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    const guest = await join(ctx.colyseus, room);
    await send(room, host, MSG.startMatch);
    expect(room.state.phase).toBe("lobby");

    await send(room, guest, MSG.ready, { ready: true });
    await send(room, guest, MSG.startMatch);
    expect(room.state.phase).toBe("lobby");

    await send(room, host, MSG.startMatch);
    expect(room.state.phase).toBe("countdown");
  });

  it("l'hôte qui part passe la main au plus ancien", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    const b = await join(ctx.colyseus, room);
    await join(ctx.colyseus, room);
    await a.room.leave();
    await waitFor(() => room.state.hostId === b.sessionId, "migration d'hôte");
  });

  it("personne ne rejoint en plein match", async () => {
    const room = await createRoom(ctx.colyseus);
    const host = await join(ctx.colyseus, room);
    await startMatch(room, [host]);
    await expect(join(ctx.colyseus, room)).rejects.toThrow();
  });

  it("un match lancé pendant l'autorisation d'un arrivant le refuse quand même", async () => {
    const room = await createRoom(ctx.colyseus, "slow-auth");
    const host = await join(ctx.colyseus, room);

    let release!: () => void;
    SlowAuthRoom.gate = new Promise((resolve) => (release = resolve));
    SlowAuthRoom.waiting = false;
    const late = join(ctx.colyseus, room, "Tardif");
    late.catch(() => {}); // observé plus bas
    await waitFor(() => SlowAuthRoom.waiting, "onAuth suspendu");

    // onAuth a validé la phase « lobby »... et le match démarre pendant qu'il attend.
    await send(room, host, MSG.startMatch);
    expect(room.state.phase).toBe("countdown");
    SlowAuthRoom.gate = null;
    release();

    await expect(late).rejects.toThrow();
    expect(room.state.players.size).toBe(1);
    expect(room.clients.length).toBe(1);
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

  it("direction et visée sont indépendantes (pas de corrélation viseur ↔ entité)", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    await startMatch(room, [a]);
    const entity = room.state.entities.get(a.assigns[0].entityId)!;
    const crosshair = room.state.crosshairs.get(a.assigns[0].crosshairId!)!;
    const aimBefore = { ...internals(room).roundPlayers.get(a.sessionId)! };

    // Un move, même accompagné de champs de visée, ne touche pas au viseur.
    await send(room, a, MSG.move, { dir: 0, aimX: 10, aimY: 10 });
    advance(room, 0.5);
    expect(entity.x).toBeGreaterThan(RACE.startX);
    expect(internals(room).roundPlayers.get(a.sessionId)).toMatchObject({ aimX: aimBefore.aimX, aimY: aimBefore.aimY });
    expect({ x: crosshair.x, y: crosshair.y }).toEqual({ x: aimBefore.aimX, y: aimBefore.aimY });

    // Un aim, même accompagné d'une direction, ne touche pas au personnage.
    await send(room, a, MSG.move, { dir: -1 });
    const xStopped = entity.x;
    await send(room, a, MSG.aim, { aimX: 100, aimY: 100, dir: 0 });
    advance(room, 1);
    expect(entity.x).toBe(xStopped);
    expect({ x: crosshair.x, y: crosshair.y }).toEqual({ x: 100, y: 100 });
  });

  it("le sprint accélère le joueur, et jamais un PNJ", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const runner = room.state.entities.get(a.assigns[0].entityId)!;
    const sprinter = room.state.entities.get(b.assigns[0].entityId)!;

    await send(room, a, MSG.move, { dir: 0 });
    await send(room, b, MSG.move, { dir: 0, sprint: true });
    advance(room, 2);
    const normal = runner.x - RACE.startX;
    const fast = sprinter.x - RACE.startX;
    expect(fast / normal).toBeCloseTo(RACE.sprintMultiplier, 1);

    // Aucun PNJ n'a dépassé la vitesse normale, même pendant que des joueurs sprintaient.
    const { controllers } = internals(room);
    room.state.entities.forEach((e, id) => {
      if (controllers.get(id)!.playerId === null) expect(e.x - RACE.startX).toBeLessThanOrEqual(normal + 1e-6);
    });

    // Un joueur qui part en sprintant rend une entité qui ne sprinte plus.
    await b.room.leave();
    await waitFor(() => room.state.players.size === 1, "départ traité");
    expect((controllers.get(b.assigns[0].entityId) as unknown as { sprint: boolean }).sprint).toBe(false);
  });

  it("chaque personnage, joueur ou PNJ, a une apparence tirée parmi les 10", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const looks = [...room.state.entities.values()].map((e) => e.look);
    expect(looks.every((l) => Number.isInteger(l) && l >= 0 && l < LOOK_COUNT)).toBe(true);
    expect(new Set(looks).size).toBeGreaterThan(1); // 20 tirages : jamais tous identiques en pratique
  });

  it("une seule balle, et on ne peut pas se tirer dessus", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const self = room.state.entities.get(a.assigns[0].entityId)!;

    await shoot(room, a, a.assigns[0].entityId);
    expect(self.alive).toBe(true);
    expect(a.shots.at(-1)!.victim).not.toBe("player");
    expect(room.state.crosshairs.get(a.assigns[0].crosshairId!)!.loaded).toBe(false);

    const other = room.state.entities.get(b.assigns[0].entityId)!;
    await send(room, a, MSG.fire, { aimX: other.x, aimY: other.y });
    advance(room, 2);
    expect(other.alive).toBe(true);
    expect(a.shots).toHaveLength(1);
  });

  it("tuer le dernier adversaire fait gagner la manche", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b], 2);
    const target = room.state.entities.get(b.assigns[0].entityId)!;

    await shoot(room, a, b.assigns[0].entityId);
    expect(room.state.phase).toBe("roundEnd");
    await waitFor(() => a.reveals.length === 1, "révélation");

    expect(target.alive).toBe(false);
    expect(room.state.crosshairs.has(b.assigns[0].crosshairId!)).toBe(false);
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
    expect(a.shots.at(-1)!.victim).toBe("player");
    expect(a.reveals[0].winnerPlayerId).toBe(a.sessionId);
  });

  it("tirer sur un PNJ le tue sans finir la manche", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const { controllers, roundPlayers } = internals(room);
    const [npcId, npc] = [...room.state.entities.entries()].find(([id]) => controllers.get(id)!.playerId === null)!;

    await send(room, a, MSG.fire, { aimX: npc.x, aimY: npc.y });
    // Le PNJ peut bouger pendant le trajet du viseur : on le garde sous la visée
    // à chaque tick pour isoler la règle testée.
    for (let i = 0; i < 40 && npc.alive; i++) {
      const aim = roundPlayers.get(a.sessionId)!;
      npc.x = aim.aimX;
      npc.y = aim.aimY;
      room.tick(0.05);
    }
    await waitFor(() => a.shots.length === 1, "message de tir");
    expect(room.state.entities.get(npcId)!.alive).toBe(false);
    expect(a.shots[0].victim).toBe("npc");
    expect(room.state.phase).toBe("playing");
  });

  it("franchir l'arrivée fait gagner", async () => {
    const room = await createRoom(ctx.colyseus);
    const a = await join(ctx.colyseus, room);
    await startMatch(room, [a]);
    await send(room, a, MSG.move, { dir: 0 });
    advanceUntil(room, "roundEnd", 20);
    expect(room.state.entities.get(a.assigns[0].entityId)!.x).toBeGreaterThanOrEqual(RACE.finishX);
    expect(room.state.players.get(a.sessionId)!.score).toBe(1);
  });

  it("un joueur qui part en pleine manche rend son entité aux PNJ", async () => {
    const room = await createRoom(ctx.colyseus);
    const [a, b] = [await join(ctx.colyseus, room), await join(ctx.colyseus, room)];
    await startMatch(room, [a, b]);
    const entityId = b.assigns[0].entityId;
    await b.room.leave();
    await waitFor(() => room.state.players.size === 1, "départ traité");
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
      await shoot(room, a, b.assigns.at(-1)!.entityId);
      expect(room.state.phase).toBe("roundEnd");
      advanceUntil(room, round < 2 ? "playing" : "podium", 15);
      if (round < 2) await waitFor(() => b.assigns.length === 2, "nouvelle attribution");
    }

    expect(room.state.entities.size).toBe(0);
    expect(room.state.players.get(a.sessionId)!.score).toBe(2);
    advanceUntil(room, "lobby", 15);
    expect([...room.state.players.values()].every((p) => !p.ready)).toBe(true);
    expect(room.state.round).toBe(0);
    expect(new Set(b.assigns.map((x) => x.entityId)).size).toBe(2); // nouveaux ids à chaque manche
  });
});
