import { MAX_PLAYERS, type ModeId } from "@whosclaude/shared";
import type { GameMode } from "./GameMode.js";
import { AssassinsMode } from "./AssassinsMode.js";
import { RaceMode } from "./RaceMode.js";

/** Un mode par entrée de `MODES` (shared) : le compilateur vérifie qu'aucun ne manque. */
export const MODE_FACTORIES: Record<ModeId, () => GameMode> = {
  race: () => new RaceMode(),
  assassins: () => new AssassinsMode(),
};

export function createMode(id: ModeId): GameMode {
  const mode = MODE_FACTORIES[id]();
  // Chaque joueur prend le contrôle d'un PNJ : il en faut au moins un par joueur possible.
  if (mode.entityCount < MAX_PLAYERS) {
    throw new Error(`Mode "${id}" : ${mode.entityCount} entités pour ${MAX_PLAYERS} joueurs max.`);
  }
  return mode;
}
