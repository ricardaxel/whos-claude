import Phaser from "phaser";
import { Client, getStateCallbacks, Room } from "colyseus.js";
import {
  ARENA, AssignMessage, Dir, ENTITY_RADIUS, IDLE, InputMessage, MSG, Phase, RACE,
  RevealMessage, ROOM_NAME, SERVER_PORT,
} from "@whosclaude/shared";

/** Vitesse de convergence de l'interpolation (plus haut = plus réactif). */
const SMOOTHING = 12;
const REVEAL_ON_ASSIGN_MS = 2000;
const FORWARD: Dir = 0;

const HUD_TEXT: Record<Phase, string> = {
  lobby: "Entrée pour lancer la course · Maj pour te repérer",
  countdown: "Prépare-toi…",
  racing: "Maintiens Espace ou → pour avancer · Ne te fais pas repérer !",
  finished: "",
};

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

  private keys!: Record<"advance" | "right" | "d" | "start" | "reveal", Phaser.Input.Keyboard.Key>;
  private marker!: Phaser.GameObjects.Arc;
  private status!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private revealRings: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super("game");
  }

  async create() {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      advance: K.SPACE, right: K.RIGHT, d: K.D, start: K.ENTER, reveal: K.SHIFT,
    }) as typeof this.keys;

    this.drawTrack();
    this.marker = this.add.circle(0, 0, ENTITY_RADIUS + 6).setStrokeStyle(3, 0xffd34d).setVisible(false).setDepth(10);
    this.status = this.add.text(12, 10, "Connexion…", { fontFamily: "sans-serif", fontSize: "16px", color: "#ffffff" }).setDepth(20);
    this.banner = this.add
      .text(ARENA.width / 2, ARENA.height / 2, "", {
        fontFamily: "sans-serif", fontSize: "56px", fontStyle: "bold", color: "#ffffff",
        stroke: "#000000", strokeThickness: 6, align: "center",
      })
      .setOrigin(0.5)
      .setDepth(30);

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

    $(room.state).listen("phase", (phase: Phase) => this.onPhase(phase));
    $(room.state).listen("countdown", () => this.refreshBanner());

    room.onMessage(MSG.assign, (message: AssignMessage) => {
      this.myEntityId = message.entityId;
      this.revealUntil = this.time.now + REVEAL_ON_ASSIGN_MS;
    });

    room.onMessage(MSG.reveal, (message: RevealMessage) => this.showResults(message));

    room.onLeave(() => this.status.setText("Déconnecté du serveur."));
  }

  private onPhase(phase: Phase) {
    this.status.setText(HUD_TEXT[phase]);
    if (phase === "lobby") this.clearResults();
    this.refreshBanner();
  }

  private refreshBanner() {
    const state = this.room?.state;
    if (!state) return;
    if (state.phase === "countdown") this.banner.setText(String(state.countdown));
    else if (state.phase === "racing") this.flashBanner("Partez !");
    else if (state.phase === "lobby") this.banner.setText("");
  }

  private flashBanner(text: string) {
    this.banner.setText(text);
    this.time.delayedCall(800, () => {
      if (this.banner.text === text) this.banner.setText("");
    });
  }

  private showResults({ winnerEntityId, playerEntityIds }: RevealMessage) {
    // Fin de manche : on révèle tous les joueurs, le gagnant en doré.
    for (const id of playerEntityIds) {
      const view = this.views.get(id);
      if (!view) continue;
      const isWinner = id === winnerEntityId;
      const ring = this.add
        .circle(view.targetX, view.targetY, ENTITY_RADIUS + (isWinner ? 9 : 5))
        .setStrokeStyle(isWinner ? 5 : 3, isWinner ? 0xffd34d : 0xff5a5a)
        .setDepth(15);
      this.revealRings.push(ring);
    }
    this.banner.setText(winnerEntityId === this.myEntityId ? "Victoire !" : "Un autre joueur\na gagné !");
  }

  private clearResults() {
    for (const ring of this.revealRings) ring.destroy();
    this.revealRings = [];
  }

  update(time: number, deltaMs: number) {
    // Même interpolation pour toutes les entités, y compris la nôtre :
    // pas de prédiction locale, sinon notre perso réagirait plus vite que les autres.
    const alpha = 1 - Math.exp(-SMOOTHING * (deltaMs / 1000));
    for (const view of this.views.values()) {
      view.body.x += (view.targetX - view.body.x) * alpha;
      view.body.y += (view.targetY - view.body.y) * alpha;
    }

    this.handleKeys();
    this.updateMarker(time);
  }

  private handleKeys() {
    if (!this.room) return;
    if (Phaser.Input.Keyboard.JustDown(this.keys.start) && this.room.state.phase === "lobby") {
      this.room.send(MSG.start);
    }

    const k = this.keys;
    const dir: Dir = k.advance.isDown || k.right.isDown || k.d.isDown ? FORWARD : IDLE;
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
