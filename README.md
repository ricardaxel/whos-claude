# WhosClaude

Jeu de bluff dans l'esprit de *Hidden in Plain Sight*, jouable à plusieurs à distance.

## Lancer en local

```bash
npm install
npm run dev
```

- Serveur de jeu (Colyseus) : `ws://localhost:2567`
- Client (Phaser + Vite) : http://localhost:5173. Ouvre plusieurs onglets pour simuler plusieurs joueurs.

## Mode course

Tout le monde part de la ligne de départ. Une seule action pour se déplacer : avancer.
Les PNJ avancent par à-coups, donc avancer en continu, c'est se trahir.

Chaque joueur a aussi un viseur, visible par tous, et **une seule balle**. Le tir tue
le personnage visé, joueur ou PNJ. Le viseur a une vitesse plafonnée : quand on tire
sur un point, la visée se verrouille et le coup part quand le viseur l'atteint.

On gagne en franchissant l'arrivée le premier, ou en étant le dernier joueur en vie.
En fin de manche, tous les joueurs sont révélés, puis une nouvelle manche se prépare
avec de nouveaux identifiants et une nouvelle attribution des personnages.

## Contrôles

| Action        | Clavier / souris     | Manette           | Téléphone                 |
|---------------|----------------------|-------------------|---------------------------|
| Avancer       | Espace, → ou D       | RT ou A           | Bouton « Avancer »        |
| Viser         | Souris               | Un des sticks     | Glisser sur le jeu        |
| Tirer         | Clic gauche ou F     | RB ou X           | Bouton « Tirer »          |
| Me repérer    | Maj                  | LB ou Y           | Bouton « Moi ? »          |
| Lancer        | Entrée               | Start             | Bouton « Lancer »         |

Les inputs passent par une couche d'abstraction (`client/src/input/`) : chaque
périphérique est une `InputSource` qui produit des intentions (avancer, viser, tirer…),
fusionnées par l'`InputManager`. Ajouter un périphérique = écrire une nouvelle source.

## Structure

- `shared/` : constantes, règles de déplacement et messages réseau communs.
- `server/` : room Colyseus autoritaire (joueurs, viseurs, tirs, cycle de manche) et `modes/` (règles, IA des PNJ, victoire).
- `client/` : rendu Phaser, couche d'inputs, envoi des intentions et interpolation.

## Règle d'or : joueurs et PNJ indiscernables

- L'état diffusé ne contient que `x`, `y`, `dir` et `alive`, identiques pour tout le monde.
- Un joueur qui rejoint prend le contrôle d'un PNJ existant : aucune entité n'apparaît.
- Les identifiants d'entités et de viseurs sont aléatoires et sans lien entre eux.
- Le lien joueur ↔ entité reste sur le serveur et n'est envoyé qu'au joueur concerné.
- Le client n'utilise pas de prédiction locale : toutes les entités sont interpolées de la même façon.
