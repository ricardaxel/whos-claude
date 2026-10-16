import { Client, Room, ServerError } from "colyseus";
import {
  AIM, ARENA, AssignMessage, clampToArena, COUNTDOWN_SECONDS, DEFAULT_MODE, Dir, FireMessage, IDLE,
  InputMessage, isDir, isModeId, JoinOptions, MAX_PLAYERS, MSG, Phase, PODIUM_SECONDS, ReadyMessage,
  RESULTS_SECONDS, RevealMessage, ROUNDS, sanitizeName, SettingsMessage, ShotMessage, step, TICK_RATE,
  CROSSHAIR_COLORS,
} from "@whosclaude/shared";
import { Crosshair, Entity, GameState, PlayerInfo } from "./GameState.js";
import type { GameMode, NpcBrain } from "./modes/GameMode.js";
import { MODE_FACTORIES } from "./modes/index.js";
import { releaseRoomCode, reserveRoomCode } from "./roomCodes.js";

/** Données côté serveur uniquement : qui contrôle quoi. Jamais synchronisé. */
interface Controller extends NpcBrain {
  /** sessionId du joueur, ou null si l'entité est un PNJ. */
  playerId: string | null;
  /** Direction demandée par le joueur (ignorée pour les PNJ). */
  input: Dir;
}

/** Ce qu'un joueur contrôle pendant la manche en cours. Jamais synchronisé. */
interface RoundPlayer {
  entityId: string;
  crosshairId: string;
  aimX: number;
  aimY: number;
  alive: boolean;
  /** Tir demandé : la visée est verrouillée jusqu'à ce que le viseur atteigne sa cible. */
  firing: boolean;
}

/**
 * Une room = une session entre amis, identifiée par un code court.
 * Salon (réglages, joueurs prêts) → match de N manches → podium → salon.
 */
export class GameRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;
  state = new GameState();

  private mode: GameMode = MODE_FACTORIES[DEFAULT_MODE]();
  private controllers = new Map<string, Controller>();
  private roundPlayers = new Map<string, RoundPlayer>();
  private phaseTimer = 0;

  onCreate() {
    // Le code de la room sert directement d'identifiant : on rejoint avec joinById(code).
    this.roomId = reserveRoomCode();
    // Privée : invisible du matchmaking, on n'y entre qu'avec le code.
    this.setPrivate(true);

    this.onMessage(MSG.ready, (client, message: ReadyMessage) => {
      const info = this.state.players.get(client.sessionId);
      if (info && this.state.phase === "lobby") info.ready = !!message?.ready;
    });

    this.onMessage(MSG.settings, (client, message: SettingsMessage) => {
      if (!this.isHost(client) || this.state.phase !== "lobby" || !message) return;
      if (isModeId(message.modeId)) this.state.modeId = message.modeId;
      if (Number.isInteger(message.rounds)) {
        this.state.totalRounds = Math.max(ROUNDS.min, Math.min(ROUNDS.max, message.rounds!));
      }
    });

    this.onMessage(MSG.startMatch, (client) => {
      if (!this.isHost(client) || this.state.phase !== "lobby" || !this.everyoneReady()) return;
      this.startMatch();
    });

    this.onMessage(MSG.input, (client, message: InputMessage) => {
      const player = this.roundPlayers.get(client.sessionId);
      if (!player || !message) return;
      if (!player.firing) this.setAim(player, message.aimX, message.aimY);
      if (player.alive && isDir(message.dir)) {
        this.controllers.get(player.entityId)!.input = this.mode.mapInput(message.dir);
      }
    });

    this.onMessage(MSG.fire, (client, message: FireMessage) => {
      const player = this.roundPlayers.get(client.sessionId);
      const crosshair = player && this.state.crosshairs.get(player.crosshairId);
      if (!player?.alive || !crosshair?.loaded || player.firing || this.state.phase !== "playing") return;
      this.setAim(player, message?.aimX, message?.aimY);
      player.firing = true;
    });

    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onAuth(_client: Client, _options: JoinOptions) {
    // Pas d'arrivée en plein match : il faudrait apparaître dans l'arène sans se trahir.
    if (this.state.phase !== "lobby") throw new ServerError(403, "Un match est en cours, réessaie à la fin.");
    return true;
  }

  onJoin(client: Client, options: JoinOptions) {
    const info = new PlayerInfo();
    info.name = sanitizeName(options?.name) || `Joueur ${this.state.players.size + 1}`;
    info.color = this.freeColor();
    this.state.players.set(client.sessionId, info);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      // L'hôte part : le plus ancien joueur restant prend la main.
      this.state.hostId = this.state.players.keys().next().value ?? "";
    }

    const player = this.roundPlayers.get(client.sessionId);
    if (!player) return;
    this.roundPlayers.delete(client.sessionId);
    this.state.crosshairs.delete(player.crosshairId);
    // L'entité redevient un PNJ et continue sa vie.
    const controller = this.controllers.get(player.entityId)!;
    controller.playerId = null;
    controller.timer = 0;
  }

  onDispose() {
    releaseRoomCode(this.roomId);
  }

  // --- Salon et match ---

  private isHost(client: Client) {
    return client.sessionId === this.state.hostId;
  }

  /** L'hôte lance quand il veut ; il faut juste que les autres soient prêts. */
  private everyoneReady() {
    return [...this.state.players.entries()].every(([id, info]) => id === this.state.hostId || info.ready);
  }

  private freeColor() {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.color));
    return CROSSHAIR_COLORS.findIndex((_, i) => !used.has(i));
  }

  private startMatch() {
    this.mode = MODE_FACTORIES[this.state.modeId]();
    this.state.players.forEach((p) => (p.score = 0));
    this.state.round = 0;
    this.startRound();
  }

  /** Nouvelle manche : nouvelles entités, nouveaux identifiants, nouvelle attribution. */
  private startRound() {
    this.clearRound();
    this.state.round++;
    for (const position of this.mode.spawnPositions()) this.spawnEntity(position.x, position.y);
    for (const client of this.clients) this.addRoundPlayer(client);
    this.setPhase("countdown", COUNTDOWN_SECONDS);
  }

  private clearRound() {
    this.state.entities.clear();
    this.state.crosshairs.clear();
    this.controllers.clear();
    this.roundPlayers.clear();
  }

  private endRound(winnerEntityId: string | null) {
    this.state.entities.forEach((entity) => (entity.dir = IDLE));
    const players = [...this.roundPlayers.entries()].map(([playerId, p]) => ({ playerId, entityId: p.entityId }));
    const winnerPlayerId = players.find((p) => p.entityId === winnerEntityId)?.playerId ?? null;
    const winnerInfo = winnerPlayerId ? this.state.players.get(winnerPlayerId) : undefined;
    if (winnerInfo) winnerInfo.score++;

    this.setPhase("roundEnd", RESULTS_SECONDS);
    const message: RevealMessage = { winnerPlayerId, winnerEntityId, players };
    this.broadcast(MSG.reveal, message);
  }

  private setPhase(phase: Phase, seconds: number) {
    this.state.phase = phase;
    this.phaseTimer = seconds;
    this.state.countdown = Math.ceil(seconds);
  }

  private update(dt: number) {
    switch (this.state.phase) {
      case "countdown":
        this.moveCrosshairs(dt);
        this.phaseTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.phaseTimer));
        if (this.phaseTimer <= 0) this.setPhase("playing", 0);
        break;
      case "playing":
        this.moveCrosshairs(dt);
        this.moveEntities(dt);
        this.checkEndOfRound();
        break;
      case "roundEnd":
        this.phaseTimer -= dt;
        if (this.phaseTimer > 0) break;
        if (this.state.round < this.state.totalRounds) {
          this.startRound();
        } else {
          this.clearRound();
          this.setPhase("podium", PODIUM_SECONDS);
        }
        break;
      case "podium":
        this.phaseTimer -= dt;
        if (this.phaseTimer > 0) break;
        this.state.players.forEach((p) => (p.ready = false));
        this.state.round = 0;
        this.setPhase("lobby", 0);
        break;
    }
  }

  // --- Manche ---

  private addRoundPlayer(client: Client) {
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
    crosshair.color = this.state.players.get(client.sessionId)?.color ?? 0;
    this.state.crosshairs.set(crosshairId, crosshair);

    this.roundPlayers.set(client.sessionId, {
      entityId, crosshairId, aimX: crosshair.x, aimY: crosshair.y, alive: true, firing: false,
    });
    const message: AssignMessage = { entityId, crosshairId };
    client.send(MSG.assign, message);
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

  private moveCrosshairs(dt: number) {
    const maxStep = AIM.speed * dt;
    for (const player of this.roundPlayers.values()) {
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

  private setAim(player: RoundPlayer, x: unknown, y: unknown) {
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

  private fire(shooter: RoundPlayer) {
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
      const victimPlayer = [...this.roundPlayers.values()].find((p) => p.entityId === targetId);
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
    const players = [...this.roundPlayers.values()];
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
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
