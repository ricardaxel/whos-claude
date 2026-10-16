import { Server } from "colyseus";
import { ROOM_NAME } from "@whosclaude/shared";
import { GameRoom } from "./GameRoom.js";

/** Serveur configuré, sans écouter de port : partagé par index.ts et les tests. */
export function createGameServer() {
  const gameServer = new Server();
  gameServer.define(ROOM_NAME, GameRoom);
  return gameServer;
}
