import { Dir, ENTITY_RADIUS, IDLE, PLAYFIELD, RACE } from "@whosclaude/shared";
import type { Entity } from "../GameState.js";
import type { GameMode, NpcBrain } from "./GameMode.js";

const FORWARD: Dir = 0; // vers l'est, donc vers la ligne d'arrivée

/**
 * Course : tout le monde part de la même ligne, une seule action (avancer).
 * Le premier joueur à franchir l'arrivée gagne. Les PNJ avancent par à-coups :
 * avancer en continu, c'est se trahir.
 */
export class RaceMode implements GameMode {
  readonly entityCount = RACE.entityCount;
  readonly sprintMultiplier = RACE.sprintMultiplier;
  readonly crosshairs = true;
  readonly knife = false;
  readonly roundSeconds = 0;

  spawnPositions() {
    // Répartis sur toute la hauteur de la salle, entre le mur du haut et celui du bas.
    const top = PLAYFIELD.top + ENTITY_RADIUS;
    const span = PLAYFIELD.bottom - PLAYFIELD.top - 2 * ENTITY_RADIUS;
    return Array.from({ length: this.entityCount }, (_, i) => ({ x: RACE.startX, y: top + (span * (i + 0.5)) / this.entityCount }));
  }

  mapInput(dir: Dir): Dir {
    return dir === IDLE ? IDLE : FORWARD;
  }

  thinkNpc(entity: Entity, brain: NpcBrain, dt: number) {
    brain.timer -= dt;
    if (brain.timer > 0) return;

    if (entity.dir === IDLE) {
      entity.dir = FORWARD;
      brain.timer = 0.4 + Math.random() * 1.8;
    } else {
      entity.dir = IDLE;
      brain.timer = 0.3 + Math.random() * 2.2;
    }
  }

  hasWon(entity: Entity) {
    return entity.x >= RACE.finishX;
  }
}
