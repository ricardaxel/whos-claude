import Phaser from "phaser";
import { getStateCallbacks } from "colyseus.js";
import {
  ARENA, AssignMessage, CROSSHAIR_COLORS, DIR_VECTORS, ENTITY_RADIUS, KnifeMessage, ModeId, MSG, Phase,
  RevealMessage, ShotMessage,
} from "@whosclaude/shared";
import type { GameRoom } from "./net";
import { InputManager } from "./input/InputManager";
import { InputSender } from "./input/InputSender";
import { onFocusLost } from "./input/focus";
import { GamepadSource } from "./input/GamepadSource";
import { KeyboardMouseSource } from "./input/KeyboardMouseSource";
import { TouchSource } from "./input/TouchSource";
import type { InputFrame } from "./input/types";
import { DEPTH, MODE_VIEWS, type ModeView } from "./modes/ModeView";
import { facingFromDir, WALK_CYCLE, WALK_FRAME_MS, type Facing } from "./sprites/characters";
import { frameName, lookTexture, registerCharacterTextures } from "./sprites/textures";
import { CROSSHAIR_EMPTY, CROSSHAIR_LOADED, deathEffect, knifeEffect, registerEffectTextures, shotEffect } from "./effects";
import { GOLD, INK, PIXEL_FONT, RetroWindow } from "./ui/retro";

/** Vitesse de convergence de l'interpolation (plus haut = plus réactif). */
const SMOOTHING = 12;

/** Ce que la session peut demander à la scène. */
export interface SceneHooks {
  toggleReady(): void;
}

interface View<T extends Phaser.GameObjects.GameObject> {
  object: T;
  targetX: number;
  targetY: number;
}

/** Personnage affiché : sprite animé selon son orientation et s'il marche. */
interface CharacterView extends View<Phaser.GameObjects.Sprite> {
  facing: Facing;
  moving: boolean;
  alive: boolean;
  /** Dernière image et dernière hauteur affichées : on ne touche au sprite que si elles changent. */
  frame: string;
  depthY: number;
}

/** Les sprites 16×16 sont affichés à ×2. */
const SPRITE_SCALE = 2;

/**
 * Rendu et inputs d'une manche. La scène ne se connecte pas elle-même :
 * la session lui confie la room (attach) et la lui reprend (detach).
 */
export class GameScene extends Phaser.Scene {
  private room?: GameRoom;
  private hooks?: SceneHooks;
  private created = false;
  private inputs!: InputManager;
  private entities = new Map<string, CharacterView>();
  private crosshairs = new Map<string, View<Phaser.GameObjects.Image>>();
  private myEntityId?: string;
  private myCrosshairId?: string;
  private aimSynced = false;
  private sender = new InputSender();
  private view?: ModeView;
  private viewMode?: ModeId;
  /** Dernière direction non nulle de chaque entité : orientation du coup de couteau. */
  private facing = new Map<string, number>();

  private aimGhost!: Phaser.GameObjects.Rectangle;
  private status!: RetroWindow;
  private banner!: RetroWindow;
  private toast!: RetroWindow;
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
    // Onglet ou appli en arrière-plan : on lâche les commandes, côté serveur aussi.
    const stopListening = onFocusLost(() => this.releaseInputs());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputs.destroy();
      stopListening();
    });
    this.input.setDefaultCursor("none");
    registerCharacterTextures(this);
    registerEffectTextures(this);

    // Point de visée local : un petit carré, comme un curseur de vieux RPG.
    this.aimGhost = this.add.rectangle(0, 0, 4, 4, 0xffffff, 0.9).setStrokeStyle(1, 0x000000).setVisible(false).setDepth(DEPTH.aimGhost);
    // Interface en fenêtres façon Dragon Quest : bandeau en haut, messages dessous, bannière au centre.
    this.status = new RetroWindow(this, ARENA.width / 2, 10, { fontSize: 14, anchor: "top", depth: DEPTH.hud });
    this.toast = new RetroWindow(this, ARENA.width / 2, 52, { fontSize: 18, anchor: "top", depth: DEPTH.hud });
    this.banner = new RetroWindow(this, ARENA.width / 2, ARENA.height / 2, { fontSize: 40, anchor: "center", depth: DEPTH.hud });

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
      const facing = this.view?.initialFacing ?? "down";
      const sprite = this.add
        .sprite(entity.x, entity.y, lookTexture(entity.look ?? 0), frameName(facing, 0))
        .setScale(SPRITE_SCALE)
        .setDepth(DEPTH.entity);
      const view: CharacterView = { object: sprite, targetX: entity.x, targetY: entity.y, facing, moving: false, alive: true, frame: frameName(facing, 0), depthY: NaN };
      this.entities.set(id, view);
      $(entity).onChange(() => {
        view.targetX = entity.x;
        view.targetY = entity.y;
        view.moving = entity.dir >= 0;
        view.facing = facingFromDir(entity.dir, view.facing);
        if (entity.dir >= 0) this.facing.set(id, entity.dir);
      });
      $(entity).listen("look", (look: number) => sprite.setTexture(lookTexture(look), frameName(view.facing, 0)));
      $(entity).listen("alive", (alive: boolean, previous?: boolean) => {
        view.alive = alive;
        if (alive) return;
        // Un mort de PNJ ressemble exactement à un mort de joueur : couché et grisé.
        sprite.setFrame(frameName(view.facing, 0));
        if (previous === true) deathEffect(this, sprite);
        else sprite.setTint(0x8a8a8a).setAngle(-90).setAlpha(0.85).setDepth(DEPTH.deadBody); // déjà mort à l'arrivée
      });
    });

    $(room.state).entities.onRemove((_entity: any, id: string) => {
      this.entities.get(id)?.object.destroy();
      this.entities.delete(id);
      this.facing.delete(id);
    });

    $(room.state).crosshairs.onAdd((crosshair: any, id: string) => {
      const image = this.add.image(crosshair.x, crosshair.y, CROSSHAIR_LOADED).setScale(2).setDepth(DEPTH.crosshair);
      const view = { object: image, targetX: crosshair.x, targetY: crosshair.y };
      this.crosshairs.set(id, view);
      // Viseur pixel teinté à la couleur du joueur ; centre plein = balle disponible.
      const redraw = () =>
        image.setTexture(crosshair.loaded ? CROSSHAIR_LOADED : CROSSHAIR_EMPTY).setTint(CROSSHAIR_COLORS[crosshair.color] ?? 0xffffff);
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
    if (state.phase === "countdown") {
      if (this.banner.text !== String(state.countdown)) this.banner.setColor(INK).setText(String(state.countdown)).pop();
    } else if (state.phase === "playing") {
      this.flash(this.banner.setColor(GOLD), "Partez !").pop();
    } else if (state.phase !== "roundEnd") {
      this.banner.setText("");
    }
  }

  private flash(window: RetroWindow, content: string, ms = 800) {
    window.setText(content);
    this.time.delayedCall(ms, () => {
      if (window.text === content) window.setText("");
    });
    return window;
  }

  private showShot({ x, y, victim }: ShotMessage) {
    shotEffect(this, x, y, victim !== null);
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
      knifeEffect(this, view.object.x, view.object.y, Math.atan2(vy, vx));
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
        .circle(view.targetX, view.targetY, ENTITY_RADIUS + (isWinner ? 10 : 6))
        .setStrokeStyle(isWinner ? 4 : 3, isWinner ? 0xf2c45a : CROSSHAIR_COLORS[info.color] ?? 0xffffff)
        .setDepth(DEPTH.reveal);
      const label = this.add
        .text(view.targetX, view.targetY - ENTITY_RADIUS - 12, info.name, {
          fontFamily: PIXEL_FONT, fontSize: "14px", color: isWinner ? GOLD : INK, stroke: "#000000", strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.reveal);
      this.revealObjects.push(ring, label);
    }

    const winner = winnerPlayerId ? state.players.get(winnerPlayerId) : undefined;
    const text = !winnerPlayerId ? "Personne\nne gagne" : winnerPlayerId === this.room!.sessionId ? "Victoire !" : `Victoire de\n${winner?.name ?? "?"}`;
    this.banner.setColor(winnerPlayerId === this.room!.sessionId ? GOLD : INK).setText(text).pop();
  }

  private clearResults() {
    for (const object of this.revealObjects) object.destroy();
    this.revealObjects = [];
  }

  update(time: number, deltaMs: number) {
    // Même interpolation pour tout le monde, y compris nous :
    // pas de prédiction locale, sinon notre perso réagirait plus vite que les autres.
    const alpha = 1 - Math.exp(-SMOOTHING * (deltaMs / 1000));
    this.animateCharacters(time);
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

  /**
   * Marche en 4 temps quand l'entité se déplace, pose debout sinon. Même règle pour tout
   * le monde (joueurs et PNJ), calculée uniquement à partir de l'état public. Les plus bas
   * à l'écran passent devant, comme dans un vieux RPG.
   */
  private animateCharacters(time: number) {
    const step = WALK_CYCLE[Math.floor(time / WALK_FRAME_MS) % WALK_CYCLE.length];
    for (const view of this.entities.values()) {
      if (!view.alive) continue;
      const frame = frameName(view.facing, view.moving ? step : 0);
      if (frame !== view.frame) view.object.setFrame((view.frame = frame));
      // setDepth relance un tri de toute la scène : seulement quand le personnage a bougé d'un pixel.
      const y = Math.round(view.object.y);
      if (y !== view.depthY) view.object.setDepth(DEPTH.entity + (view.depthY = y) / ARENA.height / 2);
    }
  }

  /** En début de manche, la visée repart de la position réelle de notre viseur. */
  private syncAimWithCrosshair() {
    if (this.aimSynced || !this.myCrosshairId) return;
    const crosshair = this.crosshairs.get(this.myCrosshairId);
    if (!crosshair) return;
    this.inputs.setAim(crosshair.targetX, crosshair.targetY);
    this.aimSynced = true;
  }

  private releaseInputs() {
    const room = this.room;
    if (!room) return;
    for (const { type, message } of this.sender.release()) room.send(type, message);
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


function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
