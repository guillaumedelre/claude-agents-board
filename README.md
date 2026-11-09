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

## Branchement des sessions Claude Code

Ajouter ces hooks dans `~/.claude/settings.json` de chaque machine (niveau utilisateur, pour couvrir tous les dossiers). Si la clé `hooks` existe déjà, ajouter chaque entrée au tableau de l'événement correspondant, sans remplacer les entrées présentes.

```json
{
  "hooks": {
    "SessionStart":       [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "SessionEnd":         [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "UserPromptSubmit":   [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "PreToolUse":         [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "PostToolUse":        [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "SubagentStart":      [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "SubagentStop":       [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "Stop":               [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "StopFailure":        [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }],
    "Notification":       [{ "hooks": [{ "type": "command", "timeout": 5, "command": "curl -s -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: linux\" --data-binary @- http://agents.10.0.0.10.sslip.io/api/hooks" }] }]
  }
}
```

- `X-Agent-Host` : nom de la machine affiché dans le tableau, à adapter sur chaque poste. Sans cet en-tête, l'adresse IP de l'appelant est utilisée.
- Si `HOOK_TOKEN` est défini dans `.env`, ajouter `-H \"X-Hook-Token: <valeur>\"` à chaque commande.
- Les hooks sont des commandes `curl` et non des hooks `"type": "http"` : Claude Code refuse un hook HTTP vers une adresse privée (`agents.10.0.0.10.sslip.io` résout vers `10.0.0.10`) et n'autorise que le loopback.
- Les hooks sont synchrones pour que les événements arrivent dans l'ordre. Chaque appel d'outil attend la réponse de l'application (quelques millisecondes sur le réseau local). Si l'application ne répond pas, `curl` abandonne au bout de 2 secondes et Claude Code continue : un hook en échec ne bloque pas l'agent.
- Sous Windows, `curl.exe` est fourni avec Windows 10 et 11. Ce branchement n'a été testé que sous Linux.

Les sessions déjà ouvertes au moment de l'ajout des hooks n'apparaissent qu'à leur prochain événement, sans l'historique antérieur.

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

[claude-code]: https://code.claude.com/docs
[hooks]: https://code.claude.com/docs/en/hooks
[traefik]: https://traefik.io/traefik/
[vite]: https://vite.dev/
[tailwind]: https://tailwindcss.com/
[shadcn]: https://ui.shadcn.com/
[sse]: https://html.spec.whatwg.org/multipage/server-sent-events.html
