# WhosClaude

Jeu de bluff dans l'esprit de *Hidden in Plain Sight*, jouable à plusieurs à distance.

## Lancer en local

```bash
npm install
npm run dev
```

- Serveur de jeu (Colyseus) : `ws://localhost:2567`
- Client (Phaser + Vite) : http://localhost:5173. Ouvre plusieurs onglets pour simuler plusieurs joueurs.

## Déployer

Un seul serveur, deux conteneurs (`docker-compose.yml`) :

- **web** : Caddy. Il sert le client (build Vite), fait suivre `/colyseus/*` au serveur de
  jeu (WebSockets compris) et gère le **HTTPS automatiquement** (Let's Encrypt).
- **game** : le serveur Colyseus. Non exposé : seul Caddy lui parle.

Pas de load balancer : les rooms vivent en mémoire d'un seul process, qui suffit largement
pour des soirées entre amis.

### Première mise en ligne

Prérequis : un serveur avec Docker (par exemple un petit VPS) et un nom de domaine qui
pointe vers lui (ports 80 et 443 ouverts).

```bash
git clone <ce dépôt> whosclaude && cd whosclaude
cp .env.example .env    # puis renseigner SITE_ADDRESS=ton.domaine.fr
docker compose up -d --build
```

Le jeu est alors sur `https://ton.domaine.fr` ; le certificat est obtenu au premier accès.

### Mettre à jour

```bash
git pull && docker compose up -d --build
```

Les parties en cours sont coupées (rooms en mémoire) : mieux vaut mettre à jour quand
personne ne joue. Les certificats sont conservés (volume `caddy_data`).

### Essayer en local, sans domaine

Dans `.env` : `SITE_ADDRESS=:80` et `HTTP_PORT=8080`, puis `docker compose up -d --build` :
le jeu est sur `http://localhost:8080` (et sur le réseau de la maison avec l'IP du PC).

Sans Docker, `npm run build -w client && npm run preview -w client` (avec le serveur lancé)
reproduit le même routage `/colyseus` sur `http://localhost:4173`.

### Sécurité

- Caddy borne le corps des requêtes (16 Ko), ajoute les en-têtes de sécurité (CSP…) et
  transmet l'IP du joueur au serveur (`X-Real-IP`).
- Le serveur plafonne les parties ouvertes : 200 au total, 3 créées par adresse IP
  (`server/src/limits.ts`). Rejoindre une partie n'est pas limité.
- Police (DotGothic16, licence OFL) hébergée avec le jeu : aucune requête vers Google.
- Mémoire plafonnée par conteneur et logs en rotation (`docker-compose.yml`).

### Logs

```bash
docker compose logs -f game
```

## Déroulement d'une session

1. **Accueil** : choisir un pseudo, puis créer une partie ou en rejoindre une avec son code
   (4 lettres). L'URL `?room=CODE` sert de lien d'invitation.
2. **Salon** : liste des joueurs et de leur statut. L'hôte choisit le mode et le nombre de
   manches, puis lance le match quand les autres sont prêts (Entrée / Start = prêt).
   Si l'hôte part, le joueur le plus ancien prend la main. L'hôte peut **exclure** un joueur :
   son adresse IP ne peut plus rejoindre cette partie (ni les autres appareils derrière la
   même box, à garder en tête).
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
On peut se tirer dessus (on meurt) : une balle qui épargnerait son tireur le désignerait.

On gagne en franchissant l'arrivée le premier, ou en étant le dernier joueur en vie.
En fin de manche, tous les joueurs sont révélés, puis une nouvelle manche se prépare
avec de nouveaux identifiants et une nouvelle attribution des personnages.

## Mode assassins

Tout le monde (joueurs et PNJ) est dans une salle sombre et se déplace librement dans
les 8 directions. Chaque joueur a un **couteau** : il tue le personnage le plus proche à
portée de bras (avec un court temps de recharge). Les PNJ ne frappent jamais : le geste,
visible de tous, trahit donc un joueur.

Une **lumière d'ambiance** erre dans la pièce. Le geste est dessiné sous l'obscurité :
bien visible dans la lumière, à peine dans le noir. Mieux vaut frapper dans l'ombre.

Le dernier survivant gagne. Au bout de 2 minutes, la manche s'arrête sans gagnant.

## Contrôles

**Course**

| Action        | Clavier / souris     | Manette           | Téléphone                 |
|---------------|----------------------|-------------------|---------------------------|
| Avancer       | Espace, → ou D       | RT ou A           | Bouton « Avancer »        |
| Viser         | Souris               | Un des sticks     | Glisser sur le jeu        |
| Tirer         | Clic gauche ou F     | RB ou X           | Bouton « Tirer »          |
| Sprinter      | Maj + Espace         | LB ou Y + avancer | Bouton « Sprint » (avance aussi) |

**Assassins**

| Action        | Clavier / souris          | Manette      | Téléphone                          |
|---------------|---------------------------|--------------|------------------------------------|
| Se déplacer   | Flèches, ZQSD ou WASD     | Stick gauche | Glisser sur le jeu (joystick)      |
| Couteau       | Espace, E ou clic gauche  | A, RB ou X   | Bouton « Couteau »                 |

**Partout** : Entrée / Start pour se déclarer prêt dans le salon.

Les inputs passent par une couche d'abstraction (`client/src/input/`) : chaque
périphérique est une `InputSource` qui produit des intentions (avancer, se déplacer,
viser, tirer, action…), fusionnées par l'`InputManager`. `InputSender` retient ensuite
celles qui comptent dans le mode en cours. Ajouter un périphérique = écrire une nouvelle
source ; ajouter un mode = déclarer ses contrôles dans `InputSender`.

## Personnages

10 apparences en pixel art 16×16, inspirées des classes de Dragon Quest IX (guerrier,
paladin, prêtre, mage, artiste martial, voleur, ménestrel, gladiateur, rôdeur, sage).
Le serveur tire une apparence au hasard pour **chaque** personnage, joueur ou PNJ :
elle ne révèle donc rien.

Les grilles de pixels sont dans `client/src/sprites/characters.ts` (une tête, un corps et
une palette par personnage) ; le jeu en fait ses textures au démarrage.
`npm run sprites:preview` régénère les aperçus dans `docs/sprites/`.

Les deux modes se jouent dans la même **salle de donjon** (`client/src/sprites/dungeon.ts`) :
tuiles 16×16, murs de briques avec torches et tentures, dalles, quelques os et gravats.
L'éclairage tamisé (ambiance basse, coins sombres, halo chaud des torches) est calculé
une fois au démarrage ; les torches vacillent en jeu. Les personnages restent dans la
salle : la zone praticable (`PLAYFIELD`) exclut les murs, côté serveur.

## Structure

- `shared/` : constantes, règles de déplacement et messages réseau communs.
- `server/` : room Colyseus autoritaire (joueurs, viseurs, tirs, cycle de manche) et `modes/` (règles, IA des PNJ, victoire).
- `client/` : rendu Phaser, couche d'inputs, envoi des intentions et interpolation ;
  `client/src/modes/` : décor et consignes de chaque mode.

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
