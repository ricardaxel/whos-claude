import type Phaser from "phaser";
import { ARENA, ENTITY_RADIUS, RACE } from "@whosclaude/shared";
import { DEPTH } from "./depth";
import type { ModeView } from "./ModeView";

/** Course : ligne de départ et ligne d'arrivée en damier. */
export class RaceView implements ModeView {
  readonly hints = {
    countdown: "Prépare-toi… Lequel es-tu ? Bouge pour le découvrir.",
    playing: "Avance (Espace, RT) · Sprint (Maj+Espace, LB) : ça se voit ! · Vise et tire (clic, RB) · Une balle",
  };

  private track: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    const g = scene.add.graphics().setDepth(DEPTH.decor);
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
    this.track = g;
  }

  update() {}

  destroy() {
    this.track.destroy();
  }
}
