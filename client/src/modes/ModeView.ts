import type Phaser from "phaser";
import type { GameStateShape, ModeId, Phase } from "@whosclaude/shared";
import type { Facing } from "../sprites/characters";
import { AssassinsView } from "./AssassinsView";
import { RaceView } from "./RaceView";

export { DEPTH } from "./depth";

/** Décor et consignes propres à un mode ; la scène gère le reste (entités, effets, interface). */
export interface ModeView {
  /** Consignes affichées en haut de l'écran, par phase. */
  readonly hints: Partial<Record<Phase, string>>;
  /**
   * Orientation de tous les personnages avant leur premier pas. Identique pour tous :
   * sinon, un joueur qui n'a pas encore bougé se distinguerait des PNJ déjà partis.
   */
  readonly initialFacing: Facing;
  update(state: GameStateShape, dt: number): void;
  destroy(): void;
}

export const MODE_VIEWS: Record<ModeId, (scene: Phaser.Scene) => ModeView> = {
  race: (scene) => new RaceView(scene),
  assassins: (scene) => new AssassinsView(scene),
};
