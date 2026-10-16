import Phaser from "phaser";
import { Client, getStateCallbacks, Room } from "colyseus.js";
import {
  ARENA, AssignMessage, CROSSHAIR_COLORS, Dir, FireMessage, ENTITY_RADIUS, IDLE, InputMessage, MSG, Phase, RACE,
  RevealMessage, ROOM_NAME, SERVER_PORT, ShotMessage, TICK_RATE,
} from "@whosclaude/shared";
import { InputManager } from "./input/InputManager";
import { GamepadSource } from "./input/GamepadSource";
import { KeyboardMouseSource } from "./input/KeyboardMouseSource";
import { TouchSource } from "./input/TouchSource";
import type { InputFrame } from "./input/types";

/** Vitesse de convergence de l'interpolation (plus haut = plus réactif). */
const SMOOTHING = 12;
const REVEAL_ON_ASSIGN_MS = 2000;
const SEND_INTERVAL_MS = 1000 / TICK_RATE;
const FORWARD: Dir = 0;
const CROSSHAIR_RADIUS = 14;

const HUD_TEXT: Record<Phase, string> = {
  lobby: "Entrée / Start pour lancer · Maj pour te repérer",
  countdown: "Prépare-toi…",
  racing: "Avance (Espace, RT) · Vise et tire (clic, RB) · Une seule balle !",
  finished: "",
};

interface View<T extends Phaser.GameObjects.GameObject> {
  object: T;
  targetX: number;
  targetY: number;
}

export class GameScene extends Phaser.Scene {
  private room?: Room;
  private inputs!: InputManager;
  private entities = new Map<string, View<Phaser.GameObjects.Arc>>();
  private crosshairs = new Map<string, View<Phaser.GameObjects.Graphics>>();
  private myEntityId?: string;
  private myCrosshairId?: string;
  private aimSynced = false;
  private revealUntil = 0;
  private lastSent = { dir: IDLE as Dir, x: 0, y: 0, at: 0 };

  private marker!: Phaser.GameObjects.Arc;
  private aimGhost!: Phaser.GameObjects.Arc;
  private status!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private revealRings: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super("game");
  }

  async create() {
    this.inputs = new InputManager([new KeyboardMouseSource(this), new GamepadSource(this), new TouchSource(this)]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.inputs.destroy());
    this.input.setDefaultCursor("none");

    this.drawTrack();
    this.marker = this.add.circle(0, 0, ENTITY_RADIUS + 6).setStrokeStyle(3, 0xffd34d).setVisible(false).setDepth(10);
    this.aimGhost = this.add.circle(0, 0, 3, 0xffffff, 0.8).setVisible(false).setDepth(26);
    this.status = this.add.text(12, 10, "Connexion…", { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff" }).setDepth(40);
    this.toast = this.add
      .text(ARENA.width / 2, 40, "", { fontFamily: "sans-serif", fontSize: "22px", fontStyle: "bold", color: "#ffffff", stroke: "#000000", strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(40);
    this.banner = this.add
      .text(ARENA.width / 2, ARENA.height / 2, "", {
        fontFamily: "sans-serif", fontSize: "56px", fontStyle: "bold", color: "#ffffff",
        stroke: "#000000", strokeThickness: 6, align: "center",
      })
      .setOrigin(0.5)
      .setDepth(40);

    try {
      const client = new Client(`ws://${location.hostname}:${SERVER_PORT}`);
      this.room = await client.joinOrCreate(ROOM_NAME);
    } catch (error) {
      this.status.setText("Impossible de rejoindre le serveur. Est-il lancé ?");
      console.error(error);
      return;
    }

    this.bindRoom(this.room);
  }

  private drawTrack() {
    const g = this.add.graphics();
    // Ligne de départ, juste derrière les personnages.
    g.fillStyle(0xffffff, 0.5).fillRect(RACE.startX - ENTITY_RADIUS - 6, 0, 3, ARENA.height);
    // Ligne d'arrivée en damier.
    const size = 10;
    for (let row = 0; row * size < ARENA.height; row++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle((row + col) % 2 === 0 ? 0xffffff : 0x000000, 0.8);
        g.fillRect(RACE.finishX + col * size, row * size, size, size);
      }
    }
  }

  private bindRoom(room: Room) {
    const $ = getStateCallbacks(room);

    $(room.state).entities.onAdd((entity: any, id: string) => {
      const body = this.add.circle(entity.x, entity.y, ENTITY_RADIUS, 0xd9c8a9).setStrokeStyle(2, 0x3b2f22).setDepth(5);
      const view = { object: body, targetX: entity.x, targetY: entity.y };
      this.entities.set(id, view);
      $(entity).onChange(() => {
        view.targetX = entity.x;
        view.targetY = entity.y;
      });
      $(entity).listen("alive", (alive: boolean) => {
        // Un mort de PNJ ressemble exactement à un mort de joueur.
        if (!alive) body.setFillStyle(0x6b6b6b).setStrokeStyle(2, 0x2a2a2a).setAlpha(0.75).setDepth(1);
      });
    });

    $(room.state).entities.onRemove((_entity: any, id: string) => {
      this.entities.get(id)?.object.destroy();
      this.entities.delete(id);
    });

    $(room.state).crosshairs.onAdd((crosshair: any, id: string) => {
      const graphics = this.add.graphics().setPosition(crosshair.x, crosshair.y).setDepth(25);
      const view = { object: graphics, targetX: crosshair.x, targetY: crosshair.y };
      this.crosshairs.set(id, view);
      $(crosshair).onChange(() => {
        view.targetX = crosshair.x;
        view.targetY = crosshair.y;
        drawCrosshair(graphics, CROSSHAIR_COLORS[crosshair.color] ?? 0xffffff, crosshair.loaded);
      });
      drawCrosshair(graphics, CROSSHAIR_COLORS[crosshair.color] ?? 0xffffff, crosshair.loaded);
    });

    $(room.state).crosshairs.onRemove((_crosshair: any, id: string) => {
      this.crosshairs.get(id)?.object.destroy();
      this.crosshairs.delete(id);
    });

    $(room.state).listen("phase", (phase: Phase) => this.onPhase(phase));
    $(room.state).listen("countdown", () => this.refreshBanner());

    room.onMessage(MSG.assign, (message: AssignMessage) => {
      this.myEntityId = message.entityId;
      this.myCrosshairId = message.crosshairId;
      this.aimSynced = false;
      this.revealUntil = this.time.now + REVEAL_ON_ASSIGN_MS;
    });

    room.onMessage(MSG.shot, (message: ShotMessage) => this.showShot(message));
    room.onMessage(MSG.reveal, (message: RevealMessage) => this.showResults(message));

    room.onLeave(() => this.status.setText("Déconnecté du serveur."));
  }

  private onPhase(phase: Phase) {
    document.body.dataset.phase = phase;
    this.status.setText(HUD_TEXT[phase]);
    if (phase === "lobby") this.clearResults();
    this.refreshBanner();
  }

  private refreshBanner() {
    const state = this.room?.state;
    if (!state) return;
    if (state.phase === "countdown") this.banner.setText(String(state.countdown));
    else if (state.phase === "racing") this.flash(this.banner, "Partez !");
    else if (state.phase === "lobby") this.banner.setText("");
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

  private showResults({ winnerEntityId, playerEntityIds }: RevealMessage) {
    // Fin de manche : on révèle tous les joueurs, le gagnant en doré.
    for (const id of playerEntityIds) {
      const view = this.entities.get(id);
      if (!view) continue;
      const isWinner = id === winnerEntityId;
      const ring = this.add
        .circle(view.targetX, view.targetY, ENTITY_RADIUS + (isWinner ? 9 : 5))
        .setStrokeStyle(isWinner ? 5 : 3, isWinner ? 0xffd34d : 0xff5a5a)
        .setDepth(15);
      this.revealRings.push(ring);
    }
    const text = winnerEntityId === null ? "Personne\nne gagne" : winnerEntityId === this.myEntityId ? "Victoire !" : "Un autre joueur\na gagné !";
    this.banner.setText(text);
  }

  private clearResults() {
    for (const ring of this.revealRings) ring.destroy();
    this.revealRings = [];
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

    this.syncAimWithCrosshair();
    const frame = this.inputs.read(deltaMs / 1000);
    this.sendInputs(frame, time);
    this.updateMarker(time, frame);
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
    if (!room) return;
    if (frame.start && room.state.phase === "lobby") room.send(MSG.start);
    if (frame.fire) {
      const fire: FireMessage = { aimX: frame.aim.x, aimY: frame.aim.y };
      room.send(MSG.fire, fire);
    }

    const dir: Dir = frame.advance ? FORWARD : IDLE;
    const aimMoved = frame.aim.x !== this.lastSent.x || frame.aim.y !== this.lastSent.y;
    const dirChanged = dir !== this.lastSent.dir;
    if (!dirChanged && !(aimMoved && time - this.lastSent.at >= SEND_INTERVAL_MS)) return;

    const message: InputMessage = { dir, aimX: frame.aim.x, aimY: frame.aim.y };
    room.send(MSG.input, message);
    this.lastSent = { dir, x: frame.aim.x, y: frame.aim.y, at: time };
  }

  private updateMarker(time: number, frame: InputFrame) {
    const mine = this.myEntityId ? this.entities.get(this.myEntityId) : undefined;
    const visible = !!mine && (frame.reveal || time < this.revealUntil);
    this.marker.setVisible(visible);
    if (visible && mine) this.marker.setPosition(mine.object.x, mine.object.y);

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
