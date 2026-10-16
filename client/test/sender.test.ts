import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { IDLE, MSG, type Phase } from "@whosclaude/shared";
import { InputSender, type Outgoing } from "../src/input/InputSender";
import type { InputFrame } from "../src/input/types";

function frame(overrides: Partial<InputFrame> = {}): InputFrame {
  return { advance: false, sprint: false, fire: false, start: false, aim: { x: 480, y: 320 }, ...overrides };
}

const types = (out: Outgoing[]) => out.map((o) => o.type);

describe("InputSender", () => {
  it("rien n'est envoyé hors des phases jouables", () => {
    const sender = new InputSender();
    for (const phase of ["lobby", "roundEnd", "podium", undefined] as const) {
      expect(sender.update(frame({ advance: true, fire: true }), phase, 0)).toEqual([]);
    }
  });

  it("un changement de direction envoie un seul move, sans visée", () => {
    const sender = new InputSender();
    sender.update(frame(), "playing", 0); // première visée
    const out = sender.update(frame({ advance: true }), "playing", 10);
    expect(out).toEqual([{ type: MSG.move, message: { dir: 0, sprint: false } }]);
    expect(sender.update(frame({ advance: true }), "playing", 20)).toEqual([]);
    expect(sender.update(frame(), "playing", 30)).toEqual([{ type: MSG.move, message: { dir: IDLE, sprint: false } }]);
  });

  it("le sprint ne compte qu'en avançant, et chaque changement envoie un move", () => {
    const sender = new InputSender();
    sender.update(frame(), "playing", 0);
    expect(sender.update(frame({ sprint: true }), "playing", 10)).toEqual([]); // Maj seul : rien
    expect(sender.update(frame({ advance: true, sprint: true }), "playing", 20)).toEqual([
      { type: MSG.move, message: { dir: 0, sprint: true } },
    ]);
    expect(sender.update(frame({ advance: true }), "playing", 30)).toEqual([
      { type: MSG.move, message: { dir: 0, sprint: false } },
    ]);
  });

  it("la visée part au plus une fois par tick (50 ms), et seulement si elle a bougé", () => {
    const sender = new InputSender();
    expect(types(sender.update(frame({ aim: { x: 1, y: 1 } }), "playing", 0))).toEqual([MSG.aim]);
    expect(sender.update(frame({ aim: { x: 2, y: 2 } }), "playing", 30)).toEqual([]);
    expect(sender.update(frame({ aim: { x: 3, y: 3 } }), "playing", 50)).toEqual([{ type: MSG.aim, message: { aimX: 3, aimY: 3 } }]);
    expect(sender.update(frame({ aim: { x: 3, y: 3 } }), "playing", 200)).toEqual([]);
  });

  it("un tir emporte le point visé", () => {
    const sender = new InputSender();
    sender.update(frame(), "playing", 0);
    const out = sender.update(frame({ fire: true, aim: { x: 10, y: 20 } }), "playing", 5);
    expect(out).toContainEqual({ type: MSG.fire, message: { aimX: 10, aimY: 20 } });
  });

  it("après reset (nouvelle manche), une touche déjà enfoncée est renvoyée dès la première frame", () => {
    const sender = new InputSender();
    sender.update(frame({ advance: true }), "playing", 0); // on court en fin de manche N
    sender.update(frame({ advance: true }), "roundEnd", 100); // touche toujours enfoncée
    sender.reset(); // attribution de la manche N+1 : le serveur repart immobile
    const out = sender.update(frame({ advance: true }), "countdown", 200);
    expect(out).toContainEqual({ type: MSG.move, message: { dir: 0, sprint: false } });
    expect(types(out)).toContain(MSG.aim); // la visée est aussi renvoyée
  });

  it("propriété : en phase jouable, la direction du serveur suit toujours la touche", () => {
    const phase = fc.constantFrom<Phase>("lobby", "countdown", "playing", "roundEnd", "podium");
    const step = fc.oneof(
      fc.record({ kind: fc.constant("frame" as const), advance: fc.boolean(), phase, dt: fc.integer({ min: 0, max: 100 }) }),
      fc.constant({ kind: "newRound" as const }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 60 }), (steps) => {
        const sender = new InputSender();
        let serverDir: number = IDLE; // modèle du serveur : repart immobile à chaque manche
        let time = 0;
        for (const s of steps) {
          if (s.kind === "newRound") {
            sender.reset();
            serverDir = IDLE;
            continue;
          }
          time += s.dt;
          for (const out of sender.update(frame({ advance: s.advance }), s.phase, time)) {
            if (out.type === MSG.move) serverDir = out.message.dir;
          }
          if (s.phase === "countdown" || s.phase === "playing") expect(serverDir).toBe(s.advance ? 0 : IDLE);
        }
      }),
    );
  });
});
