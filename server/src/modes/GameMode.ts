import type { Dir } from "@whosclaude/shared";
import type { Entity } from "../GameState.js";

/** Mémoire d'un PNJ, propre au serveur. */
export interface NpcBrain {
  /** Temps restant avant que le PNJ ne change de comportement. */
  timer: number;
}

/**
 * Règles d'un mode de jeu. La room gère les joueurs et le cycle de manche,
 * le mode décide du placement, des déplacements autorisés, de l'IA et de la victoire.
 */
export interface GameMode {
  readonly entityCount: number;
  spawnPositions(): { x: number; y: number }[];
  /** Traduit l'input brut d'un joueur en direction autorisée par le mode. */
  mapInput(dir: Dir): Dir;
  /** Fait évoluer `entity.dir` pour un PNJ. */
  thinkNpc(entity: Entity, brain: NpcBrain, dt: number): void;
  hasWon(entity: Entity): boolean;
}
