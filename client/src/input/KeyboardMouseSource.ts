import Phaser from "phaser";
import type { InputSource, SourceFrame } from "./types";

/**
 * Clavier : Espace / → / D pour avancer, Maj (avec Espace) pour sprinter, Entrée pour être prêt, F pour tirer.
 * Souris : la visée suit le curseur, clic gauche pour tirer.
 */
export class KeyboardMouseSource implements InputSource {
  private keys: Record<"space" | "right" | "d" | "shift", Phaser.Input.Keyboard.Key>;
  private pending: SourceFrame = {};

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = keyboard.addKeys({ space: K.SPACE, right: K.RIGHT, d: K.D, shift: K.SHIFT }) as typeof this.keys;

    // Événements plutôt que JustDown : aucun appui bref n'est perdu entre deux frames.
    keyboard.on("keydown-ENTER", this.onStart);
    keyboard.on("keydown-F", this.onFire);
    scene.input.on("pointermove", this.onPointerMove);
    scene.input.on("pointerdown", this.onPointerDown);
  }

  read(): SourceFrame {
    const k = this.keys;
    const frame: SourceFrame = {
      ...this.pending,
      advance: k.space.isDown || k.right.isDown || k.d.isDown,
      sprint: k.shift.isDown,
    };
    this.pending = {};
    return frame;
  }

  destroy() {
    const keyboard = this.scene.input.keyboard!;
    keyboard.off("keydown-ENTER", this.onStart);
    keyboard.off("keydown-F", this.onFire);
    this.scene.input.off("pointermove", this.onPointerMove);
    this.scene.input.off("pointerdown", this.onPointerDown);
  }

  private onStart = () => (this.pending.start = true);
  private onFire = () => (this.pending.fire = true);

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    if (pointer.wasTouch) return; // le tactile a sa propre source
    this.pending.aimAt = { x: pointer.worldX, y: pointer.worldY };
  };

  private onPointerDown = (pointer: Phaser.Input.Pointer) => {
    if (pointer.wasTouch || !pointer.leftButtonDown()) return;
    this.pending.aimAt = { x: pointer.worldX, y: pointer.worldY };
    this.pending.fire = true;
  };
}
