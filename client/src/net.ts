import { Client, Room } from "colyseus.js";
import { GameStateShape, JoinOptions, ROOM_NAME, SERVER_PORT } from "@whosclaude/shared";

/** L'état reçu (décodé par réflexion) a la forme partagée, implémentée par le serveur. */
export type GameRoom = Room<GameStateShape>;

const client = new Client(`ws://${location.hostname}:${SERVER_PORT}`);

export async function createRoom(options: JoinOptions): Promise<GameRoom> {
  return client.create(ROOM_NAME, options);
}

/** Retour dans une partie après une coupure, avec le jeton de la connexion perdue. */
export async function reconnectRoom(token: string): Promise<GameRoom> {
  return client.reconnect(token);
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
