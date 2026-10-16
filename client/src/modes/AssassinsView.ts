import type Phaser from "phaser";
import { ARENA, type GameStateShape } from "@whosclaude/shared";
import { DEPTH } from "./depth";
import type { ModeView } from "./ModeView";

/** Opacité de l'obscurité : assez sombre pour cacher un geste, assez claire pour se déplacer. */
const DARKNESS_ALPHA = 0.72;
/** Vitesse de convergence de la lumière vers sa position serveur. */
const SMOOTHING = 8;
/**
 * La texture d'obscurité est générée à demi-résolution puis agrandie ×2 : 4 fois moins de
 * mémoire (≈ 2,5 Mo), et le dégradé de la lumière est flou de toute façon.
 */
const TEXTURE_SCALE = 2;

/**
 * Assassins : une salle sombre (plancher) et une lumière d'ambiance qui erre.
 *
 * L'obscurité est UNE image, générée une seule fois : un voile noir deux fois plus grand
 * que l'arène, percé en son centre d'un trou à bord doux. À chaque frame, on se contente de
 * déplacer l'image pour centrer le trou sur la lumière : aucun redessin plein écran,
 * ce qui compte sur les téléphones d'entrée de gamme.
 */
export class AssassinsView implements ModeView {
  readonly hints = {
    countdown: "Prépare-toi… Lequel es-tu ? Bouge pour le découvrir.",
    playing: "Déplace-toi (ZQSD, flèches, stick) · Couteau (Espace, A) : le geste se voit, frappe dans l'ombre !",
  };

  private floor: Phaser.GameObjects.Rectangle;
  private darkness?: Phaser.GameObjects.Image;
  private darknessRadius = 0;
  private light = { x: ARENA.width / 2, y: ARENA.height / 2, placed: false };

  constructor(private readonly scene: Phaser.Scene) {
    this.floor = scene.add.rectangle(0, 0, ARENA.width, ARENA.height, 0x3a3128).setOrigin(0).setDepth(DEPTH.decor);
  }

  update(state: GameStateShape, dt: number) {
    const { light } = state;
    if (light.radius <= 0) {
      this.darkness?.setVisible(false);
      this.light.placed = false;
      return;
    }
    // Le rayon vient de l'état serveur : s'il change (équilibrage), le voile est régénéré.
    if (light.radius !== this.darknessRadius) this.createDarkness(light.radius);

    // Même interpolation douce que les personnages ; à la première frame, on se place directement.
    const alpha = this.light.placed ? 1 - Math.exp(-SMOOTHING * dt) : 1;
    this.light.x += (light.x - this.light.x) * alpha;
    this.light.y += (light.y - this.light.y) * alpha;
    this.light.placed = true;
    this.darkness!.setVisible(true).setPosition(this.light.x, this.light.y);
  }

  destroy() {
    this.floor.destroy();
    this.darkness?.destroy();
  }

  private createDarkness(radius: number) {
    const key = `assassins-darkness-${radius}`;
    if (!this.scene.textures.exists(key)) createDarknessTexture(this.scene, key, radius);
    this.darkness?.destroy();
    this.darkness = this.scene.add.image(0, 0, key).setScale(TEXTURE_SCALE).setDepth(DEPTH.darkness);
    this.darknessRadius = radius;
  }
}

/**
 * Voile noir de (2·largeur) × (2·hauteur) d'arène, à demi-résolution, avec au centre un
 * trou en dégradé radial : où que soit la lumière, le voile couvre toute l'arène.
 */
function createDarknessTexture(scene: Phaser.Scene, key: string, radius: number) {
  const width = (2 * ARENA.width) / TEXTURE_SCALE;
  const height = (2 * ARENA.height) / TEXTURE_SCALE;
  const r = radius / TEXTURE_SCALE;
  const canvas = scene.textures.createCanvas(key, width, height)!;
  const ctx = canvas.getContext();
  ctx.fillStyle = `rgba(0,0,0,${DARKNESS_ALPHA})`;
  ctx.fillRect(0, 0, width, height);
  // On « perce » le voile : destination-out efface selon l'opacité du dégradé.
  ctx.globalCompositeOperation = "destination-out";
  const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.6, "rgba(0,0,0,0.85)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(width / 2 - r, height / 2 - r, 2 * r, 2 * r);
  ctx.globalCompositeOperation = "source-over";
  canvas.refresh();
}
