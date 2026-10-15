# WhosClaude

Jeu de bluff dans l'esprit de *Hidden in Plain Sight*, jouable à plusieurs à distance.

## Lancer en local

```bash
npm install
npm run dev
```

- Serveur de jeu (Colyseus) : `ws://localhost:2567`
- Client (Phaser + Vite) : http://localhost:5173. Ouvre plusieurs onglets pour simuler plusieurs joueurs.

Commandes : ZQSD ou flèches pour bouger, Maj pour te repérer.

## Structure

- `shared/` : constantes, règles de déplacement et messages réseau communs.
- `server/` : room Colyseus autoritaire, avec l'IA des PNJ et la boucle de jeu.
- `client/` : rendu Phaser, envoi des inputs et interpolation.

## Règle d'or : joueurs et PNJ indiscernables

- L'état diffusé ne contient que `x`, `y` et `dir`, identiques pour tout le monde.
- Un joueur qui rejoint prend le contrôle d'un PNJ existant : aucune entité n'apparaît.
- Les identifiants d'entités sont aléatoires.
- Le lien joueur ↔ entité reste sur le serveur et n'est envoyé qu'au joueur concerné.
- Le client n'utilise pas de prédiction locale : toutes les entités sont interpolées de la même façon.
