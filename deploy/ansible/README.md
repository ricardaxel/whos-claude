# Déploiement avec Ansible

`deploy.yml` prépare un serveur Debian ou Ubuntu et y lance le jeu. Le playbook :

1. installe Docker Engine et le plugin Compose depuis le dépôt officiel de Docker ;
2. ouvre les ports 22, 80 et 443 dans ufw, si `manage_ufw=true` ;
3. clone le dépôt dans `/opt/whosclaude` (ou le met à jour) ;
4. écrit le `.env` à partir de l'inventaire ;
5. lance `docker compose up -d --build`, puis attend que le serveur de jeu soit sain ;
6. supprime les images Docker devenues inutiles.

Il est rejouable : la même commande sert à la première installation et aux mises à jour.

## Utilisation

Depuis un poste avec Ansible (Linux, macOS ou WSL) :

```bash
cd deploy/ansible
cp inventory.example.ini inventory.ini   # puis renseigner l'hôte et site_address
ansible-playbook -i inventory.ini deploy.yml
```

Il faut :

- un accès SSH au serveur, avec un utilisateur qui a `sudo` (ajouter `-K` si sudo demande
  un mot de passe) ;
- un nom de domaine qui pointe vers le serveur, pour le HTTPS automatique ;
- la collection `community.general`, seulement si `manage_ufw=true`. Elle est fournie avec
  le paquet `ansible` complet, ou s'installe avec
  `ansible-galaxy collection install community.general`.

## Dépôt privé

Le dépôt est cloné en SSH avec la clé de ton poste, transmise par l'agent SSH
(`ForwardAgent=yes` dans l'inventaire) : aucune clé n'est copiée sur le serveur. La clé doit
donc être chargée dans ton agent (`ssh-add`). Pour cela, le clone se fait avec l'utilisateur
SSH, sans `sudo`.

Si le dépôt devient public, `repo_url=https://github.com/ricardaxel/whos-claude.git` suffit,
et la ligne `ForwardAgent` peut être retirée.

## Variables

| Variable       | Défaut                                       | Rôle                                         |
|----------------|----------------------------------------------|----------------------------------------------|
| `site_address` | (obligatoire)                                | Domaine du jeu, ou `:80` pour un essai       |
| `repo_url`     | `git@github.com:ricardaxel/whos-claude.git`  | Dépôt à cloner                               |
| `repo_version` | `main`                                       | Branche, tag ou commit à déployer            |
| `app_dir`      | `/opt/whosclaude`                            | Dossier du jeu sur le serveur                |
| `http_port`    | `80`                                         | Port HTTP publié par Caddy                   |
| `https_port`   | `443`                                        | Port HTTPS publié par Caddy                  |
| `manage_ufw`   | `false`                                      | Configurer et activer le pare-feu ufw        |
| `prune_images` | `true`                                       | Supprimer les images inutiles après déploiement |

Attention avec `manage_ufw=true` : le playbook active ufw. Si ton SSH n'écoute pas sur le
port 22, ouvre d'abord ce port à la main, sinon tu perdras l'accès au serveur.
