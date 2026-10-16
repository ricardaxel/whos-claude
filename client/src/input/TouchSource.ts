import Phaser from "phaser";
import type { InputSource, SourceFrame } from "./types";

// Réglages en pixels d'ÉCRAN (CSS) : le même geste du pouce donne le même effet
// quelle que soit la taille d'affichage du jeu (téléphone, tablette).
/** Visée : px d'arène parcourus par le viseur pour 1 px de glisser à l'écran. */
const DRAG_GAIN = 2;
/** Joystick virtuel : décalage du doigt (px écran) qui correspond à « à fond ». */
const STICK_RANGE = 50;
/** En dessous de ce décalage (px écran), le joystick est au repos. */
const STICK_DEADZONE = 10;

/**
 * Téléphone : boutons à l'écran (#touch-controls dans index.html) pour avancer,
 * sprinter et tirer. Glisser un doigt sur le jeu déplace le viseur
 * comme sur un trackpad, pour que le doigt ne cache pas la cible.
 *
 * « Sprint » fait aussi avancer : le pouce gauche choisit entre marcher et sprinter,
 * le pouce droit reste libre pour viser et tirer (deux pouces suffisent).
 *
 * Le même glisser sert aussi de joystick virtuel (déplacement libre : décalage du doigt
 * depuis l'endroit où il s'est posé), avec le bouton « Couteau » pour l'action.
 * InputSender retient l'un ou l'autre selon le mode.
 */
export class TouchSource implements InputSource {
  private held = { advance: false, sprint: false };
  private pending: SourceFrame = {};
  private lastDrag = new Map<number, { x: number; y: number }>();
  /** Doigt du joystick : point d'appui et position courante. */
  private stick?: { id: number; startX: number; startY: number; x: number; y: number };
  private cleanups: (() => void)[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.bindHold("touch-advance", "advance");
    this.bindHold("touch-sprint", "sprint");
    this.bindTap("touch-fire", "fire");
    this.bindTap("touch-stab", "action");

    scene.input.on("pointerdown", this.onPointerDown);
    scene.input.on("pointermove", this.onPointerMove);
    scene.input.on("pointerup", this.onPointerUp);
  }

  read(): SourceFrame {
    const frame: SourceFrame = {
      ...this.pending,
      advance: this.held.advance || this.held.sprint,
      sprint: this.held.sprint,
      move: this.stickVector(),
    };
    this.pending = {};
    return frame;
  }

  /**
   * Certains Android ne livrent aucun pointercancel quand l'appli passe en arrière-plan :
   * sans ça, « Avancer » resterait enfoncé et le personnage repartirait au retour.
   */
  release() {
    this.held = { advance: false, sprint: false };
    this.stick = undefined;
    this.lastDrag.clear();
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

  private bindTap(id: string, intent: "fire" | "start" | "action") {
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
    if (!pointer.wasTouch) return;
    this.lastDrag.set(pointer.id, { x: pointer.worldX, y: pointer.worldY });
    this.stick ??= { id: pointer.id, startX: pointer.worldX, startY: pointer.worldY, x: pointer.worldX, y: pointer.worldY };
  };

  private stickVector() {
    if (!this.stick) return { x: 0, y: 0 };
    const { x: dx, y: dy } = this.toScreen(this.stick.x - this.stick.startX, this.stick.y - this.stick.startY);
    const length = Math.hypot(dx, dy);
    if (length < STICK_DEADZONE) return { x: 0, y: 0 };
    const scale = Math.min(1, length / STICK_RANGE) / length;
    return { x: dx * scale, y: dy * scale };
  }

  private onPointerMove = (pointer: Phaser.Input.Pointer) => {
    const last = this.lastDrag.get(pointer.id);
    if (!pointer.wasTouch || !last) return;
    const delta = this.pending.aimDelta ?? { x: 0, y: 0 };
    const moved = this.toScreen(pointer.worldX - last.x, pointer.worldY - last.y);
    delta.x += moved.x * DRAG_GAIN;
    delta.y += moved.y * DRAG_GAIN;
    this.pending.aimDelta = delta;
    this.lastDrag.set(pointer.id, { x: pointer.worldX, y: pointer.worldY });
    if (this.stick?.id === pointer.id) {
      this.stick.x = pointer.worldX;
      this.stick.y = pointer.worldY;
    }
  };

  /** Convertit un écart en px d'arène en px d'écran (displayScale = px d'arène par px écran). */
  private toScreen(dx: number, dy: number) {
    const scale = this.scene.scale?.displayScale ?? { x: 1, y: 1 };
    return { x: dx / scale.x, y: dy / scale.y };
  }

  private onPointerUp = (pointer: Phaser.Input.Pointer) => {
    this.lastDrag.delete(pointer.id);
    if (this.stick?.id === pointer.id) this.stick = undefined;
  };
}
