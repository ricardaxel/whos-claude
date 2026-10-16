import type { Dir } from "@whosclaude/shared";
import type { Entity, GameState } from "../GameState.js";

/** Mémoire d'un PNJ, propre au serveur. */
export interface NpcBrain {
  /** Temps restant avant que le PNJ ne change de comportement. */
  timer: number;
}

/**
 * Règles d'un mode de jeu. La room gère les joueurs, le cycle de manche et les armes
 * génériques ; le mode décide du placement, des déplacements autorisés, des armes
 * disponibles, de l'IA, du décor (lumière…) et de la victoire.
 */
export interface GameMode {
  readonly entityCount: number;
  /**
   * Vitesse de sprint en multiple de la vitesse normale ; 1 = pas de sprint dans ce mode.
   * Les PNJ ne sprintent jamais : c'est une capacité qui trahit le joueur qui l'utilise.
   */
  readonly sprintMultiplier: number;
  /** Viseurs publics et une balle par joueur. */
  readonly crosshairs: boolean;
  /** Couteau au corps à corps (les PNJ ne frappent jamais). */
  readonly knife: boolean;
  /** Durée max d'une manche en secondes (0 = sans limite) ; au-delà, personne ne gagne. */
  readonly roundSeconds: number;

  spawnPositions(): { x: number; y: number }[];
  /** Traduit l'input brut d'un joueur en direction autorisée par le mode. */
  mapInput(dir: Dir): Dir;
  /** Fait évoluer `entity.dir` pour un PNJ. */
  thinkNpc(entity: Entity, brain: NpcBrain, dt: number): void;
  hasWon(entity: Entity): boolean;
  /** Prépare le décor d'une nouvelle manche (lumière…). */
  startRound?(state: GameState): void;
  /** Fait vivre le décor pendant la manche. */
  updateWorld?(state: GameState, dt: number): void;
}
