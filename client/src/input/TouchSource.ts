import Phaser from "phaser";
import type { InputSource, SourceFrame } from "./types";

/** Amplification du glisser : un petit mouvement de doigt déplace le viseur plus loin. */
const DRAG_GAIN = 1.6;

/**
 * Téléphone : boutons à l'écran (#touch-controls dans index.html) pour avancer,
 * tirer, se repérer et lancer. Glisser un doigt sur le jeu déplace le viseur
 * comme sur un trackpad, pour que le doigt ne cache pas la cible.
 */
export class TouchSource implements InputSource {
  private held = { advance: false, reveal: false };
  private pending: SourceFrame = {};
  private lastDrag = new Map<number, { x: number; y: number }>();
  private cleanups: (() => void)[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.bindHold("touch-advance", "advance");
    this.bindHold("touch-reveal", "reveal");
    this.bindTap("touch-fire", "fire");
    this.bindTap("touch-start", "start");

    scene.input.on("pointerdown", this.onPointerDown);
    scene.input.on("pointermove", this.onPointerMove);
    scene.input.on("pointerup", this.onPointerUp);
  }

  read(): SourceFrame {
    const frame: SourceFrame = { ...this.pending, ...this.held };
    this.pending = {};
    return frame;
  }

  destroy() {
    for (const cleanup of this.cleanups) cleanup();
    this.scene.input.off("pointerdown", this.onPointerDown);
    this.scene.input.off("pointermove", this.onPointerMove);
    this.scene.input.off("pointerup", this.onPointerUp);
  }

  private bindHold(id: string, intent: keyof TouchSource["held"]) {
    this.listen(id, "pointerdown", () => (this.held[intent] = true));
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
      this.listen(id, type, () => (this.held[intent] = false));
    }
  }

  private bindTap(id: string, intent: "fire" | "start") {
    this.listen(id, "pointerdown", () => (this.pending[intent] = true));
  }

  private listen(id: string, type: string, handler: () => void) {
    const element = document.getElementById(id);
    if (!element) return;
    const listener = (event: Event) => {
      event.preventDefault();
      handler();
    };
    element.addEventListener(type, listener);
    this.cleanups.push(() => element.removeEventListener(type, listener));
  }

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (pointer.wasTouch) this.lastDrag.set(pointer.id, { x: pointer.worldX, y: pointer.worldY });
  };

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    const last = this.lastDrag.get(pointer.id);
    if (!pointer.wasTouch || !last) return;
    const delta = this.pending.aimDelta ?? { x: 0, y: 0 };
    delta.x += (pointer.worldX - last.x) * DRAG_GAIN;
    delta.y += (pointer.worldY - last.y) * DRAG_GAIN;
    this.pending.aimDelta = delta;
    this.lastDrag.set(pointer.id, { x: pointer.worldX, y: pointer.worldY });
  };

  private onPointerUp = (pointer: Phaser.Input.Pointer) => {
    this.lastDrag.delete(pointer.id);
  };
}
