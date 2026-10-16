import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ARENA } from "@whosclaude/shared";
import { InputManager } from "../src/input/InputManager";
import type { InputSource, SourceFrame } from "../src/input/types";

/** Source factice : renvoie la prochaine frame programmée, puis rien. */
class FakeSource implements InputSource {
  private frames: SourceFrame[] = [];
  destroyed = false;
  push(...frames: SourceFrame[]) {
    this.frames.push(...frames);
    return this;
  }
  read() {
    return this.frames.shift() ?? {};
  }
  destroy() {
    this.destroyed = true;
  }
}

describe("InputManager", () => {
  it("part du centre de l'arène, sans aucune action", () => {
    const frame = new InputManager([]).read(0.016);
    expect(frame).toEqual({ advance: false, reveal: false, fire: false, start: false, aim: { x: ARENA.width / 2, y: ARENA.height / 2 } });
  });

  it("fusionne les boutons en OU entre les sources", () => {
    const keyboard = new FakeSource().push({ advance: true });
    const pad = new FakeSource().push({ fire: true, reveal: true });
    const touch = new FakeSource().push({ start: true });
    const frame = new InputManager([keyboard, pad, touch]).read(0.016);
    expect(frame).toMatchObject({ advance: true, fire: true, reveal: true, start: true });
  });

  it("les fronts montants ne valent que pour une frame", () => {
    const source = new FakeSource().push({ fire: true });
    const inputs = new InputManager([source]);
    expect(inputs.read(0.016).fire).toBe(true);
    expect(inputs.read(0.016).fire).toBe(false);
  });

  it("visée absolue puis relative dans la même frame, dans l'ordre des sources", () => {
    const mouse = new FakeSource().push({ aimAt: { x: 100, y: 200 } });
    const stick = new FakeSource().push({ aimDelta: { x: 10, y: -20 } });
    expect(new InputManager([mouse, stick]).read(0.016).aim).toEqual({ x: 110, y: 180 });

    // Ordre inverse : le delta s'applique d'abord, puis la souris impose sa position.
    const mouse2 = new FakeSource().push({ aimAt: { x: 100, y: 200 } });
    const stick2 = new FakeSource().push({ aimDelta: { x: 10, y: -20 } });
    expect(new InputManager([stick2, mouse2]).read(0.016).aim).toEqual({ x: 100, y: 200 });
  });

  it("la visée est conservée d'une frame à l'autre, et setAim la recale", () => {
    const source = new FakeSource().push({ aimDelta: { x: 5, y: 5 } }, {});
    const inputs = new InputManager([source]);
    const first = inputs.read(0.016).aim;
    expect(inputs.read(0.016).aim).toEqual(first);
    inputs.setAim(10, 20);
    expect(inputs.read(0.016).aim).toEqual({ x: 10, y: 20 });
    inputs.setAim(-50, 99999);
    expect(inputs.read(0.016).aim).toEqual({ x: 0, y: ARENA.height });
  });

  it("propriété : la visée reste dans l'arène quelle que soit la séquence", () => {
    const point = fc.record({ x: fc.double({ noNaN: true }), y: fc.double({ noNaN: true }) });
    fc.assert(
      fc.property(fc.array(fc.record({ aimAt: fc.option(point, { nil: undefined }), aimDelta: fc.option(point, { nil: undefined }) })), (frames) => {
        const inputs = new InputManager([new FakeSource().push(...frames)]);
        for (let i = 0; i < frames.length; i++) {
          const { aim } = inputs.read(0.016);
          expect(aim.x).toBeGreaterThanOrEqual(0);
          expect(aim.x).toBeLessThanOrEqual(ARENA.width);
          expect(aim.y).toBeGreaterThanOrEqual(0);
          expect(aim.y).toBeLessThanOrEqual(ARENA.height);
        }
      }),
    );
  });

  it("destroy libère toutes les sources", () => {
    const sources = [new FakeSource(), new FakeSource()];
    new InputManager(sources).destroy();
    expect(sources.every((s) => s.destroyed)).toBe(true);
  });
});
