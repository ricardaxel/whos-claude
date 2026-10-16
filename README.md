# WhosClaude

Jeu de bluff dans l'esprit de *Hidden in Plain Sight*, jouable à plusieurs à distance.

## Lancer en local

```bash
npm install
npm run dev
```

- Serveur de jeu (Colyseus) : `ws://localhost:2567`
- Client (Phaser + Vite) : http://localhost:5173. Ouvre plusieurs onglets pour simuler plusieurs joueurs.

## Déroulement d'une session

1. **Accueil** : choisir un pseudo, puis créer une partie ou en rejoindre une avec son code
   (4 lettres). L'URL `?room=CODE` sert de lien d'invitation.
2. **Salon** : liste des joueurs et de leur statut. L'hôte choisit le mode et le nombre de
   manches, puis lance le match quand les autres sont prêts (Entrée / Start = prêt).
   Si l'hôte part, le joueur le plus ancien prend la main.
3. **Match** : N manches, 1 point par manche gagnée. Personne ne peut rejoindre en cours de match.
4. **Podium** : classement final, puis retour automatique au salon.

Les rooms sont privées : on n'y entre qu'avec le code. Les modes sont déclarés dans
`MODES` (`shared`) et instanciés via `server/src/modes/index.ts`.

## Mode course

Tout le monde part de la ligne de départ. Une seule action pour se déplacer : avancer.
Les PNJ avancent par à-coups, donc avancer en continu, c'est se trahir.

Personne ne sait au départ quel personnage il contrôle : il faut bouger pour le découvrir,
sans se faire remarquer.

Les joueurs (et eux seuls) peuvent **sprinter** : nettement plus rapide (×1,8), mais
aucun PNJ ne va jamais aussi vite, donc on se fait repérer tout de suite.

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
| Sprinter      | Maj + Espace         | LB ou Y + avancer | Bouton « Sprint » (avance aussi) |
| Prêt (salon)  | Entrée               | Start             | Bouton du salon           |

Les inputs passent par une couche d'abstraction (`client/src/input/`) : chaque
périphérique est une `InputSource` qui produit des intentions (avancer, viser, tirer…),
fusionnées par l'`InputManager`. Ajouter un périphérique = écrire une nouvelle source.

## Structure

- `shared/` : constantes, règles de déplacement et messages réseau communs.
- `server/` : room Colyseus autoritaire (joueurs, viseurs, tirs, cycle de manche) et `modes/` (règles, IA des PNJ, victoire).
- `client/` : rendu Phaser, couche d'inputs, envoi des intentions et interpolation.

## Règle d'or : joueurs et PNJ indiscernables

- L'état diffusé ne contient que `x`, `y`, `dir` et `alive`, identiques pour tout le monde.
- La liste publique des joueurs (pseudo, couleur, score) ne référence jamais leur entité.
- Un joueur qui rejoint prend le contrôle d'un PNJ existant : aucune entité n'apparaît.
- Les identifiants d'entités et de viseurs sont aléatoires et sans lien entre eux.
- Le lien joueur ↔ entité reste sur le serveur et n'est envoyé qu'au joueur concerné.
- Le client n'utilise pas de prédiction locale : toutes les entités sont interpolées de la même façon.

## Tests

```bash
npm test
```

- `shared/test` : règles pures (pseudos, déplacements, modes).
- `server/test/units.test.ts` : modes, codes de room.
- `server/test/room.test.ts` : salon, manches et match, avec un vrai serveur Colyseus.
  Le temps est piloté par `room.tick(dt)` (`GameRoom.autoTick = false`), et les invariants
  (un seul hôte, couleurs uniques, viseurs dans l'arène…) sont vérifiés à chaque tick.
- `server/test/security.test.ts` : anti-fuite (un client espion ne doit rien apprendre
  avant la révélation, ni par les messages ni par le flux d'état), fuzzing des messages
  réseau depuis le salon et en pleine manche (`server/test/fuzz.ts`), budget de taille
  de l'état et des patches.
- `client/test` : écrans de salon et de podium (happy-dom).

Les tests n'attendent jamais « au cas où » : `send()` attend que le serveur ait traité
le message, `waitFor()` attend une condition, `syncState()` attend que le client ait
reçu l'état. `npm run test:coverage` affiche la couverture.
