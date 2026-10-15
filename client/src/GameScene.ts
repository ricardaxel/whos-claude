import Phaser from "phaser";
import { Client, getStateCallbacks, Room } from "colyseus.js";
import {
  AssignMessage, dirFromAxes, Dir, ENTITY_RADIUS, IDLE, InputMessage, MSG, ROOM_NAME, SERVER_PORT,
} from "@whosclaude/shared";

/** Vitesse de convergence de l'interpolation (plus haut = plus réactif). */
const SMOOTHING = 12;
const REVEAL_ON_ASSIGN_MS = 2000;

interface View {
  body: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

export class GameScene extends Phaser.Scene {
  private room?: Room;
  private views = new Map<string, View>();
  private myEntityId?: string;
  private revealUntil = 0;
  private lastSentDir: Dir = IDLE;

  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "reveal", Phaser.Input.Keyboard.Key>;
  private marker!: Phaser.GameObjects.Arc;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super("game");
  }

  async create() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.Z, a: K.Q, s: K.S, d: K.D, reveal: K.SHIFT,
    }) as typeof this.keys;

    this.marker = this.add.circle(0, 0, ENTITY_RADIUS + 6).setStrokeStyle(3, 0xffd34d).setVisible(false).setDepth(10);
    this.status = this.add.text(12, 10, "Connexion…", { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff" }).setDepth(20);

    try {
      const client = new Client(`ws://${location.hostname}:${SERVER_PORT}`);
      this.room = await client.joinOrCreate(ROOM_NAME);
    } catch (error) {
      this.status.setText("Impossible de rejoindre le serveur. Est-il lancé ?");
      console.error(error);
      return;
    }

    this.status.setText("ZQSD / flèches pour bouger · Maj pour te repérer");
    this.bindRoom(this.room);
  }

  private bindRoom(room: Room) {
    const $ = getStateCallbacks(room);

    $(room.state).entities.onAdd((entity: any, id: string) => {
      const body = this.add.circle(entity.x, entity.y, ENTITY_RADIUS, 0xd9c8a9).setStrokeStyle(2, 0x3b2f22);
      const view: View = { body, targetX: entity.x, targetY: entity.y };
      this.views.set(id, view);
      $(entity).onChange(() => {
        view.targetX = entity.x;
        view.targetY = entity.y;
      });
    });

    $(room.state).entities.onRemove((_entity: any, id: string) => {
      this.views.get(id)?.body.destroy();
      this.views.delete(id);
    });

    room.onMessage(MSG.assign, (message: AssignMessage) => {
      this.myEntityId = message.entityId;
      this.revealUntil = this.time.now + REVEAL_ON_ASSIGN_MS;
    });

    room.onLeave(() => this.status.setText("Déconnecté du serveur."));
  }

  update(time: number, deltaMs: number) {
    // Même interpolation pour toutes les entités, y compris la nôtre :
    // pas de prédiction locale, sinon notre perso réagirait plus vite que les autres.
    const alpha = 1 - Math.exp(-SMOOTHING * (deltaMs / 1000));
    for (const view of this.views.values()) {
      view.body.x += (view.targetX - view.body.x) * alpha;
      view.body.y += (view.targetY - view.body.y) * alpha;
    }

    this.sendInput();
    this.updateMarker(time);
  }

  private sendInput() {
    if (!this.room) return;
    const k = this.keys;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    const dir = dirFromAxes(dx, dy);
    if (dir === this.lastSentDir) return;
    this.lastSentDir = dir;
    const message: InputMessage = { dir };
    this.room.send(MSG.input, message);
  }

  private updateMarker(time: number) {
    const mine = this.myEntityId ? this.views.get(this.myEntityId) : undefined;
    const visible = !!mine && (this.keys.reveal.isDown || time < this.revealUntil);
    this.marker.setVisible(visible);
    if (visible && mine) this.marker.setPosition(mine.body.x, mine.body.y);
  }
}
