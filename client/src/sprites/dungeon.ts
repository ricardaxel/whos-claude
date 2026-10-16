/**
 * Salle de donjon en pixel art (tuiles 16×16, affichées ×2 comme les personnages).
 *
 * Données et rendu purs, sans Phaser : le jeu en fait une texture au démarrage et le
 * script de prévisualisation en fait une image. L'éclairage tamisé (ambiance basse,
 * coins assombris, halo chaud des torches) est calculé une fois, pixel par pixel.
 */
import { ARENA, PLAYFIELD } from "@whosclaude/shared";

export const TILE = 16;
/** Échelle d'affichage : 1 pixel de tuile = 2 pixels d'arène. */
export const ROOM_SCALE = 2;
export const ROOM_WIDTH = ARENA.width / ROOM_SCALE; // 480 px de tuiles = 30 tuiles
export const ROOM_HEIGHT = ARENA.height / ROOM_SCALE; // 320 px = 20 tuiles
const COLS = ROOM_WIDTH / TILE;
const ROWS = ROOM_HEIGHT / TILE;

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

/** Palette du donjon : pierres froides et désaturées, accents chauds pour le feu et le tissu. */
const PALETTE: Record<string, Rgb> = {
  // Sol
  f: hex("#3b3540"), F: hex("#4a4350"), d: hex("#262129"), c: hex("#1a161d"), g: hex("#3a4834"), G: hex("#4a5a40"),
  // Murs
  b: hex("#574650"), B: hex("#6a5661"), m: hex("#2a2028"), k: hex("#1c1620"), K: hex("#3a2f38"),
  // Torche et tenture
  y: hex("#ffd860"), Y: hex("#fff4c0"), o: hex("#f08a2a"), w: hex("#5c3c22"), W: hex("#3a2614"),
  r: hex("#7a1e2a"), R: hex("#561420"), n: hex("#c8a040"),
  // Os et gravats
  i: hex("#b8ab90"), I: hex("#7a705e"), j: hex("#2f2a33"),
};

/** Lignes de 16 ; « . » = transparent (tuiles d'ornement posées sur un mur). */
type Tile = readonly string[];

// --- Sol : dalles de 8×8 en quinconce ---
const FLOOR: Tile = [
  "dddddddddddddddd",
  "dFFFFFFFdFFFFFFF",
  "dFfffffFdFffffff",
  "dFffffffdFffffff",
  "dFfffFffdFfffFff",
  "dFffffffdFffffff",
  "dFffffffdFffffff",
  "dfffffffdfffffff",
  "dddddddddddddddd",
  "FFFFdFFFFFFFdFFF",
  "ffffdFffffffdFff",
  "fFffdFffffFfdFff",
  "ffffdFffffffdFff",
  "ffffdFfffffFdFff",
  "ffffdFffffffdFff",
  "ffffdfffffffdfff",
];
const FLOOR_CRACKED: Tile = FLOOR.map((row, y) => {
  const crack: Record<number, number[]> = { 2: [4], 3: [4, 5], 4: [5], 5: [5, 6], 10: [9], 11: [9, 10], 12: [10], 13: [10, 11] };
  return [...row].map((ch, x) => (crack[y]?.includes(x) ? "c" : ch)).join("");
});
const FLOOR_MOSSY: Tile = FLOOR.map((row, y) =>
  [...row].map((ch, x) => ((y === 7 || y === 15) && ch === "f" && x % 3 !== 0 ? "g" : (y === 6 || y === 14) && x % 5 === 1 && ch === "f" ? "G" : ch)).join(""),
);

// --- Murs : façade de briques (deux tuiles de haut), dessus des murs latéraux ---
const BRICK_A = ["BBBBBBBmBBBBBBBm", "bbbbbbbmbbbbbbbm", "bbbbbbbmbbbbbbbm", "mmmmmmmmmmmmmmmm"];
const BRICK_B = ["BBBmBBBBBBBmBBBB", "bbbmbbbbbbbmbbbb", "bbbmbbbbbbbmbbbb", "mmmmmmmmmmmmmmmm"];
const WALL_UPPER: Tile = ["kkkkkkkkkkkkkkkk", "KKKKKKKKKKKKKKKK", ...BRICK_A, ...BRICK_B, ...BRICK_A, ...BRICK_B.slice(0, 2)];
const WALL_LOWER: Tile = [...BRICK_B.slice(2), ...BRICK_A, ...BRICK_B, ...BRICK_A, "kkkkkkkkkkkkkkkk", "kkkkkkkkkkkkkkkk"];
const WALL_TOP: Tile = Array.from({ length: 16 }, (_, y) => (y % 8 === 0 ? "kkkkkkkkkkkkkkkk" : "kkkKkkkkkkkKkkkk"));

// --- Ornements ---
const TORCH: Tile = [
  "................",
  ".......y........",
  "......yy........",
  "......yYy.......",
  ".....oyYyo......",
  ".....oyyyo......",
  "......ooo.......",
  ".....wwwww......",
  "......wWw.......",
  ".......w........",
  ".......w........",
  "................",
  "................",
  "................",
  "................",
  "................",
];
/** Tenture rouge à emblème doré, sur deux tuiles de haut. */
const BANNER: Tile = [
  "................", "..wwwwwwwwwwww..", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrnnrrrR...",
  "...RrrnrrnrrR...", "...RrnrrrrnrR...", "...RrnrnnrnrR...", "...RrnrrrrnrR...", "...RrrnrrnrrR...", "...RrrrnnrrrR...",
  "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...",
  "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...",
  "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrrrrrrrR...", "...RrrR..RrrR...", "...RrR....RrR...", "...RR......RR...",
  "................", "................", "................", "................",
];

/** Petits débris posés au sol (purement décoratifs : on marche dessus). */
const BONES: Tile = [
  "................", "................", "...ii.....ii....", "...IiiiiiiiI....", "...ii.....ii....", "................",
  "........iii.....", ".......iiiii....", ".......iIiIi....", ".......iiiii....", "........iii.....", "................",
  "................", "................", "................", "................",
];
const RUBBLE: Tile = [
  "................", "................", "................", "................", "......jj........", ".....jFFj.......",
  ".....jffj..jj...", "......jj..jFj...", "...........jj...", "...jj...........", "..jFj...........", "...jj...........",
  "................", "................", "................", "................",
];

/** Colonnes (en tuiles) des torches et des tentures sur le mur du haut. */
const TORCH_COLUMNS = [4, 11, 18, 25];
const BANNER_COLUMNS = [7, 14.5, 22];

/** Position des flammes, en pixels d'arène (pour le halo vacillant du jeu). */
export const TORCH_FLAMES = TORCH_COLUMNS.map((col) => ({
  x: (col * TILE + 7.5) * ROOM_SCALE,
  y: (TILE / 2 + 4) * ROOM_SCALE,
}));

/** Générateur pseudo-aléatoire déterministe : même salle sur tous les écrans. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tuile de chaque case de la salle. */
function layout(): Tile[][] {
  const rand = random(7);
  const wallLeft = PLAYFIELD.left / ROOM_SCALE / TILE;
  const wallTop = PLAYFIELD.top / ROOM_SCALE / TILE;
  const wallRight = COLS - (ARENA.width - PLAYFIELD.right) / ROOM_SCALE / TILE;
  const wallBottom = ROWS - (ARENA.height - PLAYFIELD.bottom) / ROOM_SCALE / TILE;
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => {
      if (col < wallLeft || col >= wallRight || row >= wallBottom) return WALL_TOP;
      if (row < wallTop) return row === wallTop - 1 ? WALL_LOWER : WALL_UPPER;
      const r = rand();
      return r < 0.08 ? FLOOR_CRACKED : r < 0.16 ? FLOOR_MOSSY : FLOOR;
    }),
  );
}

/**
 * Salle complète en RGBA (ROOM_WIDTH × ROOM_HEIGHT), éclairage compris :
 * ambiance basse, coins assombris, ombre au pied du mur et halo chaud des torches.
 */
export function renderDungeon(): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(ROOM_WIDTH * ROOM_HEIGHT * 4);
  const put = (x: number, y: number, ch: string) => {
    if (ch === "." || x < 0 || y < 0 || x >= ROOM_WIDTH || y >= ROOM_HEIGHT) return;
    const [r, g, b] = PALETTE[ch];
    const k = (y * ROOM_WIDTH + x) * 4;
    pixels[k] = r;
    pixels[k + 1] = g;
    pixels[k + 2] = b;
    pixels[k + 3] = 255;
  };
  const stamp = (tile: Tile, x0: number, y0: number) => tile.forEach((row, y) => [...row].forEach((ch, x) => put(x0 + x, y0 + y, ch)));

  layout().forEach((row, r) => row.forEach((tile, c) => stamp(tile, c * TILE, r * TILE)));
  for (const col of BANNER_COLUMNS) stamp(BANNER, Math.round(col * TILE), 0);
  for (const col of TORCH_COLUMNS) stamp(TORCH, col * TILE, TILE / 2);
  // Quelques débris éparpillés sur les dalles.
  const rand = random(42);
  const floor = { left: PLAYFIELD.left / ROOM_SCALE, top: PLAYFIELD.top / ROOM_SCALE, right: PLAYFIELD.right / ROOM_SCALE, bottom: PLAYFIELD.bottom / ROOM_SCALE };
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(floor.left + rand() * (floor.right - floor.left - TILE));
    const y = Math.floor(floor.top + 8 + rand() * (floor.bottom - floor.top - TILE - 8));
    stamp(i % 3 === 0 ? BONES : RUBBLE, x, y);
  }

  // Éclairage, calculé en pixels de tuile.
  const flames = TORCH_FLAMES.map((f) => ({ x: f.x / ROOM_SCALE, y: f.y / ROOM_SCALE }));
  const floorTop = PLAYFIELD.top / ROOM_SCALE;
  const cx = ROOM_WIDTH / 2;
  const cy = ROOM_HEIGHT / 2;
  for (let y = 0; y < ROOM_HEIGHT; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      // Ambiance tamisée, plus sombre vers les coins.
      const edge = Math.hypot((x - cx) / cx, (y - cy) / cy) / Math.SQRT2;
      let light = 0.7 - 0.36 * edge * edge;
      // Ombre portée du mur du haut sur les premières dalles.
      if (y >= floorTop && y < floorTop + 10) light *= 0.65 + 0.035 * (y - floorTop);
      // Halo chaud des torches.
      let warm = 0;
      for (const f of flames) warm += Math.max(0, 1 - Math.hypot(x - f.x, (y - f.y) * 0.9) / 115) ** 1.6;
      const k = (y * ROOM_WIDTH + x) * 4;
      // La lumière du feu s'ajoute (au lieu de multiplier) : elle se voit aussi sur la pierre sombre.
      pixels[k] = pixels[k] * (light + 0.35 * warm) + 62 * warm;
      pixels[k + 1] = pixels[k + 1] * (light + 0.25 * warm) + 34 * warm;
      pixels[k + 2] = pixels[k + 2] * (light + 0.1 * warm) + 8 * warm;
    }
  }
  return pixels;
}
