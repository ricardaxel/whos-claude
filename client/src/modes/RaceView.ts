import type Phaser from "phaser";
import { ENTITY_RADIUS, PLAYFIELD, RACE } from "@whosclaude/shared";
import { DEPTH } from "./depth";
import { DungeonBackdrop } from "./DungeonBackdrop";
import type { ModeView } from "./ModeView";

/** Course : la salle de donjon, une ligne de départ et une ligne d'arrivée en damier. */
export class RaceView implements ModeView {
  readonly hints = {
    countdown: "Prépare-toi… Lequel es-tu ? Bouge pour le découvrir.",
    playing: "Avance (Espace, RT) · Sprint (Maj+Espace, LB) : ça se voit ! · Vise et tire (clic, RB) · Une balle",
  };

  /** Tout le monde regarde la ligne d'arrivée. */
  readonly initialFacing = "right" as const;

  private backdrop: DungeonBackdrop;
  private track: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.backdrop = new DungeonBackdrop(scene);
    const g = scene.add.graphics().setDepth(DEPTH.decor + 0.1);
    const height = PLAYFIELD.bottom - PLAYFIELD.top;
    // Ligne de départ, juste derrière les personnages, tracée à la craie sur les dalles.
    g.fillStyle(0xe8e0d0, 0.45).fillRect(RACE.startX - ENTITY_RADIUS - 6, PLAYFIELD.top, 3, height);
    // Ligne d'arrivée en damier, d'un mur à l'autre.
    const size = 8;
    for (let row = 0; row * size < height; row++) {
      for (let col = 0; col < 2; col++) {
        g.fillStyle((row + col) % 2 === 0 ? 0xe8e0d0 : 0x1a1020, 0.7);
        g.fillRect(RACE.finishX + col * size, PLAYFIELD.top + row * size, size, Math.min(size, height - row * size));
      }
    }
    this.track = g;
  }

  update() {}

  destroy() {
    this.backdrop.destroy();
    this.track.destroy();
  }
}
