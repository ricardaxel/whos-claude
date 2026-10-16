import { CROSSHAIR_COLORS, type PlayerInfoState } from "@whosclaude/shared";
import type { GameRoom } from "../net";
import { byId, playerRow } from "./dom";

/**
 * Classement par score décroissant, ex aequo au même rang (1, 1, 3…).
 * À score égal, l'ordre d'arrivée dans la room est conservé.
 */
export function rankPlayers(players: Iterable<[string, PlayerInfoState]>) {
  const sorted = [...players].sort(([, a], [, b]) => b.score - a.score);
  let rank = 0;
  return sorted.map(([id, info], i) => {
    // Un ex aequo reprend le rang du premier de son groupe.
    if (i === 0 || sorted[i - 1][1].score !== info.score) rank = i + 1;
    return { id, info, rank };
  });
}

/** Classement final du match. */
export class PodiumScreen {
  private list = byId<HTMLUListElement>("podium-players");

  render(room: GameRoom) {
    const { state, sessionId } = room;
    this.list.replaceChildren(
      ...rankPlayers(state.players.entries()).map(({ id, info, rank }) => {
        const name = `${rank}. ${info.name}${id === sessionId ? " (toi)" : ""}`;
        const points = `${info.score} pt${info.score > 1 ? "s" : ""}`;
        return playerRow(CROSSHAIR_COLORS[info.color] ?? 0xffffff, name, [{ text: points, ok: rank === 1 }]);
      }),
    );
  }
}
