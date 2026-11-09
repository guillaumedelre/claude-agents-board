# Agents

Tableau de bord web des sessions [Claude Code][claude-code] et de leurs sous-agents, auto-hébergé derrière [Traefik][traefik]. Chaque session, sur n'importe quelle machine du réseau local, envoie ses [hooks][hooks] à l'application, qui les regroupe par machine et par dossier de projet et les affiche en temps réel.

- `web/` : interface React avec [Vite][vite], [Tailwind CSS][tailwind] v4 et [shadcn/ui][shadcn]. Compilée dans l'image Docker.
- `server/server.js` : serveur Node sans dépendance. Il sert l'interface et une API JSON :
  - `GET /api/health`
  - `POST /api/hooks` : reçoit le JSON d'un hook Claude Code tel quel (en-têtes optionnels `X-Agent-Host`, `X-Hook-Token`)
  - `GET /api/sessions` : résumé de toutes les sessions (sans les chronologies)
  - `GET /api/sessions/:id` : session complète, avec la chronologie de chaque agent
  - `DELETE /api/sessions/:id` : retire une session du tableau ; `DELETE /api/sessions` retire toutes les sessions fermées
  - `GET /api/stream` : flux [SSE][sse] qui signale chaque changement (l'interface recharge alors les données)
- Stockage : volume nommé `agents_data` (`/data/state.json`), écrit au plus une fois par seconde. Les sessions sans activité depuis `RETENTION_DAYS` jours (7 par défaut) sont supprimées, avec 300 sessions au maximum et 500 événements par fil.

## Ce qui est affiché

- Par session : dossier de projet, machine, modèle, mode de permission, état (en cours, au repos, en attente de toi, fermée, sans nouvelles depuis 10 minutes), prompts, appels d'outils (entrée et sortie, tronquées à 4 000 caractères), réponse finale de chaque tour.
- Par agent : type, description, consigne complète, arborescence parent / sous-agents, dernier outil utilisé, chronologie de ses outils, rapport final, tokens et durée (agents au premier plan uniquement).

Les hooks ne transmettent pas les messages intermédiaires du modèle, seulement le dernier message de chaque tour (`Stop`, `SubagentStop`).

## Démarrage

```bash
cp .env.example .env
docker compose up -d --build
```

L'application est disponible sur l'hôte `agents.${IP}.${DOMAIN}`, en HTTP (la stack n'a pas de HTTPS).

## Brancher une machine

Une machine envoie ses sessions dès que ses hooks Claude Code pointent vers l'application. L'application sert elle-même les scripts d'installation : pas besoin d'accès au dépôt.

### 1. Prérequis

- Être sur le réseau local, avec un DNS qui résout `agents.10.0.0.10.sslip.io` vers `10.0.0.10`. Certains DNS bloquent les noms publics qui pointent vers une adresse privée (protection anti-rebinding[^rebinding] de Pi-hole ou de certaines box) : tester avec `nslookup agents.10.0.0.10.sslip.io`.
- Linux et macOS : `curl` et `python3` (pour modifier `settings.json` sans l'écraser).
- Windows : Windows PowerShell 5.1 ou PowerShell 7. [Git for Windows][git-for-windows] est recommandé (voir plus bas).

### 2. Installer les hooks

Linux, macOS :

```bash
curl -fsSL http://agents.10.0.0.10.sslip.io/install-hooks.sh | sh -s -- --host <nom>
```

Windows (PowerShell) :

```powershell
& ([scriptblock]::Create((irm http://agents.10.0.0.10.sslip.io/install-hooks.ps1))) -HostName <nom>
```

`<nom>` est le nom de la machine affiché dans le tableau (lettres, chiffres, `.`, `_`, `-`) ; par défaut, le nom d'hôte. Le script :

- ajoute les hooks dans `~/.claude/settings.json` (ou `$CLAUDE_CONFIG_DIR/settings.json`), au niveau utilisateur pour couvrir tous les dossiers ;
- garde les hooks déjà présents, ne crée pas de doublon s'il est relancé, et laisse une copie de l'ancien fichier dans `settings.json.bak-agents` ;
- teste la connexion à l'application et affiche le résultat.

Options : `--url` / `-Url` pour une autre adresse, `--token` / `-Token` si `HOOK_TOKEN` est défini dans le `.env` de la stack, `--uninstall` / `-Uninstall` pour retirer les hooks.

### 3. Relancer les sessions

Une session déjà ouverte n'est pas garantie de prendre en compte les nouveaux hooks : la relancer. Elle apparaît sur le tableau à son premier événement, sans l'historique antérieur.

### Fonctionnement des hooks

- Ce sont des hooks `command` qui envoient le JSON reçu sur l'entrée standard à `POST /api/hooks`, pour 11 événements (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Notification`).
- Ce ne sont pas des hooks `"type": "http"` : Claude Code refuse un hook HTTP vers une adresse privée (`10.0.0.10`) et n'autorise que le loopback.
- Ils sont synchrones pour que les événements arrivent dans l'ordre : chaque appel d'outil attend la réponse de l'application. Si l'application ne répond pas, l'envoi abandonne au bout de 2 secondes et Claude Code continue : un hook en échec ne bloque pas l'agent.
- Sous Windows, Claude Code exécute les hooks [avec Git Bash s'il est installé, sinon avec PowerShell][hooks]. Le script détecte Git Bash : avec lui, le hook est une commande `curl.exe` ; sans lui, une commande `Invoke-RestMethod`, plus lente car PowerShell met plusieurs centaines de millisecondes à démarrer, deux fois par appel d'outil. La commande PowerShell a été testée avec PowerShell 7 sous Linux, pas sous Windows.

### Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| Le test de connexion échoue (code `000`) | Machine hors du réseau local, ou DNS qui ne résout pas `*.sslip.io` vers une adresse privée |
| Le test répond « token refusé » | `--token` différent de `HOOK_TOKEN` dans le `.env` de la stack |
| Le test passe, mais aucune session n'apparaît | Session ouverte avant l'installation (la relancer), `"disableAllHooks": true` dans un fichier de réglages, ou `allowManagedHooksOnly` imposé par une configuration d'organisation |
| `python3` introuvable (macOS) | Installer les Command Line Tools : `xcode-select --install` |

## Mise à jour

L'image est construite localement : Watchtower ne la met pas à jour. Pour reprendre aussi l'image de base Node :

```bash
docker compose build --pull && docker compose up -d
```

## Développement du front

```bash
cd web
npm install
npm run dev   # proxy /api vers http://localhost:3000
```

Pour le serveur en local, depuis ce dossier : `PORT=3000 DATA_DIR=./data node server/server.js`. Il sert le dossier `public/`, qui contient le front compilé dans l'image (`web/dist`).

## Limites connues

- Pas d'authentification sur l'interface : les prompts, les commandes et le contenu des fichiers lus par les agents sont lisibles par tout appareil du réseau local. Sans `HOOK_TOKEN`, n'importe quel appareil du réseau peut aussi envoyer de faux événements.
- Les agents lancés par un workflow n'ont pas d'appel Agent : leur consigne et leur description sont inconnues.
- L'association d'un sous-agent à l'appel qui l'a lancé est provisoire jusqu'au `PostToolUse` de cet appel (le plus ancien appel en attente du même type est retenu au démarrage).
- Une session fermée sans `SessionEnd` (plantage, terminal tué) reste « en cours », puis passe à « sans nouvelles » après 10 minutes sans événement.

[^rebinding]: Protection DNS qui refuse les réponses pointant vers une adresse privée, pour empêcher un site web d'atteindre le réseau local.

[claude-code]: https://code.claude.com/docs
[git-for-windows]: https://gitforwindows.org/
[hooks]: https://code.claude.com/docs/en/hooks
[traefik]: https://traefik.io/traefik/
[vite]: https://vite.dev/
[tailwind]: https://tailwindcss.com/
[shadcn]: https://ui.shadcn.com/
[sse]: https://html.spec.whatwg.org/multipage/server-sent-events.html
