import { describe, expect, it } from "vitest";
import { IDLE, MAX_PLAYERS, MODES, NAME_MAX_LENGTH, RACE, ROOM_CODE, type ModeId } from "@whosclaude/shared";
import { Entity } from "../src/GameState.js";
import { createMode, MODE_FACTORIES } from "../src/modes/index.js";
import { RaceMode } from "../src/modes/RaceMode.js";
import { uniqueName } from "../src/names.js";
import { releaseRoomCode, reserveRoomCode } from "../src/roomCodes.js";

describe("registre des modes", () => {
  it("chaque mode déclaré a une fabrique, et l'inverse", () => {
    expect(Object.keys(MODE_FACTORIES).sort()).toEqual(Object.keys(MODES).sort());
  });

  it("chaque mode a au moins une entité par joueur possible", () => {
    for (const id of Object.keys(MODES) as ModeId[]) {
      const mode = createMode(id);
      expect(mode.entityCount).toBeGreaterThanOrEqual(MAX_PLAYERS);
      expect(mode.spawnPositions()).toHaveLength(mode.entityCount);
    }
  });
});

describe("RaceMode", () => {
  const mode = new RaceMode();

  it("place tout le monde sur la ligne de départ", () => {
    expect(mode.spawnPositions().every((p) => p.x === RACE.startX)).toBe(true);
  });

  it("une seule action : avancer", () => {
    expect(mode.mapInput(IDLE)).toBe(IDLE);
    for (const dir of [0, 3, 4, 6] as const) expect(mode.mapInput(dir)).toBe(0);
  });

  it("victoire à la ligne d'arrivée", () => {
    const entity = new Entity();
    entity.x = RACE.finishX - 1;
    expect(mode.hasWon(entity)).toBe(false);
    entity.x = RACE.finishX;
    expect(mode.hasWon(entity)).toBe(true);
  });

  it("les PNJ alternent marche et pause", () => {
    const entity = new Entity();
    const brain = { timer: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) {
      mode.thinkNpc(entity, brain, 0.05);
      if (seen.at(-1) !== entity.dir) seen.push(entity.dir);
    }
    expect(seen.length).toBeGreaterThan(2);
    // Jamais deux états identiques d'affilée : marche (0) / pause (-1) en alternance.
    expect(seen.every((dir, i) => i === 0 || dir !== seen[i - 1])).toBe(true);
    expect(new Set(seen)).toEqual(new Set([0, IDLE]));
  });
});

describe("codes de room", () => {
  it("format, unicité, libération", () => {
    const codes = Array.from({ length: 500 }, () => reserveRoomCode());
    const pattern = new RegExp(`^[${ROOM_CODE.alphabet}]{${ROOM_CODE.length}}$`);
    expect(codes.every((c) => pattern.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach(releaseRoomCode);
  });
});

describe("uniqueName", () => {
  it("suffixe les doublons et numérote les anonymes au plus petit numéro libre", () => {
    expect(uniqueName("Alice", new Set())).toBe("Alice");
    expect(uniqueName("Alice", new Set(["Alice"]))).toBe("Alice (2)");
    expect(uniqueName("Alice", new Set(["Alice", "Alice (2)"]))).toBe("Alice (3)");
    expect(uniqueName("", new Set(["Joueur 1", "Joueur 3"]))).toBe("Joueur 2");
  });

  it("ne dépasse jamais la longueur maximale, même suffixé", () => {
    const long = "é".repeat(NAME_MAX_LENGTH);
    const name = uniqueName(long, new Set([long]));
    expect(Array.from(name).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
    expect(name.endsWith(" (2)")).toBe(true);
  });
});
