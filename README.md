# Agents

Tableau de bord web des sessions [Claude Code][claude-code] et de leurs sous-agents, auto-hébergé derrière [Traefik][traefik]. Chaque session, sur n'importe quelle machine du réseau local, envoie ses [hooks][hooks] à l'application, qui les affiche en temps réel, regroupées par machine puis par dossier de projet.

- `web/` : interface React avec [Vite][vite], [Tailwind CSS][tailwind] v4 et [shadcn/ui][shadcn]. Compilée dans l'image Docker.
- `server/server.js` : serveur Node sans dépendance. Il sert l'interface et une API JSON :
  - `GET /api/health`
  - `POST /api/hooks` : reçoit le JSON d'un hook Claude Code tel quel (en-têtes optionnels `X-Agent-Host`, `X-Hook-Token`)
  - `GET /api/sessions` : résumé de toutes les sessions (sans les chronologies)
  - `GET /api/sessions/:id` : session complète, avec la chronologie de chaque agent, les tours de conversation, les tâches et les estimations de durée
  - `PATCH /api/sessions/:id` : `{ "name": "..." }` renomme une session (80 caractères au maximum ; vide pour revenir au nom automatique)
  - `DELETE /api/sessions` : retire les sessions fermées et celles sans nouvelles depuis 10 minutes
  - `GET /api/settings`, `PUT /api/settings` : `{ "autoCleanupMs": 86400000 }` (délai du nettoyage automatique : `0`, 1 h, 24 h ou 7 jours)
  - `GET /api/stream` : flux [SSE][sse] qui signale chaque changement (l'interface recharge alors les données)
- Stockage : volume nommé `agents_data` (`/data/state.json`), écrit au plus une fois par seconde : sessions, réglages et historique des durées. Les sessions sans activité depuis `RETENTION_DAYS` jours (7 par défaut) sont supprimées, avec 300 sessions au maximum et 500 événements par fil. L'historique des durées (agents et tâches terminés) est gardé à part, 30 jours et 5 000 entrées au maximum. Les compteurs d'activité par heure (heatmap de l'accueil) sont gardés 8 jours, indépendamment des sessions retirées.

## Ce qui est affiché

La page d'accueil (titre « Agents » de la barre du haut) donne une vue d'ensemble de toutes les machines : machines actives, sessions ouvertes, agents en cours, agents terminés aujourd'hui, sessions qui attendent une réponse ou une permission, agents en cours (avec leur dernier outil) et derniers agents terminés. Chaque ligne ouvre la session ou l'agent concerné. En bas, une heatmap montre l'activité des 7 derniers jours, heure par heure (nombre d'appels d'outils et de prompts, toutes machines confondues) ; le détail s'affiche au survol.

La liste est organisée par machine (nom envoyé par le hook, voir plus bas), puis par dossier de projet. Machines et dossiers se replient d'un clic (état retenu par navigateur) ; repliés, ils gardent leur nombre de sessions ouvertes et leur état le plus urgent (en attente de toi, en cours, au repos). Le dossier de projet est celui du fil principal de la session ; un agent qui travaille dans un worktree (`<dépôt>/.claude/worktrees/<nom>`) est rattaché au dépôt.

Noms affichés :

- Session : « Session N », numérotée à son arrivée par machine et par projet, sans jamais réutiliser un numéro, ou le nom donné à la main (crayon à côté du titre dans le détail). Le sujet en cours (titre que donne Claude Code, sinon dernier prompt) s'affiche en dessous et peut changer.
- Dans l'arbre d'une session : « Agent principal » (le fil principal et son dernier outil), puis ses sous-agents.
- Sous-agent : « #N », son numéro d'ordre dans la session, son type et le nom de sa tâche (la description passée à l'outil `Agent`). Un agent lancé avant l'installation des hooks n'a pas de tâche connue : « Tâche inconnue · <début de son identifiant> ».

- Par session : dossier de projet, machine, modèle, mode de permission, état (en cours, au repos, en attente de toi, fermée, sans nouvelles depuis 10 minutes ; « en attente de toi » vient d'une `Notification` de Claude Code, comme une demande de permission, sauf `idle_prompt` : envoyée 60 secondes après tout tour terminé, elle n'est notée que dans le journal), prompts, appels d'outils (entrée et sortie, tronquées à 4 000 caractères), réponse finale de chaque tour.
- Par agent : type, description, consigne complète, arborescence parent / sous-agents, dernier outil utilisé, chronologie de ses outils, rapport final, tokens et durée (agents au premier plan uniquement).

Les hooks ne transmettent pas les messages intermédiaires du modèle, seulement le dernier message de chaque tour (`Stop`, `SubagentStop`).

Le détail d'une session ou d'un agent a deux vues : « Journal » (la chronologie ci-dessus) et « Timeline ». Le bouton ✕ ou la touche Échap ferment le détail ; retirer une session du tableau passe par le menu « Nettoyage ».

La barre du haut ne garde que le titre (retour à l'accueil) et le nombre de sessions en attente de toi. La barre de statut en bas affiche :

- à gauche : l'état du flux temps réel (« En direct », ou « Hors ligne » sur fond rouge), les machines actives, les sessions ouvertes, les agents en cours et l'heure du dernier événement reçu d'un hook ;
- à droite : l'interrupteur « Fermées (N) », le menu « Nettoyage » (son libellé indique le mode : « manuel » ou « auto 1 h / 24 h / 7 j ») et le thème (clair, sombre ou automatique, qui suit le système et est le choix par défaut, retenu par navigateur).

### Sessions fermées et nettoyage

Une session est fermée quand elle a envoyé `SessionEnd`, ou quand elle est « en cours » sans événement depuis 10 minutes (plantage, terminal tué). Une session fermée est masquée par défaut (interrupteur « Fermées »). Affichée, elle a une carte en pointillés, un titre barré, l'heure de fermeture et, si le nettoyage automatique est actif, le temps avant son retrait.

Le menu « Nettoyage » de la barre de statut propose :

- « Retirer les sessions fermées » : retrait immédiat, après confirmation ;
- le nettoyage automatique (24 h par défaut, ou 1 h, 7 jours, désactivé) : le serveur vérifie chaque minute et retire toute session sans événement depuis ce délai, fermée ou non. Une session retirée revient au prochain événement qu'elle envoie.

Le nettoyage n'efface pas l'historique des durées qui sert aux estimations de la timeline.

### Timeline

Vue de type Gantt, rafraîchie chaque seconde, sur 5 minutes, 30 minutes, 2 heures ou toute l'activité (par défaut) :

- une ligne pour la session principale, avec une barre par tour de conversation (du prompt à la fin de la réponse) ;
- une ligne par agent, dans l'ordre de l'arborescence, de son lancement à sa fin ;
- une ligne par tâche de la liste de tâches de Claude (outils `TaskCreate` / `TaskUpdate` et événements `TaskCreated` / `TaskCompleted`, ou l'ancien outil `TodoWrite`) : un cercle tant qu'elle attend, une barre une fois commencée ;
- sous chaque barre, les appels d'outils (rouges en cas d'échec).

Pour un agent ou une tâche en cours, la fin estimée apparaît en pointillés, et le dépassement en orange. L'estimation est la durée médiane des agents du même type (ou des tâches) déjà terminés : sur le même projet s'il y en a au moins 3, sinon sur tous les projets, sinon aucune estimation. Elle est calculée par l'application, sans rien demander à Claude Code.

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

- Ce sont des hooks `command` qui envoient le JSON reçu sur l'entrée standard à `POST /api/hooks`, pour 13 événements (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `Notification`, `TaskCreated`, `TaskCompleted`).
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
- Claude Code lance des agents internes (par exemple les résumés périodiques de la progression d'un agent en arrière-plan) qui n'envoient qu'un `SubagentStop`, sans type : ils sont ignorés.
- Une session restée « au repos » quand son terminal est fermé sans `SessionEnd` n'est pas reconnue comme fermée : seul le nettoyage automatique la retire.
- Une machine branchée avant l'ajout des événements `TaskCreated` / `TaskCompleted` voit ses tâches via les outils `TaskCreate` / `TaskUpdate` ; relancer le script d'installation ajoute ces deux événements.
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
