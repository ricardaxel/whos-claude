import { ARENA, clampToArena } from "@whosclaude/shared";
import type { InputFrame, InputSource } from "./types";

/**
 * Fusionne toutes les sources d'input actives. Le jeu ne lit que des InputFrame,
 * donc ajouter un nouveau périphérique = écrire une nouvelle InputSource.
 */
export class InputManager {
  private aim = { x: ARENA.width / 2, y: ARENA.height / 2 };

  constructor(private readonly sources: InputSource[]) {}

  /** Recale la visée, par exemple sur la position réelle du viseur au début d'une manche. */
  setAim(x: number, y: number) {
    this.aim = clampToArena(x, y);
  }

  read(dt: number): InputFrame {
    const frame: InputFrame = { advance: false, sprint: false, fire: false, start: false, aim: this.aim };
    for (const source of this.sources) {
      const s = source.read(dt);
      frame.advance ||= !!s.advance;
      frame.sprint ||= !!s.sprint;
      frame.fire ||= !!s.fire;
      frame.start ||= !!s.start;
      if (s.aimAt) this.aim = clampToArena(s.aimAt.x, s.aimAt.y);
      if (s.aimDelta) this.aim = clampToArena(this.aim.x + s.aimDelta.x, this.aim.y + s.aimDelta.y);
    }
    frame.aim = this.aim;
    return frame;
  }

  destroy() {
    for (const source of this.sources) source.destroy?.();
  }
}
