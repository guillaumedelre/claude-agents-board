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
          "TaskCreated", "TaskCompleted", "PermissionRequest", "PermissionDenied",
          "PreCompact", "PostCompact", "PostModelSwitch", "InstructionsLoaded"]

cfg = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as f:
        text = f.read().strip()
    cfg = json.loads(text) if text else {}

token_header = f' -H "X-Hook-Token: {token}"' if token else ""
hook = {
    "type": "command",
    "timeout": 5,
    "command": f'curl -s -o /dev/null -m 2 -H "Content-Type: application/json" -H "X-Agent-Host: {host}"{token_header} --data-binary @- {url}/api/hooks',
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

# Télémétrie OpenTelemetry : tokens et coût de chaque requête au modèle, envoyés en JSON à /v1/logs.
# MARK liste les clés ajoutées par ce script, pour ne retirer que celles-là.
MARK = "AGENTS_BOARD_OTEL"
otel = {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": f"{url}/v1/logs",
}
if token:
    otel["OTEL_EXPORTER_OTLP_LOGS_HEADERS"] = f"X-Hook-Token={token}"
env = cfg.setdefault("env", {})
for k in filter(None, env.pop(MARK, "").split(",")):
    env.pop(k, None)
if uninstall != "1":
    if "OTEL_LOGS_EXPORTER" in env:
        print("Télémétrie : OTEL_LOGS_EXPORTER est déjà configuré dans settings.json, laissé tel quel (pas de tokens ni de coût sur le tableau).")
    else:
        added = [k for k in otel if k not in env]
        for k in added:
            env[k] = otel[k]
        env[MARK] = ",".join(added)
        print("Télémétrie OpenTelemetry activée : tokens et coût de chaque session.")
if not env:
    cfg.pop("env")

# Status line : ses données (limites de l'abonnement, taille de la fenêtre de contexte) partent aussi vers le tableau.
# Un script enveloppe les envoie puis lance la status line d'origine, gardée à côté pour la désinstallation.
base = os.path.dirname(path)
wrapper = os.path.join(base, "agents-statusline.sh")
saved = os.path.join(base, "agents-statusline.orig.json")
status = cfg.get("statusLine")
wrapped = isinstance(status, dict) and "agents-statusline.sh" in status.get("command", "")
original = None
if wrapped:
    if os.path.exists(saved):
        with open(saved, encoding="utf-8") as f:
            original = json.load(f)
elif status:
    original = status
if uninstall == "1":
    if wrapped:
        if original:
            cfg["statusLine"] = original
        else:
            cfg.pop("statusLine", None)
    for f in (wrapper, saved):
        if os.path.exists(f):
            os.remove(f)
else:
    run = ""
    if original and original.get("type") == "command" and original.get("command"):
        quoted = original["command"].replace("'", "'\\''")
        run = f"printf '%s' \"$input\" | sh -c '{quoted}'\n"
    with open(wrapper, "w", encoding="utf-8") as f:
        f.write("#!/bin/sh\n# Généré par install-hooks.sh (tableau Agents) : envoie l'entrée de la status line au tableau, puis lance la status line d'origine.\n")
        f.write("input=$(cat)\n")
        f.write(f"printf '%s' \"$input\" | curl -s -o /dev/null -m 2 -H \"Content-Type: application/json\" -H \"X-Agent-Host: {host}\"{token_header} --data-binary @- {url}/api/statusline >/dev/null 2>&1 &\n")
        f.write(run)
    os.chmod(wrapper, 0o755)
    with open(saved, "w", encoding="utf-8") as f:
        json.dump(original, f, indent=2, ensure_ascii=False)
    cfg["statusLine"] = {**(original or {"type": "command"}), "type": "command", "command": f"sh \"{wrapper}\""}
    if not original or original.get("type") != "command":
        cfg["statusLine"].setdefault("refreshInterval", 60)
    print("Status line : limites de l'abonnement (semaine, 5 h) et fenêtre de contexte envoyées au tableau" + (", status line d'origine conservée." if run else "."))

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
