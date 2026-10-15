// Constantes et règles partagées entre le serveur et le client.

export const ARENA = { width: 960, height: 640 } as const;
export const ENTITY_RADIUS = 12;
export const TICK_RATE = 20; // ticks serveur par seconde
export const SPEED = 70; // px/s, identique pour joueurs et PNJ
export const SERVER_PORT = 2567;
export const ROOM_NAME = "game";

/** Directions possibles : -1 = immobile, 0..7 = 8 directions (0 = est, sens horaire, y vers le bas). */
export type Dir = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const IDLE: Dir = -1;

const DIAG = Math.SQRT1_2;
export const DIR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [DIAG, DIAG], [0, 1], [-DIAG, DIAG],
  [-1, 0], [-DIAG, -DIAG], [0, -1], [DIAG, -DIAG],
];

export function isDir(value: unknown): value is Dir {
  return Number.isInteger(value) && (value as number) >= -1 && (value as number) <= 7;
}

/** Convertit un vecteur d'input (-1/0/1 sur chaque axe) en direction. */
export function dirFromAxes(dx: number, dy: number): Dir {
  if (dx === 0 && dy === 0) return IDLE;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (((octant % 8) + 8) % 8) as Dir;
}

/**
 * Avance une position d'un pas. Retourne aussi si un mur a été touché.
 * Même fonction pour tout le monde : c'est ce qui rend joueurs et PNJ indiscernables.
 */
export function step(x: number, y: number, dir: Dir, dt: number) {
  if (dir === IDLE) return { x, y, blocked: false };
  const [vx, vy] = DIR_VECTORS[dir];
  const nx = clamp(x + vx * SPEED * dt, ENTITY_RADIUS, ARENA.width - ENTITY_RADIUS);
  const ny = clamp(y + vy * SPEED * dt, ENTITY_RADIUS, ARENA.height - ENTITY_RADIUS);
  const blocked = nx !== x + vx * SPEED * dt || ny !== y + vy * SPEED * dt;
  return { x: nx, y: ny, blocked };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// --- Déroulement d'une manche ---

export type Phase = "lobby" | "countdown" | "racing" | "finished";
export const COUNTDOWN_SECONDS = 3;
export const RESULTS_SECONDS = 6;

// --- Mode course ---

export const RACE = {
  entityCount: 20,
  startX: 60,
  finishX: 900,
} as const;

// --- Messages réseau ---

/** Client → serveur : direction voulue (le mode décide comment l'interpréter). */
export interface InputMessage {
  dir: Dir;
}

/** Serveur → un seul client : l'entité qu'il contrôle. Jamais diffusé aux autres. */
export interface AssignMessage {
  entityId: string;
}

/** Serveur → tous, en fin de manche uniquement : qui était joueur, et qui a gagné. */
export interface RevealMessage {
  winnerEntityId: string;
  playerEntityIds: string[];
}

export const MSG = {
  input: "input",
  start: "start",
  assign: "assign",
  reveal: "reveal",
} as const;
