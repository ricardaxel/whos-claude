import Phaser from "phaser";
import { ARENA } from "@whosclaude/shared";
import { GameScene } from "./GameScene";
import { Session } from "./session";

const scene = new GameScene();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: ARENA.width,
  height: ARENA.height,
  backgroundColor: "#2b3a2f",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { gamepad: true, activePointers: 2 },
  scene: [scene],
});

new Session(scene);

// Débogage en développement uniquement : window.__game dans la console du navigateur.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
