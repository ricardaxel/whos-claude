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

// --- Session : salon, match, manches ---

/**
 * lobby : salon, choix du mode, joueurs prêts
 * countdown → playing → roundEnd : une manche, répétée N fois
 * podium : classement final, puis retour au salon
 */
export type Phase = "lobby" | "countdown" | "playing" | "roundEnd" | "podium";
export const COUNTDOWN_SECONDS = 3;
export const RESULTS_SECONDS = 6;
export const PODIUM_SECONDS = 10;
export const ROUNDS = { min: 1, max: 10, default: 3 } as const;
export const NAME_MAX_LENGTH = 16;
/** Alphabet des codes de room : sans lettres ambiguës (I, O). */
export const ROOM_CODE = { alphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ", length: 4 } as const;

/**
 * Nettoie un pseudo reçu du réseau ou saisi par le joueur : retire les caractères
 * de contrôle et de format (C0, C1, bidi, largeur nulle…) qui permettraient un pseudo
 * invisible ou une usurpation, et tronque par caractère (jamais au milieu d'un emoji).
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join("").trim();
}

// --- Registre des modes ---

export interface ModeInfo {
  id: string;
  name: string;
  description: string;
}

export const MODES = {
  race: {
    id: "race",
    name: "Course",
    description: "Une seule touche pour avancer, une seule balle. Premier à l'arrivée ou dernier survivant.",
  },
} as const satisfies Record<string, ModeInfo>;

export type ModeId = keyof typeof MODES;
export const DEFAULT_MODE: ModeId = "race";

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && Object.hasOwn(MODES, value);
}

// --- Mode course ---

export const RACE = {
  entityCount: 20,
  startX: 60,
  finishX: 900,
} as const;

// --- Viseurs ---

export const AIM = {
  /** Vitesse max d'un viseur côté serveur (px/s) : la souris ne téléporte pas. */
  speed: 700,
  /** Distance max entre le centre du viseur et un personnage pour le toucher. */
  hitRadius: ENTITY_RADIUS + 4,
} as const;

/** Une couleur par joueur (viseur, salon), attribuée dans l'ordre d'arrivée. */
export const CROSSHAIR_COLORS = [0xff5a5a, 0x4dabff, 0x5ad16a, 0xffb23d, 0xc77dff, 0x3de0d0, 0xff7ac8, 0xf2f2f2] as const;

/** Un joueur = une couleur : pour accueillir plus de monde, ajouter des couleurs. */
export const MAX_PLAYERS = CROSSHAIR_COLORS.length;

export function clampToArena(x: number, y: number) {
  return { x: clamp(x, 0, ARENA.width), y: clamp(y, 0, ARENA.height) };
}

// --- État synchronisé ---
// Implémenté par les Schema du serveur (`implements`) et lu tel quel par le client :
// toute divergence casse la compilation au lieu de dériver en silence.

/** Partie de l'API Map commune aux MapSchema (serveur) et à leur version décodée (client). */
export interface ReadonlyMapLike<T> {
  readonly size: number;
  get(key: string): T | undefined;
  has(key: string): boolean;
  forEach(callback: (value: T, key: string) => void): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
  entries(): IterableIterator<[string, T]>;
  [Symbol.iterator](): IterableIterator<[string, T]>;
}

export interface EntityState {
  x: number;
  y: number;
  dir: number;
  alive: boolean;
}

/** Champs publics d'une entité. Tout ajout doit rester identique pour joueurs et PNJ. */
export const ENTITY_FIELDS = ["x", "y", "dir", "alive"] as const satisfies readonly (keyof EntityState)[];

export interface CrosshairState {
  x: number;
  y: number;
  color: number;
  loaded: boolean;
}

/** Joueur tel que le voient les autres. Ne référence JAMAIS son entité. */
export interface PlayerInfoState {
  name: string;
  color: number;
  ready: boolean;
  score: number;
}

export const PLAYER_INFO_FIELDS = ["name", "color", "ready", "score"] as const satisfies readonly (keyof PlayerInfoState)[];

export interface GameStateShape {
  phase: Phase;
  countdown: number;
  hostId: string;
  modeId: ModeId;
  totalRounds: number;
  round: number;
  players: ReadonlyMapLike<PlayerInfoState>;
  entities: ReadonlyMapLike<EntityState>;
  crosshairs: ReadonlyMapLike<CrosshairState>;
}

// --- Messages réseau ---

/** Client → serveur : intentions continues du joueur. */
export interface InputMessage {
  /** Direction voulue (le mode décide comment l'interpréter). */
  dir: Dir;
  /** Point visé, en coordonnées de l'arène. */
  aimX: number;
  aimY: number;
}

/**
 * Client → serveur : tirer sur ce point. La visée se verrouille et le coup part
 * quand le viseur l'atteint (sa vitesse reste plafonnée).
 */
export interface FireMessage {
  aimX: number;
  aimY: number;
}

/** Serveur → un seul client : ce qu'il contrôle. Jamais diffusé aux autres. */
export interface AssignMessage {
  entityId: string;
  crosshairId: string;
}

/** Serveur → tous : un tir a eu lieu. */
export interface ShotMessage {
  x: number;
  y: number;
  victim: "player" | "npc" | null;
}

/** Serveur → tous, en fin de manche uniquement : qui était joueur, et qui a gagné. */
export interface RevealMessage {
  /** Clé du gagnant dans `state.players`, ou null si personne ne gagne. */
  winnerPlayerId: string | null;
  winnerEntityId: string | null;
  players: { playerId: string; entityId: string }[];
}

/** Options envoyées en créant ou rejoignant une room. */
export interface JoinOptions {
  name: string;
}

/** Client → serveur, dans le salon : se déclarer prêt ou non. */
export interface ReadyMessage {
  ready: boolean;
}

/** Client (hôte) → serveur, dans le salon : réglages du match. */
export interface SettingsMessage {
  modeId?: ModeId;
  rounds?: number;
}

export const MSG = {
  // Salon
  ready: "ready",
  settings: "settings",
  startMatch: "startMatch",
  // Manche
  input: "input",
  fire: "fire",
  assign: "assign",
  shot: "shot",
  reveal: "reveal",
} as const;
