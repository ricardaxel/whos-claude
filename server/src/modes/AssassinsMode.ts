import { ARENA, ASSASSINS, DIR_VECTORS, ENTITY_RADIUS, IDLE, type Dir } from "@whosclaude/shared";
import type { Entity, GameState } from "../GameState.js";
import type { GameMode, NpcBrain } from "./GameMode.js";

const MARGIN = ENTITY_RADIUS * 3;

/**
 * Assassins : une salle sombre, tout le monde se déplace dans les 8 directions,
 * chaque joueur a un couteau. Les PNJ errent sans jamais frapper : le coup de couteau
 * est ce qui trahit un joueur, d'où l'intérêt de frapper hors de la lumière d'ambiance.
 */
export class AssassinsMode implements GameMode {
  readonly entityCount = ASSASSINS.entityCount;
  readonly sprintMultiplier = 1;
  readonly crosshairs = false;
  readonly knife = true;
  readonly roundSeconds = ASSASSINS.roundSeconds;

  private lightTarget = { x: 0, y: 0 };

  /** Grille légèrement désordonnée couvrant toute la pièce : personne ne se chevauche. */
  spawnPositions() {
    const cols = 6;
    const rows = Math.ceil(this.entityCount / cols);
    const cellW = (ARENA.width - 2 * MARGIN) / cols;
    const cellH = (ARENA.height - 2 * MARGIN) / rows;
    const jitter = (cell: number) => (Math.random() - 0.5) * (cell - 2 * ENTITY_RADIUS) * 0.8;
    return Array.from({ length: this.entityCount }, (_, i) => ({
      x: MARGIN + cellW * ((i % cols) + 0.5) + jitter(cellW),
      y: MARGIN + cellH * (Math.floor(i / cols) + 0.5) + jitter(cellH),
    }));
  }

  mapInput(dir: Dir): Dir {
    return dir;
  }

  /** Errance : pauses et marches dans une des 8 directions, en évitant les murs. */
  thinkNpc(entity: Entity, brain: NpcBrain, dt: number) {
    brain.timer -= dt;
    if (brain.timer > 0) return;
    if (entity.dir !== IDLE || Math.random() < 0.35) {
      entity.dir = IDLE;
      brain.timer = 0.4 + Math.random() * 2.2;
    } else {
      entity.dir = directionAwayFromWalls(entity);
      brain.timer = 0.5 + Math.random() * 2.5;
    }
  }

  hasWon() {
    return false; // seul le dernier survivant gagne (règle commune de la room)
  }

  startRound(state: GameState) {
    state.light.radius = ASSASSINS.light.radius;
    const start = randomPoint();
    state.light.x = start.x;
    state.light.y = start.y;
    this.lightTarget = randomPoint();
  }

  /** La lumière glisse vers un point au hasard, puis en choisit un autre. */
  updateWorld(state: GameState, dt: number) {
    const light = state.light;
    const dx = this.lightTarget.x - light.x;
    const dy = this.lightTarget.y - light.y;
    const distance = Math.hypot(dx, dy);
    const stepLength = ASSASSINS.light.speed * dt;
    if (distance <= stepLength) {
      light.x = this.lightTarget.x;
      light.y = this.lightTarget.y;
      this.lightTarget = randomPoint();
      return;
    }
    light.x += (dx / distance) * stepLength;
    light.y += (dy / distance) * stepLength;
  }
}

function randomPoint() {
  return { x: MARGIN + Math.random() * (ARENA.width - 2 * MARGIN), y: MARGIN + Math.random() * (ARENA.height - 2 * MARGIN) };
}

function directionAwayFromWalls(entity: Entity): Dir {
  const candidates = DIR_VECTORS.flatMap(([vx, vy], dir) => {
    if (vx < 0 && entity.x < MARGIN) return [];
    if (vx > 0 && entity.x > ARENA.width - MARGIN) return [];
    if (vy < 0 && entity.y < MARGIN) return [];
    if (vy > 0 && entity.y > ARENA.height - MARGIN) return [];
    return [dir as Dir];
  });
  return candidates[Math.floor(Math.random() * candidates.length)];
}
