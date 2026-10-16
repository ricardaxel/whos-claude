import { Client, Room } from "colyseus.js";
import { JoinOptions, ModeId, Phase, ROOM_NAME, SERVER_PORT } from "@whosclaude/shared";

/**
 * Forme de l'état reçu du serveur (décodé par réflexion côté client).
 * Doit rester alignée avec server/src/GameState.ts.
 */
export interface PlayerInfoView {
  name: string;
  color: number;
  ready: boolean;
  score: number;
}

export interface GameStateView {
  phase: Phase;
  countdown: number;
  hostId: string;
  modeId: ModeId;
  totalRounds: number;
  round: number;
  players: Map<string, PlayerInfoView>;
  entities: Map<string, { x: number; y: number; dir: number; alive: boolean }>;
  crosshairs: Map<string, { x: number; y: number; color: number; loaded: boolean }>;
}

export type GameRoom = Room<GameStateView>;

const client = new Client(`ws://${location.hostname}:${SERVER_PORT}`);

export async function createRoom(options: JoinOptions): Promise<GameRoom> {
  return client.create(ROOM_NAME, options);
}

export async function joinRoom(code: string, options: JoinOptions): Promise<GameRoom> {
  try {
    return await client.joinById(code.toUpperCase(), options);
  } catch (error) {
    throw new Error(describeJoinError(error));
  }
}

function describeJoinError(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: number; message?: string };
  // 4212 : identifiant de room inconnu (code Colyseus ERR_MATCHMAKE_INVALID_ROOM_ID).
  if (code === 4212) return "Aucune partie avec ce code.";
  if (message?.includes("full")) return "Cette partie est complète.";
  return message || "Impossible de rejoindre la partie.";
}
