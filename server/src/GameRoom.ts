import { randomBytes } from "node:crypto";
import { Client, Room, ServerError } from "colyseus";
import {
  AIM, ARENA, ASSASSINS, type KnifeMessage, LOOK_COUNT, AssignMessage, clampToArena, COUNTDOWN_SECONDS, DEFAULT_MODE, Dir, FireMessage, IDLE,
  AimMessage, isDir, isModeId, MoveMessage, JoinOptions, MAX_PLAYERS, MSG, Phase, PODIUM_SECONDS, ReadyMessage,
  RESULTS_SECONDS, RevealMessage, ROUNDS, sanitizeName, SettingsMessage, ShotMessage, SPEED, step, TICK_RATE,
  CROSSHAIR_COLORS,
} from "@whosclaude/shared";
import { Crosshair, Entity, GameState, PlayerInfo } from "./GameState.js";
import type { GameMode, NpcBrain } from "./modes/GameMode.js";
import { createMode } from "./modes/index.js";
import { uniqueName } from "./names.js";
import { releaseRoomCode, reserveRoomCode } from "./roomCodes.js";

/** Données côté serveur uniquement : qui contrôle quoi. Jamais synchronisé. */
interface Controller extends NpcBrain {
  /** sessionId du joueur, ou null si l'entité est un PNJ. */
  playerId: string | null;
  /** Direction demandée par le joueur (ignorée pour les PNJ). */
  input: Dir;
  /** Sprint demandé par le joueur. Jamais vrai pour un PNJ. */
  sprint: boolean;
  /**
   * Joueur momentanément déconnecté : l'IA conduit son entité en attendant son retour.
   * Elle ne s'arrête pas net (ce qui le trahirait) et continue comme un PNJ.
   */
  autopilot: boolean;
}


/** Ce qu'un joueur contrôle pendant la manche en cours. Jamais synchronisé. */
interface RoundPlayer {
  entityId: string;
  /** Viseur du joueur, ou null si le mode n'en a pas. */
  crosshairId: string | null;
  aimX: number;
  aimY: number;
  alive: boolean;
  /** Tir demandé : la visée est verrouillée jusqu'à ce que le viseur atteigne sa cible. */
  firing: boolean;
  /** Instant (horloge de manche) à partir duquel le couteau est de nouveau utilisable. */
  knifeReadyAt: number;
}

/**
 * Une room = une session entre amis, identifiée par un code court.
 * Salon (réglages, joueurs prêts) → match de N manches → podium → salon.
 */
export class GameRoom extends Room<GameState> {
  /**
   * Les tests passent à false et font avancer le temps eux-mêmes avec tick().
   * Volontairement statique, et surtout pas une option de room : les options
   * de création viennent du client, qui pourrait sinon figer une partie.
   */
  static autoTick = true;
  /** Délai accordé à un joueur déconnecté (écran verrouillé, wifi instable…) pour revenir. */
  static reconnectionSeconds = 20;

  maxClients = MAX_PLAYERS;
  state = new GameState();

  private mode: GameMode = createMode(DEFAULT_MODE);
  private controllers = new Map<string, Controller>();
  private roundPlayers = new Map<string, RoundPlayer>();
  private phaseTimer = 0;
  /** Secondes écoulées depuis le début de la phase de jeu de la manche. */
  private roundClock = 0;
  /** Secondes restantes avant la fin forcée de la manche (si le mode a une limite). */
  private roundRemaining = 0;
  /** Joueurs au départ de la manche : un départ ne doit pas priver le dernier restant de sa victoire. */
  private roundStartPlayers = 0;

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
      const before = `${this.state.modeId}/${this.state.totalRounds}`;
      if (isModeId(message.modeId)) this.state.modeId = message.modeId;
      if (Number.isInteger(message.rounds)) {
        this.state.totalRounds = Math.max(ROUNDS.min, Math.min(ROUNDS.max, message.rounds!));
      }
      // Être prêt, c'est accepter ces réglages-là : s'ils changent, chacun doit le redire.
      if (`${this.state.modeId}/${this.state.totalRounds}` !== before) this.state.players.forEach((p) => (p.ready = false));
    });

    this.onMessage(MSG.startMatch, (client) => {
      if (!this.isHost(client) || this.state.phase !== "lobby" || !this.everyoneReady()) return;
      this.startMatch();
    });

    this.onMessage(MSG.move, (client, message: MoveMessage) => {
      const player = this.roundPlayers.get(client.sessionId);
      if (player?.alive && isDir(message?.dir)) {
        const controller = this.controllers.get(player.entityId)!;
        controller.input = this.mode.mapInput(message.dir);
        controller.sprint = message.sprint === true;
      }
    });

    this.onMessage(MSG.aim, (client, message: AimMessage) => {
      const player = this.roundPlayers.get(client.sessionId);
      if (player && !player.firing) this.setAim(player, message?.aimX, message?.aimY);
    });

    this.onMessage(MSG.stab, (client) => {
      const player = this.roundPlayers.get(client.sessionId);
      if (!player?.alive || !this.mode.knife || this.state.phase !== "playing") return;
      if (this.roundClock < player.knifeReadyAt) return;
      player.knifeReadyAt = this.roundClock + this.mode.knifeCooldown;
      this.stab(player);
    });

    this.onMessage(MSG.fire, (client, message: FireMessage) => {
      const player = this.roundPlayers.get(client.sessionId);
      const crosshair = player?.crosshairId ? this.state.crosshairs.get(player.crosshairId) : undefined;
      if (!player?.alive || !crosshair?.loaded || player.firing || this.state.phase !== "playing") return;
      this.setAim(player, message?.aimX, message?.aimY);
      player.firing = true;
    });

    this.setPatchRate(1000 / TICK_RATE);
    // Type inconnu (client d'une autre version, client modifié) : on ignore au lieu
    // de déconnecter, ce qui éjecterait un joueur en pleine manche.
    this.onMessage("*", () => {});

    if (GameRoom.autoTick) this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onAuth(_client: Client, _options: JoinOptions) {
    // Pas d'arrivée en plein match : il faudrait apparaître dans l'arène sans se trahir.
    if (this.state.phase !== "lobby") throw new ServerError(403, "Un match est en cours, réessaie à la fin.");
    return true;
  }

  onJoin(client: Client, options: JoinOptions) {
    // onAuth est asynchrone : un startMatch a pu être traité entre-temps.
    if (this.state.phase !== "lobby") throw new ServerError(403, "Un match est en cours, réessaie à la fin.");
    const info = new PlayerInfo();
    const taken = new Set<string>();
    this.state.players.forEach((p) => taken.add(p.name));
    info.name = uniqueName(sanitizeName(options?.name), taken);
    info.color = this.freeColor();
    this.state.players.set(client.sessionId, info);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  async onLeave(client: Client, consented?: boolean) {
    // Départ involontaire : on garde la place du joueur quelques secondes.
    if (!consented && (await this.waitForReconnection(client))) return;
    this.removePlayer(client.sessionId);
  }

  /**
   * Garde la place d'un joueur déconnecté (pseudo, couleur, score, statut d'hôte, entité).
   * Pendant l'attente, l'IA conduit son entité. Renvoie true s'il est revenu à temps.
   */
  private async waitForReconnection(client: Client): Promise<boolean> {
    const autopilot = (on: boolean) => {
      const player = this.roundPlayers.get(client.sessionId);
      const controller = player && this.controllers.get(player.entityId);
      if (!controller) return;
      controller.autopilot = on;
      controller.sprint = false;
      controller.input = IDLE;
      controller.timer = 0;
    };
    autopilot(true);
    let back: Client;
    try {
      back = await this.allowReconnection(client, GameRoom.reconnectionSeconds);
    } catch {
      return false; // délai écoulé : départ définitif
    }
    autopilot(false);
    // Revenu : on lui rend son personnage. Si une nouvelle manche a démarré pendant la coupure,
    // il en reçoit un pendant le compte à rebours ; en pleine manche, il regarde jusqu'à la
    // suivante (un PNJ à deux pas de l'arrivée serait une victoire offerte, et un viseur qui
    // apparaît en pleine partie trahirait son retour).
    const player = this.roundPlayers.get(back.sessionId);
    if (player) {
      const message: AssignMessage = { entityId: player.entityId, crosshairId: player.crosshairId };
      back.send(MSG.assign, message);
    } else if (this.state.phase === "countdown") {
      this.addRoundPlayer(back);
    }
    return true;
  }

  private removePlayer(sessionId: string) {
    this.state.players.delete(sessionId);
    if (this.state.hostId === sessionId) {
      // L'hôte part : le plus ancien joueur restant prend la main.
      this.state.hostId = this.state.players.keys().next().value ?? "";
    }

    const player = this.roundPlayers.get(sessionId);
    if (!player) return;
    this.roundPlayers.delete(sessionId);
    if (player.crosshairId) this.state.crosshairs.delete(player.crosshairId);
    // L'entité redevient un PNJ et continue sa vie.
    const controller = this.controllers.get(player.entityId)!;
    controller.playerId = null;
    controller.sprint = false;
    controller.autopilot = false;
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
    this.mode = createMode(this.state.modeId);
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
    this.roundStartPlayers = this.roundPlayers.size;
    this.mode.startRound?.(this.state);
    this.roundClock = 0;
    this.roundRemaining = this.mode.roundSeconds;
    this.state.timeLeft = Math.ceil(this.roundRemaining);
    this.setPhase("countdown", COUNTDOWN_SECONDS);
  }

  private clearRound() {
    this.state.entities.clear();
    this.state.crosshairs.clear();
    this.controllers.clear();
    this.roundPlayers.clear();
    this.state.light.radius = 0;
    this.state.timeLeft = 0;
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

  /** Avance la simulation de dt secondes. */
  tick(dt: number) {
    switch (this.state.phase) {
      case "countdown":
        this.moveCrosshairs(dt);
        this.mode.updateWorld?.(this.state, dt);
        this.phaseTimer -= dt;
        this.state.countdown = Math.max(0, Math.ceil(this.phaseTimer));
        if (this.phaseTimer <= 0) this.setPhase("playing", 0);
        break;
      case "playing":
        this.roundClock += dt;
        this.moveCrosshairs(dt);
        this.mode.updateWorld?.(this.state, dt);
        this.moveEntities(dt);
        this.checkEndOfRound();
        if (this.state.phase === "playing") this.updateRoundTimer(dt);
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

  /** Limite de temps du mode : à zéro, la manche s'arrête sans gagnant. */
  private updateRoundTimer(dt: number) {
    if (this.mode.roundSeconds <= 0) return;
    this.roundRemaining -= dt;
    this.state.timeLeft = Math.max(0, Math.ceil(this.roundRemaining));
    if (this.roundRemaining <= 0) this.endRound(null);
  }

  private addRoundPlayer(client: Client) {
    // Le joueur prend le contrôle d'un PNJ vivant : aucune entité n'apparaît,
    // donc rien dans le flux réseau ne trahit son arrivée.
    const free = [...this.controllers.entries()].filter(
      ([id, c]) => c.playerId === null && this.state.entities.get(id)!.alive,
    );
    const [entityId, controller] = free[Math.floor(Math.random() * free.length)];
    controller.playerId = client.sessionId;
    controller.input = this.state.entities.get(entityId)!.dir as Dir;
    controller.sprint = false;
    controller.autopilot = false;

    let crosshairId: string | null = null;
    if (this.mode.crosshairs) {
      crosshairId = randomId();
      const crosshair = new Crosshair();
      crosshair.x = ARENA.width / 2;
      crosshair.y = ARENA.height / 2;
      crosshair.color = this.state.players.get(client.sessionId)?.color ?? 0;
      this.state.crosshairs.set(crosshairId, crosshair);
    }

    this.roundPlayers.set(client.sessionId, {
      entityId, crosshairId, aimX: ARENA.width / 2, aimY: ARENA.height / 2, alive: true, firing: false, knifeReadyAt: 0,
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
    // Apparence tirée pour chaque entité AVANT l'attribution aux joueurs : elle ne dit rien
    // de qui est contrôlé par un joueur.
    entity.look = Math.floor(Math.random() * LOOK_COUNT);
    this.state.entities.set(id, entity);
    // Délai initial aléatoire pour que les PNJ ne démarrent pas tous ensemble.
    this.controllers.set(id, { playerId: null, input: IDLE, sprint: false, autopilot: false, timer: Math.random() * 1.2 });
  }

  private moveCrosshairs(dt: number) {
    const maxStep = AIM.speed * dt;
    for (const player of this.roundPlayers.values()) {
      const crosshair = player.crosshairId ? this.state.crosshairs.get(player.crosshairId) : undefined;
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
      if (controller.playerId === null || controller.autopilot) this.mode.thinkNpc(entity, controller, dt);
      else entity.dir = controller.input;

      // Le sprint n'existe que pour les joueurs : un PNJ ne va jamais plus vite que SPEED.
      const sprinting = controller.playerId !== null && controller.sprint;
      const speed = sprinting ? SPEED * this.mode.sprintMultiplier : SPEED;
      const next = step(entity.x, entity.y, entity.dir as Dir, dt, speed);
      entity.x = next.x;
      entity.y = next.y;
    });
  }

  private fire(shooter: RoundPlayer) {
    const crosshair = shooter.crosshairId ? this.state.crosshairs.get(shooter.crosshairId) : undefined;
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

    const message: ShotMessage = { x: crosshair.x, y: crosshair.y, victim: targetId ? this.kill(targetId) : null };
    this.broadcast(MSG.shot, message);
  }

  /** Coup de couteau : le personnage vivant le plus proche à portée de bras (jamais soi-même). */
  private stab(attacker: RoundPlayer) {
    const self = this.state.entities.get(attacker.entityId)!;
    let targetId: string | null = null;
    let best: number = ASSASSINS.knifeRange;
    for (const [id, entity] of this.state.entities) {
      if (!entity.alive || id === attacker.entityId) continue;
      const distance = Math.hypot(entity.x - self.x, entity.y - self.y);
      if (distance <= best) {
        best = distance;
        targetId = id;
      }
    }
    const message: KnifeMessage = { entityId: attacker.entityId, victim: targetId ? this.kill(targetId) : null };
    this.broadcast(MSG.knife, message);
  }

  /** Élimine une entité ; renvoie s'il s'agissait d'un joueur ou d'un PNJ. */
  private kill(targetId: string): "player" | "npc" {
    const target = this.state.entities.get(targetId)!;
    target.alive = false;
    target.dir = IDLE;
    const victimId = this.controllers.get(targetId)!.playerId;
    const victimPlayer = victimId ? this.roundPlayers.get(victimId) : undefined;
    if (!victimPlayer) return "npc";
    victimPlayer.alive = false;
    if (victimPlayer.crosshairId) this.state.crosshairs.delete(victimPlayer.crosshairId);
    return "player";
  }

  private checkEndOfRound() {
    // Appelé à chaque tick : une seule passe, sans allocation.
    let aliveCount = 0;
    let lastAlive: RoundPlayer | undefined;
    let winner: { entityId: string; x: number } | undefined;
    for (const player of this.roundPlayers.values()) {
      if (!player.alive) continue;
      aliveCount++;
      lastAlive = player;
      const entity = this.state.entities.get(player.entityId)!;
      // Plusieurs arrivées dans le même tick : le plus avancé gagne.
      if (this.mode.hasWon(entity) && (!winner || entity.x > winner.x)) winner = { entityId: player.entityId, x: entity.x };
    }
    if (winner) return this.endRound(winner.entityId);

    // Dernier survivant, ou plus personne : seulement s'il y avait de la concurrence.
    // Compté au départ de la manche : si les autres sont partis, le dernier restant gagne.
    const playerCount = Math.max(this.roundStartPlayers, this.roundPlayers.size);
    if (playerCount >= 2 && aliveCount === 1) return this.endRound(lastAlive!.entityId);
    if (playerCount >= 1 && aliveCount === 0) return this.endRound(null);
  }
}

/** Identifiant public aléatoire, de longueur fixe (rien n'y trahit l'ordre de création). */
function randomId() {
  return randomBytes(6).toString("hex");
}
