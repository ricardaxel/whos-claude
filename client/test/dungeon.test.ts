import { describe, expect, it } from "vitest";
import { ARENA, PLAYFIELD } from "@whosclaude/shared";
import { renderDungeon, ROOM_HEIGHT, ROOM_SCALE, ROOM_WIDTH, TILE, TORCH_FLAMES } from "../src/sprites/dungeon";

describe("salle de donjon", () => {
  it("couvre exactement l'arène, en tuiles entières", () => {
    expect(ROOM_WIDTH * ROOM_SCALE).toBe(ARENA.width);
    expect(ROOM_HEIGHT * ROOM_SCALE).toBe(ARENA.height);
    for (const edge of [PLAYFIELD.left, PLAYFIELD.top, ARENA.width - PLAYFIELD.right, ARENA.height - PLAYFIELD.bottom]) {
      expect(edge % (TILE * ROOM_SCALE)).toBe(0); // les murs tombent sur la grille des tuiles
    }
  });

  it("est entièrement opaque et identique d'un rendu à l'autre", () => {
    const a = renderDungeon();
    expect(a).toHaveLength(ROOM_WIDTH * ROOM_HEIGHT * 4);
    for (let k = 3; k < a.length; k += 4) if (a[k] !== 255) throw new Error(`pixel transparent en ${(k - 3) / 4}`);
    expect(renderDungeon()).toEqual(a);
  });

  it("les torches sont sur le mur du haut, hors de la zone praticable", () => {
    for (const flame of TORCH_FLAMES) {
      expect(flame.y).toBeLessThan(PLAYFIELD.top);
      expect(flame.x).toBeGreaterThan(PLAYFIELD.left);
      expect(flame.x).toBeLessThan(PLAYFIELD.right);
    }
  });
});
