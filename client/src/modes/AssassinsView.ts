import type Phaser from "phaser";
import { ARENA, ASSASSINS, type GameStateShape } from "@whosclaude/shared";
import { DEPTH } from "./depth";
import type { ModeView } from "./ModeView";

/** Opacité de l'obscurité : assez sombre pour cacher un geste, assez claire pour se déplacer. */
const DARKNESS_ALPHA = 0.72;
const LIGHT_TEXTURE = "assassins-light";
/** Vitesse de convergence de la lumière vers sa position serveur. */
const SMOOTHING = 8;

/**
 * Assassins : une salle sombre (plancher) et une lumière d'ambiance qui erre.
 * L'obscurité est une texture noire dans laquelle on « efface » un dégradé radial à
 * l'endroit de la lumière : bord doux, et tout ce qui est dessous en profite.
 */
export class AssassinsView implements ModeView {
  readonly hints = {
    countdown: "Prépare-toi… Lequel es-tu ? Bouge pour le découvrir.",
    playing: "Déplace-toi (ZQSD, flèches, stick) · Couteau (Espace, A) : le geste se voit, frappe dans l'ombre !",
  };

  private floor: Phaser.GameObjects.Rectangle;
  private darkness: Phaser.GameObjects.RenderTexture;
  private light = { x: ARENA.width / 2, y: ARENA.height / 2, placed: false };

  constructor(scene: Phaser.Scene) {
    this.floor = scene.add.rectangle(0, 0, ARENA.width, ARENA.height, 0x3a3128).setOrigin(0).setDepth(DEPTH.decor);
    this.darkness = scene.add.renderTexture(0, 0, ARENA.width, ARENA.height).setOrigin(0).setDepth(DEPTH.darkness);
    if (!scene.textures.exists(LIGHT_TEXTURE)) createLightTexture(scene, ASSASSINS.light.radius);
  }

  update(state: GameStateShape, dt: number) {
    const { light } = state;
    this.darkness.setVisible(light.radius > 0);
    if (light.radius <= 0) {
      this.light.placed = false;
      return;
    }
    // Même interpolation douce que les personnages ; à la première frame, on se place directement.
    const alpha = this.light.placed ? 1 - Math.exp(-SMOOTHING * dt) : 1;
    this.light.x += (light.x - this.light.x) * alpha;
    this.light.y += (light.y - this.light.y) * alpha;
    this.light.placed = true;

    const r = ASSASSINS.light.radius;
    this.darkness.clear();
    this.darkness.fill(0x000000, DARKNESS_ALPHA);
    this.darkness.erase(LIGHT_TEXTURE, this.light.x - r, this.light.y - r);
  }

  destroy() {
    this.floor.destroy();
    this.darkness.destroy();
  }
}

/** Disque à dégradé radial : opaque au centre, transparent au bord (sert de gomme). */
function createLightTexture(scene: Phaser.Scene, radius: number) {
  const canvas = scene.textures.createCanvas(LIGHT_TEXTURE, radius * 2, radius * 2)!;
  const ctx = canvas.getContext();
  const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.85)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  canvas.refresh();
}
