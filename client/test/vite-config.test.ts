import { describe, expect, it } from "vitest";
import { GAME_SERVER_PATH, SERVER_PORT } from "@whosclaude/shared";
import config from "../vite.config";

describe("configuration Vite", () => {
  it("fait suivre le même chemin que Caddy vers le port du serveur de jeu (valeurs recopiées de shared)", () => {
    for (const proxy of [config.server?.proxy, config.preview?.proxy]) {
      const route = (proxy as Record<string, { target: string; ws: boolean; rewrite: (p: string) => string }>)[GAME_SERVER_PATH];
      expect(route.target).toBe(`http://localhost:${SERVER_PORT}`);
      expect(route.ws).toBe(true);
      expect(route.rewrite(`${GAME_SERVER_PATH}/matchmake/create/game`)).toBe("/matchmake/create/game");
    }
  });
});
