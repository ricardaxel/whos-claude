import Phaser from "phaser";
import type { InputSource, SourceFrame } from "./types";

type KeyName = "space" | "shift" | "left" | "right" | "up" | "down" | "z" | "q" | "s" | "d" | "w" | "a";

const axis = (positive: boolean, negative: boolean) => (positive ? 1 : 0) - (negative ? 1 : 0);

/** Touches du jeu dont on bloque l'effet par défaut (défilement, clic sur un bouton) en jeu. */
const GAME_KEYS = new Set([
  "Space", "ShiftLeft", "ShiftRight", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "KeyZ", "KeyQ", "KeyS", "KeyD", "KeyW", "KeyA", "KeyE", "KeyF", "Enter",
]);

/** Saisie en cours dans un champ (pseudo, code de partie…) : le clavier lui appartient. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Clavier : Espace / → / D pour avancer, Maj (avec Espace) pour sprinter, Entrée pour être prêt, F pour tirer.
 * Déplacement libre : flèches, ZQSD (AZERTY) ou WASD (QWERTY). Action (couteau) : Espace ou E.
 * Souris : la visée suit le curseur, clic gauche pour tirer.
 * Selon le mode, une même touche peut porter deux intentions (Espace : avancer / couteau) ;
 * c'est InputSender qui choisit celle qui compte.
 */
export class KeyboardMouseSource implements InputSource {
  private keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private pending: SourceFrame = {};

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = keyboard.addKeys({
      space: K.SPACE, shift: K.SHIFT,
      left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN,
      z: K.Z, q: K.Q, s: K.S, d: K.D, w: K.W, a: K.A,
    }, false) as typeof this.keys;
    // Pas de capture globale par Phaser : elle bloquerait ces lettres partout, jusque dans le
    // champ du pseudo. On ne bloque l'effet par défaut des touches qu'en jeu (voir onKeyDown).
    keyboard.disableGlobalCapture();
    window.addEventListener("keydown", this.onKeyDown);

    // Événements plutôt que JustDown : aucun appui bref n'est perdu entre deux frames.
    keyboard.on("keydown-ENTER", this.onStart);
    keyboard.on("keydown-F", this.onFire);
    keyboard.on("keydown-SPACE", this.onAction);
    keyboard.on("keydown-E", this.onAction);
    scene.input.on("pointermove", this.onPointerMove);
    scene.input.on("pointerdown", this.onPointerDown);
  }

  read(): SourceFrame {
    const k = this.keys;
    const frame: SourceFrame = {
      ...this.pending,
      advance: k.space.isDown || k.right.isDown || k.d.isDown,
      sprint: k.shift.isDown,
      move: {
        x: axis(k.right.isDown || k.d.isDown, k.left.isDown || k.q.isDown || k.a.isDown),
        y: axis(k.down.isDown || k.s.isDown, k.up.isDown || k.z.isDown || k.w.isDown),
      },
    };
    this.pending = {};
    return frame;
  }

  destroy() {
    const keyboard = this.scene.input.keyboard!;
    window.removeEventListener("keydown", this.onKeyDown);
    keyboard.off("keydown-ENTER", this.onStart);
    keyboard.off("keydown-F", this.onFire);
    keyboard.off("keydown-SPACE", this.onAction);
    keyboard.off("keydown-E", this.onAction);
    this.scene.input.off("pointermove", this.onPointerMove);
    this.scene.input.off("pointerdown", this.onPointerDown);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (document.body.dataset.screen === "game" && GAME_KEYS.has(event.code) && !isTyping(event.target)) {
      event.preventDefault();
    }
  };

  private onStart = () => (this.pending.start = true);
  private onFire = () => (this.pending.fire = true);
  private onAction = () => (this.pending.action = true);

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
