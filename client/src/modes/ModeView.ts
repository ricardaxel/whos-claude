import type Phaser from "phaser";
import type { GameStateShape, ModeId } from "@whosclaude/shared";
import type { Facing } from "../sprites/characters";
import { AssassinsView } from "./AssassinsView";
import { RaceView } from "./RaceView";

export { DEPTH } from "./depth";

/**
 * Décor propre à un mode ; la scène gère le reste (entités, effets, interface).
 * Les règles et commandes sont expliquées dans le salon (ui/modeGuides.ts), pas en jeu.
 */
export interface ModeView {
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
