import { describe, expect, it } from "vitest";
import { LOOK_COUNT } from "@whosclaude/shared";
import { characterFrames, facingFromDir, FACINGS, LOOKS, paletteOf, SPRITE_SIZE } from "../src/sprites/characters";

const diff = (a: readonly string[], b: readonly string[]) =>
  a.reduce((n, row, y) => n + [...row].filter((c, x) => c !== b[y][x]).length, 0);

describe("personnages", () => {
  it("autant d'apparences côté client que le serveur peut en tirer", () => {
    expect(LOOKS).toHaveLength(LOOK_COUNT);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOK_COUNT);
  });

  it.each(LOOKS.map((look) => [look.name, look] as const))("%s : grilles 16×16, toutes les couleurs définies", (_name, look) => {
    const palette = paletteOf(look);
    const frames = characterFrames(look);
    for (const facing of FACINGS) {
      expect(frames[facing]).toHaveLength(3);
      for (const grid of frames[facing]) {
        expect(grid).toHaveLength(SPRITE_SIZE);
        for (const row of grid) {
          expect(row).toHaveLength(SPRITE_SIZE);
          for (const c of row) if (c !== ".") expect(palette, `couleur « ${c} »`).toHaveProperty(c);
        }
      }
    }
  });

  it.each(LOOKS.map((look) => [look.name, look] as const))("%s : le profil droit est le miroir du gauche, la marche se voit", (_name, look) => {
    const frames = characterFrames(look);
    frames.left.forEach((grid, pose) =>
      expect(frames.right[pose]).toEqual(grid.map((row) => row.split("").reverse().join(""))),
    );
    // Chaque pas diffère nettement de la pose debout (au moins 6 pixels), dans toutes les orientations.
    for (const facing of FACINGS) {
      const [stand, stepA, stepB] = frames[facing];
      expect(diff(stand, stepA)).toBeGreaterThanOrEqual(6);
      expect(diff(stand, stepB)).toBeGreaterThanOrEqual(6);
      expect(diff(stepA, stepB)).toBeGreaterThan(0);
    }
  });

  it("orientation : diagonales de profil, et on garde l'orientation à l'arrêt", () => {
    expect([0, 1, 7].map((d) => facingFromDir(d, "down"))).toEqual(["right", "right", "right"]);
    expect([3, 4, 5].map((d) => facingFromDir(d, "down"))).toEqual(["left", "left", "left"]);
    expect(facingFromDir(2, "left")).toBe("down");
    expect(facingFromDir(6, "left")).toBe("up");
    expect(facingFromDir(-1, "up")).toBe("up");
  });
});
