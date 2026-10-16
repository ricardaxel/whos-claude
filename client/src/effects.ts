import Phaser from "phaser";
import { DEPTH } from "./modes/depth";

/**
 * Effets visuels en pixel art : viseurs, impacts de tir, coups de couteau, morts.
 * Les textures sont dessinées une fois au démarrage, à partir de petites grilles.
 */

const PIXEL = "fx-pixel";
export const CROSSHAIR_LOADED = "crosshair-loaded";
export const CROSSHAIR_EMPTY = "crosshair-empty";

// « # » = blanc (teinté à la couleur du joueur), contour noir ajouté automatiquement.
const CROSSHAIR_RING = [
  ".......#.......", ".......#.......", ".....#####.....", "....#.....#....", "...#.......#...",
  "..#.........#..", "..#.........#..", "###....C....###", "..#.........#..", "..#.........#..",
  "...#.......#...", "....#.....#....", ".....#####.....", ".......#.......", ".......#.......",
];
/** Balle disponible : point central plein ; balle tirée : point central évidé. */
const LOADED_CENTER = ["###", "###", "###"];
const EMPTY_CENTER = ["###", "#.#", "###"];

export function registerEffectTextures(scene: Phaser.Scene) {
  if (scene.textures.exists(PIXEL)) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff).fillRect(0, 0, 2, 2);
  g.generateTexture(PIXEL, 2, 2);
  g.destroy();
  createOutlinedTexture(scene, CROSSHAIR_LOADED, withCenter(CROSSHAIR_RING, LOADED_CENTER));
  createOutlinedTexture(scene, CROSSHAIR_EMPTY, withCenter(CROSSHAIR_RING, EMPTY_CENTER));
}

function withCenter(ring: string[], center: string[]) {
  return ring.map((row, y) => {
    const offset = y - 6;
    if (offset < 0 || offset > 2) return row.replace("C", ".");
    return row.slice(0, 6) + center[offset] + row.slice(9);
  });
}

/** Pixels « # » en blanc, entourés d'un contour noir d'un pixel (lisible sur tout fond). */
function createOutlinedTexture(scene: Phaser.Scene, key: string, grid: string[]) {
  const size = grid.length + 2;
  const texture = scene.textures.createCanvas(key, size, size)!;
  const ctx = texture.getContext();
  const filled = (x: number, y: number) => grid[y]?.[x] === "#";
  ctx.fillStyle = "#000";
  for (let y = -1; y <= grid.length; y++) {
    for (let x = -1; x <= grid.length; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  ctx.fillStyle = "#fff";
  grid.forEach((row, y) => [...row].forEach((c, x) => c === "#" && ctx.fillRect(x + 1, y + 1, 1, 1)));
  texture.refresh();
}

/** Gerbe de pixels qui retombe (impact, étincelles, poussière). */
function burst(scene: Phaser.Scene, x: number, y: number, options: { count: number; tints: number[]; speed: [number, number]; lifespan: number; depth: number; gravityY?: number }) {
  const emitter = scene.add.particles(x, y, PIXEL, {
    speed: { min: options.speed[0], max: options.speed[1] },
    lifespan: options.lifespan,
    scale: { start: 2, end: 0.5 },
    alpha: { start: 1, end: 0 },
    tint: options.tints,
    gravityY: options.gravityY ?? 0,
    emitting: false,
  });
  emitter.setDepth(options.depth);
  emitter.explode(options.count);
  scene.time.delayedCall(options.lifespan + 100, () => emitter.destroy());
}

/** Impact de tir : éclair et éclats dorés ; plus fourni quand quelqu'un est touché. */
export function shotEffect(scene: Phaser.Scene, x: number, y: number, hit: boolean) {
  const flash = scene.add.image(x, y, PIXEL).setScale(10).setDepth(DEPTH.effect).setTint(0xfff3c4);
  scene.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 160, onComplete: () => flash.destroy() });
  burst(scene, x, y, { count: hit ? 18 : 10, tints: [0xffffff, 0xfff3c4, 0xf2c45a], speed: [70, 190], lifespan: 380, depth: DEPTH.effect, gravityY: 240 });
}

/**
 * Coup de couteau : une entaille en pixels devant le personnage, et quelques étincelles.
 * Dessiné sous l'obscurité : bien visible dans la lumière, à peine dans le noir.
 */
export function knifeEffect(scene: Phaser.Scene, x: number, y: number, angle: number) {
  const slash = scene.add.graphics().setPosition(x, y).setDepth(DEPTH.effect);
  slash.fillStyle(0xffffff, 1);
  for (let i = 0; i <= 6; i++) {
    const a = angle - 0.9 + (1.8 * i) / 6;
    const r = 22 + 3 * Math.sin((Math.PI * i) / 6); // arc légèrement bombé
    const size = i === 0 || i === 6 ? 2 : 4;
    slash.fillRect(Math.round(Math.cos(a) * r) - size / 2, Math.round(Math.sin(a) * r) - size / 2, size, size);
  }
  scene.tweens.add({ targets: slash, alpha: 0, scale: 1.25, duration: 320, ease: "Quad.easeOut", onComplete: () => slash.destroy() });
  burst(scene, x + Math.cos(angle) * 22, y + Math.sin(angle) * 22, {
    count: 6, tints: [0xffffff, 0xd8e0ff], speed: [40, 110], lifespan: 260, depth: DEPTH.effect,
  });
}

/** Mort : éclair blanc, chute sur le côté, petit nuage de poussière ; puis le corps reste, grisé. */
export function deathEffect(scene: Phaser.Scene, sprite: Phaser.GameObjects.Sprite) {
  sprite.setTintFill(0xffffff).setDepth(DEPTH.deadBody);
  scene.time.delayedCall(90, () => sprite.clearTint().setTint(0x8a8a8a));
  scene.tweens.add({ targets: sprite, angle: -90, alpha: 0.85, duration: 240, ease: "Quad.easeIn" });
  burst(scene, sprite.x, sprite.y + 12, { count: 10, tints: [0x8a8090, 0x5c5466], speed: [20, 60], lifespan: 450, depth: DEPTH.effect });
}
