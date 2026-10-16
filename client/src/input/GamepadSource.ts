import Phaser from "phaser";
import type { InputSource, SourceFrame } from "./types";

const DEADZONE = 0.2;
/** Vitesse de la visée au stick, en px d'arène par seconde à fond. */
const STICK_AIM_SPEED = 650;

/** Indices de la disposition « standard » de l'API Gamepad (Xbox / PlayStation). */
const BTN = { A: 0, X: 2, Y: 3, LB: 4, RB: 5, RT: 7, START: 9 } as const;

/**
 * Manette : un stick (au choix) pour viser, RT ou A pour avancer,
 * RB ou X pour tirer, Start pour être prêt, LB ou Y (maintenu) pour sprinter.
 */
export class GamepadSource implements InputSource {
  private previous = new Map<number, boolean[]>();

  constructor(private readonly scene: Phaser.Scene) {}

  read(dt: number): SourceFrame {
    const plugin = this.scene.input.gamepad;
    if (!plugin || plugin.total === 0) return {};

    const frame: SourceFrame = { aimDelta: { x: 0, y: 0 } };
    for (const pad of plugin.gamepads) {
      if (!pad?.connected) continue;
      const pressed = pad.buttons.map((b) => b.pressed);
      const before = this.previous.get(pad.index) ?? [];
      const justPressed = (i: number) => !!pressed[i] && !before[i];
      this.previous.set(pad.index, pressed);

      frame.advance ||= pressed[BTN.RT] || pressed[BTN.A];
      frame.sprint ||= pressed[BTN.LB] || pressed[BTN.Y];
      frame.fire ||= justPressed(BTN.RB) || justPressed(BTN.X);
      frame.start ||= justPressed(BTN.START);

      for (const stick of [pad.leftStick, pad.rightStick]) {
        if (stick.length() < DEADZONE) continue;
        frame.aimDelta!.x += stick.x * STICK_AIM_SPEED * dt;
        frame.aimDelta!.y += stick.y * STICK_AIM_SPEED * dt;
      }
    }
    return frame;
  }
}
