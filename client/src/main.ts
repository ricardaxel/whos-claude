import Phaser from "phaser";
import { ARENA } from "@whosclaude/shared";
import { GameScene } from "./GameScene";
import { Session } from "./session";
import { renderDungeon, ROOM_HEIGHT, ROOM_WIDTH } from "./sprites/dungeon";
import { PIXEL_FONT } from "./ui/retro";

/** Les menus s'affichent sur la salle de donjon (assombrie par la feuille de style). */
function useDungeonAsMenuBackdrop() {
  const canvas = document.createElement("canvas");
  canvas.width = ROOM_WIDTH;
  canvas.height = ROOM_HEIGHT;
  canvas.getContext("2d")!.putImageData(new ImageData(renderDungeon(), ROOM_WIDTH, ROOM_HEIGHT), 0, 0);
  document.documentElement.style.setProperty("--backdrop", `url(${canvas.toDataURL()})`);
}

/** Attend la police pixel (au plus 1,5 s) : les textes du canvas la prennent à leur création. */
async function waitForPixelFont() {
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.race([document.fonts.load(`16px "${PIXEL_FONT}"`).catch(() => undefined), timeout]);
}

async function start() {
  useDungeonAsMenuBackdrop();
  await waitForPixelFont();

  const scene = new GameScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: ARENA.width,
    height: ARENA.height,
    backgroundColor: "#0b090f",
    // Pixel art : pas de lissage, pixels nets à toutes les échelles.
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { gamepad: true, activePointers: 2 },
    scene: [scene],
  });

  new Session(scene);

  // Débogage en développement uniquement : window.__game dans la console du navigateur.
  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
}

void start();
