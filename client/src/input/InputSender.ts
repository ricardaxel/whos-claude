import {
  dirFromAxes, IDLE, MSG, TICK_RATE,
  type AimMessage, type Dir, type FireMessage, type ModeId, type MoveMessage, type Phase,
} from "@whosclaude/shared";
import type { InputFrame } from "./types";

const AIM_INTERVAL_MS = 1000 / TICK_RATE;
const FORWARD: Dir = 0;
/** Seuil d'un axe analogique (stick, joystick tactile) pour compter comme une direction. */
const AXIS_THRESHOLD = 0.35;

export type Outgoing =
  | { type: typeof MSG.move; message: MoveMessage }
  | { type: typeof MSG.aim; message: AimMessage }
  | { type: typeof MSG.fire; message: FireMessage }
  | { type: typeof MSG.stab; message?: undefined };

/** Ce que chaque mode retient des intentions de la frame. */
interface ModeControls {
  dir(frame: InputFrame): Dir;
  sprint(frame: InputFrame): boolean;
  /** Le mode a-t-il un viseur (visée et tir à distance) ? */
  aims: boolean;
  /** Coup de couteau demandé pendant cette frame ? */
  stabs(frame: InputFrame): boolean;
}

const CONTROLS: Record<ModeId, ModeControls> = {
  // Course : une seule direction (avancer), sprint, viseur et une balle.
  race: {
    dir: (frame) => (frame.advance ? FORWARD : IDLE),
    // Le sprint ne compte qu'en avançant : Maj seul ne déclenche aucun message.
    sprint: (frame) => frame.advance && frame.sprint,
    aims: true,
    stabs: () => false,
  },
  // Assassins : 8 directions, pas de viseur, couteau sur l'action (ou le bouton de tir).
  assassins: {
    dir: (frame) => dirFromAxes(toStep(frame.move.x), toStep(frame.move.y)),
    sprint: () => false,
    aims: false,
    stabs: (frame) => frame.action || frame.fire,
  },
};

function toStep(axis: number) {
  return axis > AXIS_THRESHOLD ? 1 : axis < -AXIS_THRESHOLD ? -1 : 0;
}

/**
 * Décide quels messages envoyer à partir des intentions de la frame. Logique pure,
 * sans Phaser ni réseau : la scène se contente d'envoyer ce qui est renvoyé.
 *
 * - move : dès que la direction ou le sprint change, seul (jamais accompagné de la visée).
 * - aim : sur sa propre cadence (au plus un par tick), si la visée a bougé (modes à viseur).
 * - fire : à chaque front de tir, avec le point visé (modes à viseur).
 * - stab : à chaque front d'action (modes à couteau).
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

  update(frame: InputFrame, phase: Phase | undefined, time: number, modeId: ModeId = "race"): Outgoing[] {
    if (phase !== "countdown" && phase !== "playing") return [];
    const controls = CONTROLS[modeId];
    const out: Outgoing[] = [];

    if (controls.aims && frame.fire) out.push({ type: MSG.fire, message: { aimX: frame.aim.x, aimY: frame.aim.y } });
    if (controls.stabs(frame)) out.push({ type: MSG.stab });

    const dir = controls.dir(frame);
    const sprint = controls.sprint(frame);
    if (dir !== this.lastDir || sprint !== this.lastSprint) {
      out.push({ type: MSG.move, message: { dir, sprint } });
      this.lastDir = dir;
      this.lastSprint = sprint;
    }

    const aimMoved = frame.aim.x !== this.lastAim.x || frame.aim.y !== this.lastAim.y;
    if (controls.aims && aimMoved && time - this.lastAimAt >= AIM_INTERVAL_MS) {
      out.push({ type: MSG.aim, message: { aimX: frame.aim.x, aimY: frame.aim.y } });
      this.lastAim = { ...frame.aim };
      this.lastAimAt = time;
    }
    return out;
  }
}
