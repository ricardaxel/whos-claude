import { Server } from "colyseus";
import { ROOM_NAME, SERVER_PORT } from "@whosclaude/shared";
import { GameRoom } from "./GameRoom.js";

const port = Number(process.env.PORT ?? SERVER_PORT);
const gameServer = new Server();

gameServer.define(ROOM_NAME, GameRoom);
gameServer.listen(port).then(() => {
  console.log(`Serveur de jeu sur ws://localhost:${port}`);
});
