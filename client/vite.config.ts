import { defineConfig, type ProxyOptions } from "vite";

// Valeurs de shared/src/index.ts (GAME_SERVER_PATH, SERVER_PORT), recopiées : la config Vite
// est chargée par Node sans compilation, elle ne peut pas importer le TypeScript partagé.
const GAME_SERVER_PATH = "/colyseus";
const SERVER_PORT = 2567;

/**
 * Même routage qu'en production (Caddy) : /colyseus/* part vers le serveur de jeu, chemin
 * retiré, WebSockets compris. Le client n'a ainsi qu'une seule adresse, partout.
 */
const gameServer: Record<string, ProxyOptions> = {
  [GAME_SERVER_PATH]: {
    target: `http://localhost:${SERVER_PORT}`,
    ws: true,
    rewrite: (path) => path.slice(GAME_SERVER_PATH.length) || "/",
  },
};

export default defineConfig({
  server: { port: 5173, host: true, proxy: gameServer },
  preview: { port: 4173, host: true, proxy: gameServer },
  build: {
    // Phaser à part : il change rarement, les navigateurs le gardent en cache d'une mise à
    // jour du jeu à l'autre. Il pèse à lui seul plus de 1 Mo (non compressé).
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    chunkSizeWarningLimit: 1600,
  },
});
