import { Client, Room } from "colyseus";
import {
  AIM, ARENA, AssignMessage, clampToArena, COUNTDOWN_SECONDS, CROSSHAIR_COLORS, Dir, IDLE,
  FireMessage, InputMessage, isDir, MSG, Phase, RESULTS_SECONDS, RevealMessage, ShotMessage, step, TICK_RATE,
} from "@whosclaude/shared";
import { Crosshair, Entity, GameState } from "./GameState.js";
import type { GameMode, NpcBrain } from "./modes/GameMode.js";
import { RaceMode } from "./modes/RaceMode.js";

/** Données côté serveur uniquement : qui contrôle quoi. Jamais synchronisé. */
interface Controller extends NpcBrain {
  /** sessionId du joueur, ou null si l'entité est un PNJ. */
  playerId: string | null;
  /** Direction demandée par le joueur (ignorée pour les PNJ). */
  input: Dir;
}

interface Player {
  entityId: string;
  crosshairId: string;
  aimX: number;
  aimY: number;
  alive: boolean;
  /** Tir demandé : la visée est verrouillée jusqu'à ce que le viseur atteigne sa cible. */
  firing: boolean;
}

export class GameRoom extends Room<GameState> {
  maxClients = CROSSHAIR_COLORS.length;
  state = new GameState();

  private mode: GameMode = new RaceMode();
  private controllers = new Map<string, Controller>();
  private players = new Map<string, Player>();
  private phaseTimer = 0;

  onCreate() {
    this.resetRound();

    this.onMessage(MSG.input, (client, message: InputMessage) => {
      const player = this.players.get(client.sessionId);
      if (!player || !message) return;
      if (!player.firing) this.setAim(player, message.aimX, message.aimY);
      if (player.alive && isDir(message.dir)) {
        this.controllers.get(player.entityId)!.input = this.mode.mapInput(message.dir);
      }
    });

    this.onMessage(MSG.fire, (client, message: FireMessage) => {
      const player = this.players.get(client.sessionId);
      const crosshair = player && this.state.crosshairs.get(player.crosshairId);
      if (!player?.alive || !crosshair?.loaded || player.firing || this.state.phase !== "racing") return;
      this.setAim(player, message?.aimX, message?.aimY);
      player.firing = true;
    });

    this.onMessage(MSG.start, () => {
      if (this.state.phase !== "lobby") return;
      this.setPhase("countdown", COUNTDOWN_SECONDS);
    });

    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onJoin(client: Client) {
    this.addPlayer(client);
  }

  onLeave(client: Client) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    this.players.delete(client.sessionId);
    this.state.crosshairs.delete(player.crosshairId);
    // L'entité redevient un PNJ et continue sa vie.
    const controller = this.controllers.get(player.entityId)!;
    controller.playerId = null;
    controller.timer = 0;
  }

  /** Nouvelle manche : nouvelles entités, nouveaux identifiants, nouvelle attribution. */
  private resetRound() {
    this.state.entities.clear();
    this.state.crosshairs.clear();
    this.controllers.clear();
    this.players.clear();

    for (const position of this.mode.spawnPositions()) this.spawnEntity(position.x, position.y);
    for (const client of this.clients) this.addPlayer(client);
    this.setPhase("lobby", 0);
  }

  private addPlayer(client: Client) {
    // Le joueur prend le contrôle d'un PNJ vivant : aucune entité n'apparaît,
    // donc rien dans le flux réseau ne trahit son arrivée.
    const free = [...this.controllers.entries()].filter(
      ([id, c]) => c.playerId === null && this.state.entities.get(id)!.alive,
    );
    const [entityId, controller] = free[Math.floor(Math.random() * free.length)];
    controller.playerId = client.sessionId;
    controller.input = this.state.entities.get(entityId)!.dir as Dir;

    const crosshairId = randomId();
    const crosshair = new Crosshair();
    crosshair.x = ARENA.width / 2;
    crosshair.y = ARENA.height / 2;
    crosshair.color = this.freeColor();
    this.state.crosshairs.set(crosshairId, crosshair);

    this.players.set(client.sessionId, { entityId, crosshairId, aimX: crosshair.x, aimY: crosshair.y, alive: true, firing: false });
    const message: AssignMessage = { entityId, crosshairId };
    client.send(MSG.assign, message);
  }

  private freeColor() {
    const used = new Set<number>();
    this.state.crosshairs.forEach((c) => used.add(c.color));
    return CROSSHAIR_COLORS.findIndex((_, i) => !used.has(i));
  }

  private spawnEntity(x: number, y: number) {
    // Identifiant aléatoire : l'ordre de création ne révèle rien.
    const id = randomId();
    const entity = new Entity();
    entity.x = x;
    entity.y = y;
    this.state.entities.set(id, entity);
    // Délai initial aléatoire pour que les PNJ ne démarrent pas tous ensemble.
    this.controllers.set(id, { playerId: null, input: IDLE, timer: Math.random() * 1.2 });
  }

  private setPhase(phase: Phase, seconds: number) {
    this.state.phase = phase;
    this.phaseTimer = seconds;
    this.state.countdown = Math.ceil(seconds);
  }

  private update(dt: number) {
    switch (this.state.phase) {
      case "lobby":
        this.moveCrosshairs(dt);
        break;
      case "countdown":
        this.moveCrosshairs(dt);
        this.phaseTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.phaseTimer));
        if (this.phaseTimer <= 0) this.setPhase("racing", 0);
        break;
      case "racing":
        this.moveCrosshairs(dt);
        this.moveEntities(dt);
        this.checkEndOfRound();
        break;
      case "finished":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.resetRound();
        break;
    }
  }

  private moveCrosshairs(dt: number) {
    const maxStep = AIM.speed * dt;
    for (const player of this.players.values()) {
      const crosshair = this.state.crosshairs.get(player.crosshairId);
      if (!crosshair) continue;
      const dx = player.aimX - crosshair.x;
      const dy = player.aimY - crosshair.y;
      const distance = Math.hypot(dx, dy);
      const ratio = distance <= maxStep ? 1 : maxStep / distance;
      crosshair.x += dx * ratio;
      crosshair.y += dy * ratio;
      if (player.firing && ratio === 1) {
        player.firing = false;
        this.fire(player);
      }
    }
  }

  private setAim(player: Player, x: unknown, y: unknown) {
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const aim = clampToArena(x, y);
    player.aimX = aim.x;
    player.aimY = aim.y;
  }

  private moveEntities(dt: number) {
    this.state.entities.forEach((entity, id) => {
      if (!entity.alive) return;
      const controller = this.controllers.get(id)!;
      if (controller.playerId === null) this.mode.thinkNpc(entity, controller, dt);
      else entity.dir = controller.input;

      const next = step(entity.x, entity.y, entity.dir as Dir, dt);
      entity.x = next.x;
      entity.y = next.y;
    });
  }

  private fire(shooter: Player) {
    const crosshair = this.state.crosshairs.get(shooter.crosshairId);
    if (!shooter.alive || !crosshair?.loaded) return;
    crosshair.loaded = false;

    // On touche le personnage vivant le plus proche du centre du viseur (jamais soi-même).
    const inRange: { id: string; distance: number }[] = [];
    this.state.entities.forEach((entity, id) => {
      if (!entity.alive || id === shooter.entityId) return;
      const distance = Math.hypot(entity.x - crosshair.x, entity.y - crosshair.y);
      if (distance <= AIM.hitRadius) inRange.push({ id, distance });
    });
    const targetId = inRange.sort((a, b) => a.distance - b.distance)[0]?.id;

    let victim: ShotMessage["victim"] = null;
    if (targetId) {
      const target = this.state.entities.get(targetId)!;
      target.alive = false;
      target.dir = IDLE;
      const victimPlayer = [...this.players.values()].find((p) => p.entityId === targetId);
      if (victimPlayer) {
        victimPlayer.alive = false;
        this.state.crosshairs.delete(victimPlayer.crosshairId);
        victim = "player";
      } else {
        victim = "npc";
      }
    }

    const message: ShotMessage = { x: crosshair.x, y: crosshair.y, victim };
    this.broadcast(MSG.shot, message);
  }

  private checkEndOfRound() {
    const players = [...this.players.values()];
    const alive = players.filter((p) => p.alive);

    const finishers = alive
      .map((p) => ({ id: p.entityId, entity: this.state.entities.get(p.entityId)! }))
      .filter(({ entity }) => this.mode.hasWon(entity))
      .sort((a, b) => b.entity.x - a.entity.x);
    if (finishers.length > 0) return this.endRound(finishers[0].id);

    // Dernier survivant, ou plus personne : seulement s'il y avait de la concurrence.
    if (players.length >= 2 && alive.length === 1) return this.endRound(alive[0].entityId);
    if (players.length >= 1 && alive.length === 0) return this.endRound(null);
  }

  private endRound(winnerEntityId: string | null) {
    this.state.entities.forEach((entity) => (entity.dir = IDLE));
    this.setPhase("finished", RESULTS_SECONDS);
    const playerEntityIds = [...this.players.values()].map((p) => p.entityId);
    const message: RevealMessage = { winnerEntityId, playerEntityIds };
    this.broadcast(MSG.reveal, message);
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
