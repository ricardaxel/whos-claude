// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./page";

// Phaser complet ne se charge pas hors navigateur : seules les constantes de touches servent ici.
vi.mock("phaser", () => ({
  default: {
    Input: {
      Keyboard: {
        KeyCodes: { SPACE: 32, SHIFT: 16, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, A: 65, D: 68, E: 69, Q: 81, S: 83, W: 87, Z: 90 },
      },
    },
  },
}));

const { KeyboardMouseSource } = await import("../src/input/KeyboardMouseSource");
const { GamepadSource } = await import("../src/input/GamepadSource");
const { TouchSource } = await import("../src/input/TouchSource");

type Handler = (...args: unknown[]) => void;

/** Émetteur minimal, comme scene.input et scene.input.keyboard de Phaser. */
function emitter() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    on: (event: string, handler: Handler) => void (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler),
    off: (event: string, handler: Handler) => void handlers.get(event)?.delete(handler),
    emit: (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((h) => h(...args)),
    count: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
  };
}

function pointer(overrides: Record<string, unknown> = {}) {
  return { id: 1, wasTouch: false, worldX: 0, worldY: 0, leftButtonDown: () => true, ...overrides };
}

/** Fausse scène : clavier dont les touches sont des { isDown } pilotables, souris, manettes. */
function fakeScene(gamepads?: unknown[]) {
  const keys: Record<string, { isDown: boolean }> = {};
  const keyboard = Object.assign(emitter(), {
    addKeys: (codes: Record<string, number>) => {
      for (const name of Object.keys(codes)) keys[name] = { isDown: false };
      return keys;
    },
  });
  const input = Object.assign(emitter(), {
    keyboard,
    gamepad: gamepads ? { total: gamepads.length, gamepads } : undefined,
  });
  return { scene: { input } as never, keys, keyboard, input };
}

describe("KeyboardMouseSource", () => {
  it("Espace, → ou D avancent ; Maj sprinte", () => {
    const { scene, keys } = fakeScene();
    const source = new KeyboardMouseSource(scene);
    expect(source.read()).toMatchObject({ advance: false, sprint: false });
    for (const key of ["space", "right", "d"]) {
      keys[key].isDown = true;
      expect(source.read().advance).toBe(true);
      keys[key].isDown = false;
    }
    keys.shift.isDown = true;
    expect(source.read().sprint).toBe(true);
  });

  it("déplacement libre : flèches, ZQSD et WASD", () => {
    const { scene, keys } = fakeScene();
    const source = new KeyboardMouseSource(scene);
    const cases: [string, { x: number; y: number }][] = [
      ["right", { x: 1, y: 0 }], ["d", { x: 1, y: 0 }],
      ["left", { x: -1, y: 0 }], ["q", { x: -1, y: 0 }], ["a", { x: -1, y: 0 }],
      ["up", { x: 0, y: -1 }], ["z", { x: 0, y: -1 }], ["w", { x: 0, y: -1 }],
      ["down", { x: 0, y: 1 }], ["s", { x: 0, y: 1 }],
    ];
    for (const [key, move] of cases) {
      keys[key].isDown = true;
      expect(source.read().move, key).toEqual(move);
      keys[key].isDown = false;
    }
    keys.right.isDown = keys.down.isDown = true;
    expect(source.read().move).toEqual({ x: 1, y: 1 });
  });

  it("Espace ou E déclenchent l'action, une fois par appui", () => {
    const { scene, keyboard } = fakeScene();
    const source = new KeyboardMouseSource(scene);
    keyboard.emit("keydown-SPACE");
    expect(source.read().action).toBe(true);
    expect(source.read().action).toBeUndefined();
    keyboard.emit("keydown-E");
    expect(source.read().action).toBe(true);
  });

  it("Entrée = prêt et F = tir, une seule fois par appui", () => {
    const { scene, keyboard } = fakeScene();
    const source = new KeyboardMouseSource(scene);
    keyboard.emit("keydown-ENTER");
    keyboard.emit("keydown-F");
    expect(source.read()).toMatchObject({ start: true, fire: true });
    const next = source.read();
    expect(next.start).toBeUndefined();
    expect(next.fire).toBeUndefined();
  });

  it("la souris vise et tire ; les doigts sont laissés au tactile", () => {
    const { scene, input } = fakeScene();
    const source = new KeyboardMouseSource(scene);
    input.emit("pointermove", pointer({ worldX: 10, worldY: 20 }));
    expect(source.read().aimAt).toEqual({ x: 10, y: 20 });
    input.emit("pointerdown", pointer({ worldX: 30, worldY: 40 }));
    expect(source.read()).toMatchObject({ fire: true, aimAt: { x: 30, y: 40 } });
    input.emit("pointermove", pointer({ wasTouch: true, worldX: 99, worldY: 99 }));
    expect(source.read().aimAt).toBeUndefined();
  });

  it("destroy retire tous les écouteurs", () => {
    const { scene, input, keyboard } = fakeScene();
    new KeyboardMouseSource(scene).destroy();
    expect(input.count() + keyboard.count()).toBe(0);
  });
});

describe("GamepadSource", () => {
  /** Manette au format standard de l'API Gamepad, boutons pressés par indice. */
  function pad(pressed: number[] = [], stick = { x: 0, y: 0 }) {
    const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) }));
    const vector = { ...stick, length: () => Math.hypot(stick.x, stick.y) };
    return { index: 0, connected: true, buttons, leftStick: vector, rightStick: { x: 0, y: 0, length: () => 0 } };
  }
  const BTN = { A: 0, X: 2, Y: 3, LB: 4, RB: 5, RT: 7, START: 9 };

  it("sans manette, rien", () => {
    expect(new GamepadSource(fakeScene().scene).read(0.016)).toEqual({});
  });

  it("RT ou A avancent ; LB ou Y sprintent", () => {
    for (const [button, field] of [[BTN.RT, "advance"], [BTN.A, "advance"], [BTN.LB, "sprint"], [BTN.Y, "sprint"]] as const) {
      const source = new GamepadSource(fakeScene([pad([button])]).scene);
      expect(source.read(0.016)[field]).toBe(true);
    }
  });

  it("RB/X tirent et Start valide, seulement au moment de l'appui", () => {
    const pads = [pad([BTN.RB, BTN.START])];
    const source = new GamepadSource(fakeScene(pads).scene);
    expect(source.read(0.016)).toMatchObject({ fire: true, start: true });
    expect(source.read(0.016)).toMatchObject({ fire: false, start: false }); // toujours enfoncés
    pads[0] = pad([BTN.X]);
    expect(source.read(0.016).fire).toBe(true);
  });

  it("le stick gauche déplace, A déclenche l'action", () => {
    const pads = [pad([BTN.A], { x: 0.7, y: -0.7 })];
    const source = new GamepadSource(fakeScene(pads).scene);
    const frame = source.read(0.016);
    expect(frame.move).toEqual({ x: 0.7, y: -0.7 });
    expect(frame.action).toBe(true);
    expect(source.read(0.016).action).toBe(false); // A toujours enfoncé : pas de nouveau coup
  });

  it("le stick vise en relatif, avec une zone morte", () => {
    expect(new GamepadSource(fakeScene([pad([], { x: 0.1, y: 0 })]).scene).read(1).aimDelta).toEqual({ x: 0, y: 0 });
    const delta = new GamepadSource(fakeScene([pad([], { x: 1, y: 0 })]).scene).read(0.5).aimDelta!;
    expect(delta.x).toBeGreaterThan(0);
    expect(delta.y).toBe(0);
  });
});

describe("TouchSource", () => {
  beforeEach(loadPage);

  const press = (id: string, type = "pointerdown") => document.getElementById(id)!.dispatchEvent(new Event(type));

  it("Avancer se maintient, et se relâche", () => {
    const source = new TouchSource(fakeScene().scene);
    press("touch-advance");
    expect(source.read()).toMatchObject({ advance: true, sprint: false });
    press("touch-advance", "pointerup");
    expect(source.read().advance).toBe(false);
  });

  it("Sprint fait aussi avancer : un seul pouce suffit à sprinter", () => {
    const source = new TouchSource(fakeScene().scene);
    press("touch-sprint");
    expect(source.read()).toMatchObject({ advance: true, sprint: true });
    press("touch-sprint", "pointercancel");
    expect(source.read()).toMatchObject({ advance: false, sprint: false });
  });

  it("joystick virtuel : le décalage du doigt depuis son point d'appui donne le déplacement", () => {
    const { scene, input } = fakeScene();
    const source = new TouchSource(scene);
    input.emit("pointerdown", pointer({ wasTouch: true, worldX: 200, worldY: 200 }));
    expect(source.read().move).toEqual({ x: 0, y: 0 });
    input.emit("pointermove", pointer({ wasTouch: true, worldX: 203, worldY: 200 })); // zone morte
    expect(source.read().move).toEqual({ x: 0, y: 0 });
    input.emit("pointermove", pointer({ wasTouch: true, worldX: 300, worldY: 200 })); // à fond à droite
    expect(source.read().move).toEqual({ x: 1, y: 0 });
    input.emit("pointerup", pointer({ wasTouch: true }));
    expect(source.read().move).toEqual({ x: 0, y: 0 });
  });

  it("Couteau : une action par appui", () => {
    const source = new TouchSource(fakeScene().scene);
    press("touch-stab");
    expect(source.read().action).toBe(true);
    expect(source.read().action).toBeUndefined();
  });

  it("Tirer : une fois par appui", () => {
    const source = new TouchSource(fakeScene().scene);
    press("touch-fire");
    expect(source.read().fire).toBe(true);
    expect(source.read().fire).toBeUndefined();
  });

  it("glisser un doigt sur le jeu déplace la visée (amplifiée), la souris non", () => {
    const { scene, input } = fakeScene();
    const source = new TouchSource(scene);
    input.emit("pointerdown", pointer({ wasTouch: true, worldX: 100, worldY: 100 }));
    input.emit("pointermove", pointer({ wasTouch: true, worldX: 110, worldY: 100 }));
    const delta = source.read().aimDelta!;
    expect(delta.x).toBeGreaterThan(10);
    expect(delta.y).toBe(0);
    input.emit("pointermove", pointer({ wasTouch: false, worldX: 500, worldY: 500 }));
    expect(source.read().aimDelta).toBeUndefined();
  });

  it("destroy retire les écouteurs des boutons et de la scène", () => {
    const { scene, input } = fakeScene();
    const source = new TouchSource(scene);
    source.destroy();
    press("touch-advance");
    expect(source.read().advance).toBe(false);
    expect(input.count()).toBe(0);
  });
});
