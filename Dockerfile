# syntax=docker/dockerfile:1
#
# Deux images, construites par docker compose :
#   - game : le serveur de jeu (Colyseus), un seul process, rooms en mémoire ;
#   - web  : Caddy, qui sert le client (build Vite) et fait suivre /colyseus au serveur.

# --- Dépendances du client (et du code partagé) ---
FROM node:22.23.3-alpine3.24 AS client-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w client -w shared

# --- Build du client ---
FROM client-deps AS client-build
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN npm run build -w client

# --- Image web : Caddy + fichiers statiques du client ---
FROM caddy:2.11.7-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=client-build /app/client/dist /srv

# --- Dépendances du serveur ---
FROM node:22.23.3-alpine3.24 AS game-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# tsx (exécution directe du TypeScript) est une dépendance de dev du serveur : on la garde.
RUN npm ci -w server -w shared

# --- Image game : serveur Colyseus ---
FROM node:22.23.3-alpine3.24 AS game
WORKDIR /app
ENV NODE_ENV=production
COPY --from=game-deps /app/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY shared shared
COPY server server
USER node
EXPOSE 2567
# Lancé depuis server/ : tsx y trouve server/tsconfig.json (décorateurs du schéma Colyseus).
# Depuis la racine, il compilerait les décorateurs autrement et le serveur planterait.
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
