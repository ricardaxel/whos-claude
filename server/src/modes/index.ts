import type { ModeId } from "@whosclaude/shared";
import type { GameMode } from "./GameMode.js";
import { RaceMode } from "./RaceMode.js";

/** Un mode par entrée de `MODES` (shared) : le compilateur vérifie qu'aucun ne manque. */
export const MODE_FACTORIES: Record<ModeId, () => GameMode> = {
  race: () => new RaceMode(),
};
