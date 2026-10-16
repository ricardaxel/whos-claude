import {
  IDLE, MSG, TICK_RATE,
  type AimMessage, type Dir, type FireMessage, type MoveMessage, type Phase,
} from "@whosclaude/shared";
import type { InputFrame } from "./types";

const AIM_INTERVAL_MS = 1000 / TICK_RATE;
const FORWARD: Dir = 0;

export type Outgoing =
  | { type: typeof MSG.move; message: MoveMessage }
  | { type: typeof MSG.aim; message: AimMessage }
  | { type: typeof MSG.fire; message: FireMessage };

/**
 * Décide quels messages envoyer à partir des intentions de la frame. Logique pure,
 * sans Phaser ni réseau : la scène se contente d'envoyer ce qui est renvoyé.
 *
 * - move : dès que la direction ou le sprint change, seul (jamais accompagné de la visée).
 * - aim : sur sa propre cadence (au plus un par tick), si la visée a bougé.
 * - fire : à chaque front de tir, avec le point visé.
 * Rien n'est envoyé hors des phases jouables.
 */
export class InputSender {
  private lastDir: Dir = IDLE;
  private lastSprint = false;
  private lastAim = { x: NaN, y: NaN };
  private lastAimAt = -Infinity;

  /**
   * À appeler à chaque nouvelle attribution (nouvelle manche, nouvelle room) :
   * le serveur repart alors d'une entité immobile, et le client doit faire de même.
   * Sinon une touche encore enfoncée depuis la manche précédente ne serait pas renvoyée.
   */
  reset() {
    this.lastDir = IDLE;
    this.lastSprint = false;
    this.lastAim = { x: NaN, y: NaN }; // force l'envoi de la première visée
    this.lastAimAt = -Infinity;
  }

  update(frame: InputFrame, phase: Phase | undefined, time: number): Outgoing[] {
    if (phase !== "countdown" && phase !== "playing") return [];
    const out: Outgoing[] = [];

    if (frame.fire) out.push({ type: MSG.fire, message: { aimX: frame.aim.x, aimY: frame.aim.y } });

    const dir: Dir = frame.advance ? FORWARD : IDLE;
    // Le sprint ne compte qu'en avançant : Maj seul ne déclenche aucun message.
    const sprint = frame.advance && frame.sprint;
    if (dir !== this.lastDir || sprint !== this.lastSprint) {
      out.push({ type: MSG.move, message: { dir, sprint } });
      this.lastDir = dir;
      this.lastSprint = sprint;
    }

    const aimMoved = frame.aim.x !== this.lastAim.x || frame.aim.y !== this.lastAim.y;
    if (aimMoved && time - this.lastAimAt >= AIM_INTERVAL_MS) {
      out.push({ type: MSG.aim, message: { aimX: frame.aim.x, aimY: frame.aim.y } });
      this.lastAim = { ...frame.aim };
      this.lastAimAt = time;
    }
    return out;
  }
}
