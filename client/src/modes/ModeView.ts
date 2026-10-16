import type Phaser from "phaser";
import type { GameStateShape, ModeId, Phase } from "@whosclaude/shared";
import { AssassinsView } from "./AssassinsView";
import { RaceView } from "./RaceView";

export { DEPTH } from "./depth";

/** Décor et consignes propres à un mode ; la scène gère le reste (entités, effets, interface). */
export interface ModeView {
  /** Consignes affichées en haut de l'écran, par phase. */
  readonly hints: Partial<Record<Phase, string>>;
  update(state: GameStateShape, dt: number): void;
  destroy(): void;
}

export const MODE_VIEWS: Record<ModeId, (scene: Phaser.Scene) => ModeView> = {
  race: (scene) => new RaceView(scene),
  assassins: (scene) => new AssassinsView(scene),
};
