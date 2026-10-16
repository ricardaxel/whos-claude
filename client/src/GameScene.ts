import Phaser from "phaser";
import { getStateCallbacks } from "colyseus.js";
import {
  ARENA, AssignMessage, CROSSHAIR_COLORS, DIR_VECTORS, ENTITY_RADIUS, KnifeMessage, ModeId, MSG, Phase,
  RevealMessage, ShotMessage,
} from "@whosclaude/shared";
import type { GameRoom } from "./net";
import { InputManager } from "./input/InputManager";
import { InputSender } from "./input/InputSender";
import { GamepadSource } from "./input/GamepadSource";
import { KeyboardMouseSource } from "./input/KeyboardMouseSource";
import { TouchSource } from "./input/TouchSource";
import type { InputFrame } from "./input/types";
import { DEPTH, MODE_VIEWS, type ModeView } from "./modes/ModeView";

/** Vitesse de convergence de l'interpolation (plus haut = plus réactif). */
const SMOOTHING = 12;
const CROSSHAIR_RADIUS = 14;

/** Ce que la session peut demander à la scène. */
export interface SceneHooks {
  toggleReady(): void;
}

interface View<T extends Phaser.GameObjects.GameObject> {
  object: T;
  targetX: number;
  targetY: number;
}

/**
 * Rendu et inputs d'une manche. La scène ne se connecte pas elle-même :
 * la session lui confie la room (attach) et la lui reprend (detach).
 */
export class GameScene extends Phaser.Scene {
  private room?: GameRoom;
  private hooks?: SceneHooks;
  private created = false;
  private inputs!: InputManager;
  private entities = new Map<string, View<Phaser.GameObjects.Arc>>();
  private crosshairs = new Map<string, View<Phaser.GameObjects.Graphics>>();
  private myEntityId?: string;
  private myCrosshairId?: string;
  private aimSynced = false;
  private sender = new InputSender();
  private view?: ModeView;
  private viewMode?: ModeId;
  /** Dernière direction non nulle de chaque entité : orientation du coup de couteau. */
  private facing = new Map<string, number>();

  private aimGhost!: Phaser.GameObjects.Arc;
  private status!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private revealObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super("game");
  }

  attach(room: GameRoom, hooks: SceneHooks) {
    this.room = room;
    this.hooks = hooks;
    if (this.created) this.bindRoom(room);
  }

  detach() {
    for (const view of [...this.entities.values(), ...this.crosshairs.values()]) view.object.destroy();
    this.entities.clear();
    this.crosshairs.clear();
    this.clearResults();
    this.room = undefined;
    this.hooks = undefined;
    this.myEntityId = this.myCrosshairId = undefined;
    this.sender.reset();
    this.facing.clear();
    this.view?.destroy();
    this.view = this.viewMode = undefined;
    if (this.created) {
      this.banner.setText("");
      this.toast.setText("");
      this.status.setText("");
    }
  }

  create() {
    this.inputs = new InputManager([new KeyboardMouseSource(this), new GamepadSource(this), new TouchSource(this)]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.inputs.destroy());
    this.input.setDefaultCursor("none");

    this.aimGhost = this.add.circle(0, 0, 3, 0xffffff, 0.8).setVisible(false).setDepth(DEPTH.aimGhost);
    this.status = this.add.text(12, 10, "", { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff" }).setDepth(DEPTH.hud);
    this.toast = this.add
      .text(ARENA.width / 2, 40, "", { fontFamily: "sans-serif", fontSize: "22px", fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud);
    this.banner = this.add
      .text(ARENA.width / 2, ARENA.height / 2, "", {
        fontFamily: "sans-serif", fontSize: "56px", fontStyle: "bold", color: "#ffffff",
        stroke: "#000000", strokeThickness: 6, align: "center",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.hud);

    this.created = true;
    if (this.room) this.bindRoom(this.room);
  }

  /** Le décor suit le mode choisi dans le salon. */
  private setModeView(modeId: ModeId) {
    if (modeId === this.viewMode || !MODE_VIEWS[modeId]) return;
    this.view?.destroy();
    this.view = MODE_VIEWS[modeId](this);
    this.viewMode = modeId;
    this.refreshStatus();
  }

  private bindRoom(room: GameRoom) {
    const $ = getStateCallbacks(room);

    $(room.state).entities.onAdd((entity: any, id: string) => {
      const body = this.add.circle(entity.x, entity.y, ENTITY_RADIUS, 0xd9c8a9).setStrokeStyle(2, 0x3b2f22).setDepth(DEPTH.entity);
      const view = { object: body, targetX: entity.x, targetY: entity.y };
      this.entities.set(id, view);
      $(entity).onChange(() => {
        view.targetX = entity.x;
        view.targetY = entity.y;
        if (entity.dir >= 0) this.facing.set(id, entity.dir);
      });
      $(entity).listen("alive", (alive: boolean) => {
        // Un mort de PNJ ressemble exactement à un mort de joueur.
        if (!alive) body.setFillStyle(0x6b6b6b).setStrokeStyle(2, 0x2a2a2a).setAlpha(0.75).setDepth(DEPTH.deadBody);
      });
    });

    $(room.state).entities.onRemove((_entity: any, id: string) => {
      this.entities.get(id)?.object.destroy();
      this.entities.delete(id);
      this.facing.delete(id);
    });

    $(room.state).crosshairs.onAdd((crosshair: any, id: string) => {
      const graphics = this.add.graphics().setPosition(crosshair.x, crosshair.y).setDepth(DEPTH.crosshair);
      const view = { object: graphics, targetX: crosshair.x, targetY: crosshair.y };
      this.crosshairs.set(id, view);
      const redraw = () => drawCrosshair(graphics, CROSSHAIR_COLORS[crosshair.color] ?? 0xffffff, crosshair.loaded);
      $(crosshair).onChange(() => {
        view.targetX = crosshair.x;
        view.targetY = crosshair.y;
      });
      $(crosshair).listen("loaded", redraw);
      $(crosshair).listen("color", redraw);
    });

    $(room.state).crosshairs.onRemove((_crosshair: any, id: string) => {
      this.crosshairs.get(id)?.object.destroy();
      this.crosshairs.delete(id);
    });

    $(room.state).listen("phase", (phase: Phase) => this.onPhase(phase));
    $(room.state).listen("countdown", () => this.refreshBanner());
    $(room.state).listen("modeId", (modeId: ModeId) => this.setModeView(modeId));
    $(room.state).listen("timeLeft", () => this.refreshStatus());

    room.onMessage(MSG.assign, (message: AssignMessage) => {
      this.myEntityId = message.entityId;
      this.myCrosshairId = message.crosshairId ?? undefined;
      this.aimSynced = false;
      // Nouvelle manche : le serveur repart d'une entité immobile, l'envoi aussi.
      this.sender.reset();
    });

    room.onMessage(MSG.shot, (message: ShotMessage) => this.showShot(message));
    room.onMessage(MSG.knife, (message: KnifeMessage) => this.showKnife(message));
    room.onMessage(MSG.reveal, (message: RevealMessage) => this.showResults(message));
  }

  private onPhase(phase: Phase) {
    this.refreshStatus();
    if (phase !== "roundEnd") this.clearResults();
    this.refreshBanner();
  }

  /** Bandeau du haut : manche, temps restant (si le mode en a), consignes du mode. */
  private refreshStatus() {
    const state = this.room?.state;
    if (!state || !this.created) return;
    const hint = this.view?.hints[state.phase];
    if (!hint) return void this.status.setText("");
    const parts = [`Manche ${state.round}/${state.totalRounds}`];
    if (state.timeLeft > 0) parts.push(formatTime(state.timeLeft));
    parts.push(hint);
    this.status.setText(parts.join(" · "));
  }

  private refreshBanner() {
    const state = this.room?.state;
    if (!state) return;
    if (state.phase === "countdown") this.banner.setText(String(state.countdown));
    else if (state.phase === "playing") this.flash(this.banner, "Partez !");
    else if (state.phase !== "roundEnd") this.banner.setText("");
  }

  private flash(text: Phaser.GameObjects.Text, content: string, ms = 800) {
    text.setText(content);
    this.time.delayedCall(ms, () => {
      if (text.text === content) text.setText("");
    });
  }

  private showShot({ x, y, victim }: ShotMessage) {
    const burst = this.add.circle(x, y, 6, 0xffffff, 0.9).setDepth(30);
    this.tweens.add({ targets: burst, radius: 28, alpha: 0, duration: 350, onComplete: () => burst.destroy() });
    const message = victim === "player" ? "Un joueur est éliminé !" : victim === "npc" ? "Raté : c'était un PNJ" : "Tir dans le vide";
    this.flash(this.toast, message, 1800);
  }

  /**
   * Coup de couteau : un éclair et une entaille devant le personnage. Dessiné SOUS
   * l'obscurité : bien visible dans la lumière, à peine dans le noir.
   */
  private showKnife({ entityId, victim }: KnifeMessage) {
    const view = this.entities.get(entityId);
    if (view) {
      const [vx, vy] = DIR_VECTORS[this.facing.get(entityId) ?? 0];
      const angle = Math.atan2(vy, vx);
      const reach = ENTITY_RADIUS + 10;
      const slash = this.add.graphics().setPosition(view.object.x, view.object.y).setDepth(DEPTH.effect);
      slash.lineStyle(4, 0xffffff, 1).beginPath();
      slash.arc(0, 0, reach, angle - 1, angle + 1);
      slash.strokePath();
      slash.fillStyle(0xfff3c4, 0.9).fillCircle(Math.cos(angle) * reach, Math.sin(angle) * reach, 5);
      this.tweens.add({ targets: slash, alpha: 0, scale: 1.3, duration: 400, onComplete: () => slash.destroy() });
    }
    // Seule la mort d'un joueur est annoncée : un PNJ tué dans l'ombre passe inaperçu.
    if (victim === "player") this.flash(this.toast, "Un joueur a été poignardé !", 1800);
  }

  private showResults({ winnerPlayerId, winnerEntityId, players }: RevealMessage) {
    const state = this.room!.state;
    // Fin de manche : on révèle tous les joueurs (avec leur pseudo), le gagnant en doré.
    for (const { playerId, entityId } of players) {
      const view = this.entities.get(entityId);
      const info = state.players.get(playerId);
      if (!view || !info) continue;
      const isWinner = entityId === winnerEntityId;
      const ring = this.add
        .circle(view.targetX, view.targetY, ENTITY_RADIUS + (isWinner ? 9 : 5))
        .setStrokeStyle(isWinner ? 5 : 3, isWinner ? 0xffd34d : CROSSHAIR_COLORS[info.color] ?? 0xffffff)
        .setDepth(DEPTH.reveal);
      const label = this.add
        .text(view.targetX, view.targetY - ENTITY_RADIUS - 14, info.name, {
          fontFamily: "sans-serif", fontSize: "14px", color: "#ffffff", stroke: "#000000", strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.reveal);
      this.revealObjects.push(ring, label);
    }

    const winner = winnerPlayerId ? state.players.get(winnerPlayerId) : undefined;
    const text = !winnerPlayerId ? "Personne\nne gagne" : winnerPlayerId === this.room!.sessionId ? "Victoire !" : `Victoire de\n${winner?.name ?? "?"}`;
    this.banner.setText(text);
  }

  private clearResults() {
    for (const object of this.revealObjects) object.destroy();
    this.revealObjects = [];
  }

  update(time: number, deltaMs: number) {
    // Même interpolation pour tout le monde, y compris nous :
    // pas de prédiction locale, sinon notre perso réagirait plus vite que les autres.
    const alpha = 1 - Math.exp(-SMOOTHING * (deltaMs / 1000));
    for (const views of [this.entities, this.crosshairs]) {
      for (const view of views.values()) {
        view.object.x += (view.targetX - view.object.x) * alpha;
        view.object.y += (view.targetY - view.object.y) * alpha;
      }
    }

    if (this.room) this.view?.update(this.room.state, deltaMs / 1000);
    this.syncAimWithCrosshair();
    const frame = this.inputs.read(deltaMs / 1000);
    this.sendInputs(frame, time);
    this.updateAimGhost(frame);
  }

  /** En début de manche, la visée repart de la position réelle de notre viseur. */
  private syncAimWithCrosshair() {
    if (this.aimSynced || !this.myCrosshairId) return;
    const crosshair = this.crosshairs.get(this.myCrosshairId);
    if (!crosshair) return;
    this.inputs.setAim(crosshair.targetX, crosshair.targetY);
    this.aimSynced = true;
  }

  private sendInputs(frame: InputFrame, time: number) {
    const room = this.room;
    const phase = room?.state.phase;
    if (!room) return;
    // Entrée / Start servent à se déclarer prêt dans le salon (utile à la manette).
    if (frame.start && phase === "lobby") this.hooks?.toggleReady();

    for (const { type, message } of this.sender.update(frame, phase, time, room.state.modeId)) room.send(type, message);
  }

  private updateAimGhost(frame: InputFrame) {
    // Point de visée local : la cible vers laquelle notre viseur se dirige.
    const hasCrosshair = !!this.myCrosshairId && this.crosshairs.has(this.myCrosshairId);
    this.aimGhost.setVisible(hasCrosshair).setPosition(frame.aim.x, frame.aim.y);
  }
}

function drawCrosshair(g: Phaser.GameObjects.Graphics, color: number, loaded: boolean) {
  const r = CROSSHAIR_RADIUS;
  g.clear();
  g.lineStyle(2.5, color, 1).strokeCircle(0, 0, r);
  g.lineBetween(-r - 5, 0, -r + 5, 0).lineBetween(r - 5, 0, r + 5, 0);
  g.lineBetween(0, -r - 5, 0, -r + 5).lineBetween(0, r - 5, 0, r + 5);
  // Point plein = balle disponible ; vide = déjà tiré.
  if (loaded) g.fillStyle(color, 1).fillCircle(0, 0, 3);
  else g.lineStyle(1.5, color, 0.8).strokeCircle(0, 0, 3);
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
