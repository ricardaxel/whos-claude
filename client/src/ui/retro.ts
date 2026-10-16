import Phaser from "phaser";

/** Police pixel des menus et de l'interface en jeu (chargée par index.html). */
export const PIXEL_FONT = "DotGothic16";
export const INK = "#f4f1ea";
export const GOLD = "#f2c45a";

const PADDING_X = 14;
const PADDING_Y = 8;

export interface RetroWindowOptions {
  fontSize: number;
  /** « top » : le haut de la fenêtre est posé sur y ; « center » : la fenêtre est centrée sur y. */
  anchor: "top" | "center";
  depth: number;
  color?: string;
}

/**
 * Fenêtre de texte façon Dragon Quest : fond noir, double liseré blanc, coins arrondis.
 * Elle épouse son texte et disparaît quand il est vide.
 */
export class RetroWindow {
  readonly container: Phaser.GameObjects.Container;
  private box: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, private readonly options: RetroWindowOptions) {
    this.box = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, "", {
        fontFamily: PIXEL_FONT,
        fontSize: `${options.fontSize}px`,
        color: options.color ?? INK,
        align: "center",
        lineSpacing: 4,
      })
      .setOrigin(0.5, options.anchor === "top" ? 0 : 0.5);
    this.container = scene.add.container(x, y, [this.box, this.label]).setDepth(options.depth).setVisible(false);
  }

  get text() {
    return this.label.text;
  }

  setText(content: string) {
    if (content === this.label.text) return this;
    this.label.setText(content);
    this.container.setVisible(content !== "");
    if (content) this.redraw();
    return this;
  }

  setColor(color: string) {
    this.label.setColor(color);
    return this;
  }

  /** Petit rebond à l'apparition (compte à rebours, victoire…). */
  pop() {
    this.scene.tweens.killTweensOf(this.container);
    this.container.setScale(1.35);
    this.scene.tweens.add({ targets: this.container, scale: 1, duration: 220, ease: "Back.easeOut" });
    return this;
  }

  private redraw() {
    const w = Math.ceil(this.label.width) + 2 * PADDING_X;
    const h = Math.ceil(this.label.height) + 2 * PADDING_Y;
    const left = -w / 2;
    const top = this.options.anchor === "top" ? -PADDING_Y : -h / 2;
    const g = this.box.clear();
    g.fillStyle(0x07050b, 0.92).fillRoundedRect(left, top, w, h, 6);
    g.lineStyle(3, 0x000000, 1).strokeRoundedRect(left - 1, top - 1, w + 2, h + 2, 7);
    g.lineStyle(2, 0xf4f1ea, 1).strokeRoundedRect(left + 2, top + 2, w - 4, h - 4, 5);
    g.lineStyle(1, 0xf4f1ea, 0.85).strokeRoundedRect(left + 5.5, top + 5.5, w - 11, h - 11, 3);
  }
}
