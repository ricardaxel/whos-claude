import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/test/**/*.test.ts", "server/test/**/*.test.ts", "client/test/**/*.test.ts"],
    // Les tests de room démarrent un vrai serveur Colyseus : un fichier à la fois.
    fileParallelism: false,
    // En processus enfant, Colyseus croit tourner sous pm2 et écrit sur process.send.
    pool: "threads",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["shared/src/**", "server/src/**", "client/src/**"],
      reporter: ["text-summary", "text"],
    },
  },
});
