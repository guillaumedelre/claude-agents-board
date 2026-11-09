#!/bin/sh
# Installs (or removes) the Claude Code hooks that report sessions to the Agents dashboard.
# Usage: install-hooks.sh [--host NAME] [--url URL] [--token TOKEN] [--uninstall]
set -eu

HOST_NAME=$(hostname 2>/dev/null | cut -d. -f1)
URL=http://agents.10.0.0.10.sslip.io
TOKEN=
UNINSTALL=0

usage() { echo "Usage: $0 [--host NAME] [--url URL] [--token TOKEN] [--uninstall]"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST_NAME=$2; shift 2 ;;
    --url) URL=${2%/}; shift 2 ;;
    --token) TOKEN=$2; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

# Ces valeurs finissent dans une commande shell : on refuse tout caractère spécial
echo "$HOST_NAME" | grep -Eq '^[A-Za-z0-9._-]{1,64}$' || { echo "Nom de machine invalide : '$HOST_NAME' (lettres, chiffres, . _ -)" >&2; exit 1; }
[ -z "$TOKEN" ] || echo "$TOKEN" | grep -Eq '^[A-Za-z0-9._-]+$' || { echo "Token invalide (lettres, chiffres, . _ -)" >&2; exit 1; }
echo "$URL" | grep -Eq '^https?://[A-Za-z0-9.:-]+$' || { echo "URL invalide : $URL" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl est requis." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 est requis pour modifier settings.json sans l'écraser." >&2; exit 1; }

SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak-agents"

python3 - "$SETTINGS" "$URL" "$HOST_NAME" "$TOKEN" "$UNINSTALL" <<'PY'
import json, os, sys

path, url, host, token, uninstall = sys.argv[1:6]
events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
          "PostToolUseFailure", "SubagentStart", "SubagentStop", "Stop", "StopFailure", "Notification",
          "TaskCreated", "TaskCompleted"]

cfg = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as f:
        text = f.read().strip()
    cfg = json.loads(text) if text else {}

token_header = f' -H "X-Hook-Token: {token}"' if token else ""
hook = {
    "type": "command",
    "timeout": 5,
    "command": f'curl -s -m 2 -H "Content-Type: application/json" -H "X-Agent-Host: {host}"{token_header} --data-binary @- {url}/api/hooks',
}

def ours(h):
    c = h.get("command", "")
    return "/api/hooks" in c and "X-Agent-Host" in c

hooks = cfg.setdefault("hooks", {})
for ev in events:
    groups = []
    for g in hooks.get(ev, []):
        kept = [h for h in g.get("hooks", []) if not ours(h)]
        if kept:
            groups.append({**g, "hooks": kept})
    if uninstall != "1":
        groups.append({"hooks": [hook]})
    if groups:
        hooks[ev] = groups
    else:
        hooks.pop(ev, None)
if not hooks:
    cfg.pop("hooks")

tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
PY

if [ "$UNINSTALL" = 1 ]; then
  echo "Hooks retirés de $SETTINGS (copie de l'ancien fichier : $SETTINGS.bak-agents)."
  exit 0
fi

echo "Hooks installés dans $SETTINGS pour la machine « $HOST_NAME »."
[ -f "$SETTINGS.bak-agents" ] && echo "Copie de l'ancien fichier : $SETTINGS.bak-agents"

# Un corps vide est refusé (400) sans créer de session : ça prouve que l'URL et le token sont bons
if [ -n "$TOKEN" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Content-Type: application/json' -H "X-Hook-Token: $TOKEN" --data-binary '{}' "$URL/api/hooks" || true)
else
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Content-Type: application/json' --data-binary '{}' "$URL/api/hooks" || true)
fi
case "$CODE" in
  400) echo "Test de connexion : OK. Relance tes sessions Claude Code ouvertes pour qu'elles apparaissent sur $URL" ;;
  401) echo "Test de connexion : token refusé. Vérifie HOOK_TOKEN dans le .env de la stack." >&2; exit 2 ;;
  *) echo "Test de connexion : échec (code '$CODE'). Vérifie que cette machine est sur le réseau local et résout $URL." >&2; exit 2 ;;
esac
