/**
 * Prévisualisation des personnages : génère docs/sprites/*.png à partir des données du jeu.
 *   npm run sprites:preview
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { characterFrames, FACINGS, LOOKS, paletteOf, SPRITE_SIZE, type Grid, type Palette } from "../client/src/sprites/characters";
import { renderDungeon, ROOM_HEIGHT, ROOM_SCALE, ROOM_WIDTH } from "../client/src/sprites/dungeon";
import { RgbaImage } from "./png";

const BACKGROUND = "#3a3128";
const OUT_DIR = resolve(import.meta.dirname, "../docs/sprites");

function draw(image: RgbaImage, grid: Grid, palette: Palette, x: number, y: number, scale: number) {
  grid.forEach((row, j) =>
    [...row].forEach((c, i) => {
      if (c === ".") return;
      const color = palette[c as keyof Palette];
      if (!color) throw new Error(`Couleur manquante pour « ${c} »`);
      image.rect(x + i * scale, y + j * scale, scale, scale, color);
    }),
  );
}

mkdirSync(OUT_DIR, { recursive: true });

// 1. Galerie : les 10 personnages de face, en grand.
{
  const scale = 8;
  const cell = SPRITE_SIZE * scale + 24;
  const image = new RgbaImage(LOOKS.length * cell + 24, cell + 24);
  image.rect(0, 0, image.width, image.height, BACKGROUND);
  LOOKS.forEach((look, i) => draw(image, characterFrames(look).down[0], paletteOf(look), 24 + i * cell, 24, scale));
  writeFileSync(resolve(OUT_DIR, "personnages-v1.png"), image.toPng());
}

// 2. Planche : une ligne par personnage, 4 orientations × 3 poses (debout, pas A, pas B).
{
  const scale = 4;
  const cell = SPRITE_SIZE * scale + 8;
  const gap = 16;
  const image = new RgbaImage(FACINGS.length * (3 * cell + gap) + 16, LOOKS.length * cell + 16);
  image.rect(0, 0, image.width, image.height, BACKGROUND);
  LOOKS.forEach((look, row) => {
    const frames = characterFrames(look);
    FACINGS.forEach((facing, f) =>
      frames[facing].forEach((grid, pose) => draw(image, grid, paletteOf(look), 16 + f * (3 * cell + gap) + pose * cell, 8 + row * cell, scale)),
    );
  });
  writeFileSync(resolve(OUT_DIR, "planche-v1.png"), image.toPng());
}

// 3. La salle de donjon à l'échelle du jeu, avec quelques personnages pour juger l'ensemble.
{
  const image = new RgbaImage(ROOM_WIDTH * ROOM_SCALE, ROOM_HEIGHT * ROOM_SCALE);
  const room = renderDungeon();
  for (let y = 0; y < ROOM_HEIGHT; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const k = (y * ROOM_WIDTH + x) * 4;
      const hexColor = "#" + [room[k], room[k + 1], room[k + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      image.rect(x * ROOM_SCALE, y * ROOM_SCALE, ROOM_SCALE, ROOM_SCALE, hexColor);
    }
  }
  const spots = [[140, 160, "down"], [300, 250, "right"], [520, 140, "left"], [700, 330, "down"], [210, 430, "up"], [430, 470, "right"], [820, 200, "left"], [620, 540, "down"], [90, 560, "right"], [880, 480, "up"]] as const;
  spots.forEach(([x, y, facing], i) => {
    const look = LOOKS[i % LOOKS.length];
    draw(image, characterFrames(look)[facing][i % 3], paletteOf(look), x - 16, y - 16, 2);
  });
  writeFileSync(resolve(OUT_DIR, "donjon-v1.png"), image.toPng());
}

console.log(`Images écrites dans ${OUT_DIR}`);
