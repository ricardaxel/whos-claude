import Phaser from "phaser";
import { renderDungeon, ROOM_HEIGHT, ROOM_SCALE, ROOM_WIDTH, TORCH_FLAMES } from "../sprites/dungeon";
import { DEPTH } from "./depth";

const ROOM_TEXTURE = "dungeon-room";
const GLOW_TEXTURE = "torch-glow";
const GLOW_RADIUS = 48;

/**
 * Salle de donjon commune aux modes : une image générée une seule fois (éclairage
 * compris), plus un halo chaud qui vacille devant chaque torche.
 */
export class DungeonBackdrop {
  private room: Phaser.GameObjects.Image;
  private glows: Phaser.GameObjects.Image[];

  constructor(scene: Phaser.Scene) {
    if (!scene.textures.exists(ROOM_TEXTURE)) {
      const texture = scene.textures.createCanvas(ROOM_TEXTURE, ROOM_WIDTH, ROOM_HEIGHT)!;
      texture.getContext().putImageData(new ImageData(renderDungeon(), ROOM_WIDTH, ROOM_HEIGHT), 0, 0);
      texture.refresh();
    }
    if (!scene.textures.exists(GLOW_TEXTURE)) createGlowTexture(scene);

    this.room = scene.add.image(0, 0, ROOM_TEXTURE).setOrigin(0).setScale(ROOM_SCALE).setDepth(DEPTH.decor);
    this.glows = TORCH_FLAMES.map((flame) => {
      const glow = scene.add
        .image(flame.x, flame.y, GLOW_TEXTURE)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.35)
        .setDepth(DEPTH.decor + 0.2);
      // Vacillement : chaque flamme à son rythme, pour ne pas battre à l'unisson.
      scene.tweens.add({
        targets: glow,
        alpha: { from: 0.25, to: 0.45 },
        scale: { from: 0.95, to: 1.08 },
        duration: 180 + Math.random() * 220,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: Math.random() * 300,
      });
      return glow;
    });
  }

  destroy() {
    this.room.destroy();
    for (const glow of this.glows) glow.destroy();
  }
}

/** Disque orangé à bord doux, ajouté en mode additif devant chaque torche. */
function createGlowTexture(scene: Phaser.Scene) {
  const size = GLOW_RADIUS * 2;
  const canvas = scene.textures.createCanvas(GLOW_TEXTURE, size, size)!;
  const ctx = canvas.getContext();
  const gradient = ctx.createRadialGradient(GLOW_RADIUS, GLOW_RADIUS, 0, GLOW_RADIUS, GLOW_RADIUS, GLOW_RADIUS);
  gradient.addColorStop(0, "rgba(255,190,90,0.9)");
  gradient.addColorStop(0.4, "rgba(240,130,40,0.35)");
  gradient.addColorStop(1, "rgba(240,130,40,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  canvas.refresh();
}
