import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ARENA, clampToArena, CROSSHAIR_COLORS, dirFromAxes, ENTITY_RADIUS, IDLE, isDir, isModeId, MAX_PLAYERS,
  NAME_MAX_LENGTH, PLAYFIELD, sanitizeName, SPEED, step,
} from "../src/index.js";

describe("sanitizeName", () => {
  it("garde un pseudo normal", () => {
    expect(sanitizeName("  Axel  ")).toBe("Axel");
    expect(sanitizeName("Zoé 🎯")).toBe("Zoé 🎯");
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    for (const value of [undefined, null, 42, {}, ["a"]]) expect(sanitizeName(value)).toBe("");
  });

  it("retire contrôles C0/C1, bidi et caractères de largeur nulle", () => {
    expect(sanitizeName("Al\u0007ice")).toBe("Alice");
    expect(sanitizeName("Al\u0085ice")).toBe("Alice"); // C1
    expect(sanitizeName("‮ecila")).toBe("ecila"); // bidi override
    expect(sanitizeName("​​")).toBe(""); // invisible seul → vide
    expect(sanitizeName("A‍xel")).toBe("Axel");
  });

  it("tronque par caractère, sans couper un emoji en deux", () => {
    const name = sanitizeName("a".repeat(15) + "🎯🎯");
    expect(Array.from(name)).toHaveLength(NAME_MAX_LENGTH);
    expect(name.endsWith("🎯")).toBe(true);
    expect(name).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
  });

  it("propriété : jamais plus de N caractères, jamais de caractère de contrôle ou de format", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (raw) => {
        const name = sanitizeName(raw);
        expect(Array.from(name).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
        expect(name).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]/u);
        expect(name).toBe(name.trim());
      }),
    );
  });
});

describe("isModeId", () => {
  it("accepte les modes déclarés et rien d'autre", () => {
    expect(isModeId("race")).toBe(true);
    for (const value of ["__proto__", "constructor", "toString", "", "RACE", 1, null]) {
      expect(isModeId(value)).toBe(false);
    }
  });
});

describe("règles partagées", () => {
  it("une couleur par joueur possible", () => {
    expect(MAX_PLAYERS).toBe(CROSSHAIR_COLORS.length);
    expect(new Set(CROSSHAIR_COLORS).size).toBe(CROSSHAIR_COLORS.length);
  });

  it("clampToArena reste dans l'arène", () => {
    fc.assert(
      fc.property(fc.double(), fc.double(), (x, y) => {
        const p = clampToArena(x, y);
        if (Number.isNaN(x) || Number.isNaN(y)) return; // filtré en amont par le serveur
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(ARENA.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(ARENA.height);
      }),
    );
  });

  it("step avance à vitesse fixe et bloque aux murs", () => {
    const moved = step(100, 100, 0, 1);
    expect(moved.x).toBeCloseTo(100 + SPEED);
    expect(moved.blocked).toBe(false);
    expect(step(100, 100, IDLE, 1)).toEqual({ x: 100, y: 100, blocked: false });
    const wall = step(PLAYFIELD.right - ENTITY_RADIUS, 100, 0, 1);
    expect(wall.x).toBe(PLAYFIELD.right - ENTITY_RADIUS);
    expect(wall.blocked).toBe(true);
  });

  it("propriété : on ne sort jamais de la salle, quelle que soit la direction", () => {
    fc.assert(
      fc.property(
        fc.double({ min: PLAYFIELD.left, max: PLAYFIELD.right, noNaN: true }),
        fc.double({ min: PLAYFIELD.top, max: PLAYFIELD.bottom, noNaN: true }),
        fc.integer({ min: 0, max: 7 }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (x, y, dir, dt) => {
          const next = step(x, y, dir as 0, dt);
          expect(next.x).toBeGreaterThanOrEqual(PLAYFIELD.left + ENTITY_RADIUS);
          expect(next.x).toBeLessThanOrEqual(PLAYFIELD.right - ENTITY_RADIUS);
          expect(next.y).toBeGreaterThanOrEqual(PLAYFIELD.top + ENTITY_RADIUS);
          expect(next.y).toBeLessThanOrEqual(PLAYFIELD.bottom - ENTITY_RADIUS);
        },
      ),
    );
  });

  it("isDir / dirFromAxes", () => {
    expect([-1, 0, 7].every(isDir)).toBe(true);
    expect([8, -2, 0.5, "1", NaN].some(isDir)).toBe(false);
    expect(dirFromAxes(0, 0)).toBe(IDLE);
    expect(dirFromAxes(1, 0)).toBe(0);
    expect(dirFromAxes(0, 1)).toBe(2);
    expect(dirFromAxes(-1, -1)).toBe(5);
  });
});
