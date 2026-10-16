import { CROSSHAIR_COLORS } from "@whosclaude/shared";
import type { GameRoom } from "../net";
import { byId, playerRow } from "./dom";

/** Classement final du match, par score décroissant. */
export class PodiumScreen {
  private list = byId<HTMLUListElement>("podium-players");

  render(room: GameRoom) {
    const { state, sessionId } = room;
    const ranking = [...state.players.entries()].sort(([, a], [, b]) => b.score - a.score);
    this.list.replaceChildren(
      ...ranking.map(([id, p], i) => {
        const name = `${i + 1}. ${p.name}${id === sessionId ? " (toi)" : ""}`;
        const points = `${p.score} pt${p.score > 1 ? "s" : ""}`;
        return playerRow(CROSSHAIR_COLORS[p.color] ?? 0xffffff, name, [{ text: points, ok: i === 0 }]);
      }),
    );
  }
}
