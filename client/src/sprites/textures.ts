import type Phaser from "phaser";
import { characterFrames, FACINGS, LOOKS, paletteOf, SPRITE_SIZE, type Facing, type Palette } from "./characters";

export const lookTexture = (look: number) => `look-${look}`;
export const frameName = (facing: Facing, pose: number) => `${facing}-${pose}`;

/**
 * Une texture par apparence : planche de 3 poses (colonnes) × 4 orientations (lignes),
 * générée une seule fois au démarrage à partir des grilles de characters.ts.
 */
export function registerCharacterTextures(scene: Phaser.Scene) {
  LOOKS.forEach((look, index) => {
    const key = lookTexture(index);
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, SPRITE_SIZE * 3, SPRITE_SIZE * FACINGS.length)!;
    const ctx = texture.getContext();
    const palette = paletteOf(look);
    const frames = characterFrames(look);
    FACINGS.forEach((facing, row) =>
      frames[facing].forEach((grid, pose) => {
        const x0 = pose * SPRITE_SIZE;
        const y0 = row * SPRITE_SIZE;
        grid.forEach((line, y) =>
          [...line].forEach((c, x) => {
            if (c === ".") return;
            ctx.fillStyle = palette[c as keyof Palette]!;
            ctx.fillRect(x0 + x, y0 + y, 1, 1);
          }),
        );
        texture.add(frameName(facing, pose), 0, x0, y0, SPRITE_SIZE, SPRITE_SIZE);
      }),
    );
    texture.refresh();
  });
}
