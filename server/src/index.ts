import { SERVER_PORT } from "@whosclaude/shared";
import { createGameServer } from "./app.js";

const port = Number(process.env.PORT ?? SERVER_PORT);

createGameServer().listen(port).then(() => {
  console.log(`Serveur de jeu sur ws://localhost:${port}`);
});
