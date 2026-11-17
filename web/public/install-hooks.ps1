# Installs (or removes) the Claude Code hooks that report sessions to the Agents dashboard.
# Usage: & ([scriptblock]::Create((irm http://agents.10.0.0.10.sslip.io/install-hooks.ps1))) [-HostName NAME] [-Url URL] [-Token TOKEN] [-Uninstall]
param(
  [string]$HostName = $env:COMPUTERNAME,
  [string]$Url = 'http://agents.10.0.0.10.sslip.io',
  [string]$Token = '',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')

# Ces valeurs finissent dans une commande shell : on refuse tout caractère spécial
if (-not $Uninstall -and $HostName -notmatch '^[A-Za-z0-9._-]{1,64}$') { throw "Nom de machine invalide : '$HostName' (lettres, chiffres, . _ -)" }
if ($Token -and $Token -notmatch '^[A-Za-z0-9._-]+$') { throw 'Token invalide (lettres, chiffres, . _ -)' }
if ($Url -notmatch '^https?://[A-Za-z0-9.:-]+$') { throw "URL invalide : $Url" }

$dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$settings = Join-Path $dir 'settings.json'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$events = 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'Notification',
  'TaskCreated', 'TaskCompleted', 'PermissionRequest', 'PermissionDenied', 'PreCompact', 'PostCompact',
  'PostModelSwitch', 'InstructionsLoaded'

# Claude Code lance les hooks avec Git Bash s'il est installé, sinon avec PowerShell (plus lent à démarrer)
$gitBash = @($env:CLAUDE_CODE_GIT_BASH_PATH, "$env:ProgramFiles\Git\bin\bash.exe") |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($gitBash) {
  $tokenHeader = if ($Token) { " -H `"X-Hook-Token: $Token`"" } else { '' }
  $hook = [pscustomobject][ordered]@{
    type    = 'command'
    shell   = 'bash'
    timeout = 5
    command = "curl.exe -s -o /dev/null -m 2 -H `"Content-Type: application/json`" -H `"X-Agent-Host: $HostName`"$tokenHeader --data-binary @- $Url/api/hooks"
  }
} else {
  $tokenHeader = if ($Token) { "; 'X-Hook-Token'='$Token'" } else { '' }
  $hook = [pscustomobject][ordered]@{
    type    = 'command'
    shell   = 'powershell'
    timeout = 5
    command = "[Console]::InputEncoding=[Text.Encoding]::UTF8; `$b=[Console]::In.ReadToEnd(); try { Invoke-RestMethod -Uri '$Url/api/hooks' -Method Post -ContentType 'application/json; charset=utf-8' -Headers @{'X-Agent-Host'='$HostName'$tokenHeader} -Body ([Text.Encoding]::UTF8.GetBytes(`$b)) -TimeoutSec 2 | Out-Null } catch {}"
  }
}

$cfg = New-Object PSObject
if (Test-Path $settings) {
  $text = [IO.File]::ReadAllText($settings)
  if ($text.Trim()) { $cfg = $text | ConvertFrom-Json }
  Copy-Item $settings "$settings.bak-agents" -Force
}
if (-not $cfg.PSObject.Properties['hooks']) { $cfg | Add-Member -NotePropertyName hooks -NotePropertyValue (New-Object PSObject) }

function Test-Ours($h) { $h.command -and $h.command -like '*/api/hooks*' -and $h.command -like '*X-Agent-Host*' }

foreach ($ev in $events) {
  $groups = @()
  if ($cfg.hooks.PSObject.Properties[$ev]) {
    foreach ($g in @($cfg.hooks.$ev)) {
      $kept = @(@($g.hooks) | Where-Object { -not (Test-Ours $_) })
      if ($kept.Count) { $g.hooks = $kept; $groups += $g }
    }
    $cfg.hooks.PSObject.Properties.Remove($ev)
  }
  if (-not $Uninstall) { $groups += [pscustomobject]@{ hooks = @($hook) } }
  if ($groups.Count) { $cfg.hooks | Add-Member -NotePropertyName $ev -NotePropertyValue $groups }
}
if (-not @($cfg.hooks.PSObject.Properties).Count) { $cfg.PSObject.Properties.Remove('hooks') }

# Télémétrie OpenTelemetry : tokens et coût de chaque requête au modèle, envoyés en JSON à /v1/logs.
# $mark liste les clés ajoutées par ce script, pour ne retirer que celles-là.
$mark = 'AGENTS_BOARD_OTEL'
$otel = [ordered]@{
  CLAUDE_CODE_ENABLE_TELEMETRY     = '1'
  OTEL_LOGS_EXPORTER               = 'otlp'
  OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/json'
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "$Url/v1/logs"
}
if ($Token) { $otel['OTEL_EXPORTER_OTLP_LOGS_HEADERS'] = "X-Hook-Token=$Token" }
if (-not $cfg.PSObject.Properties['env']) { $cfg | Add-Member -NotePropertyName env -NotePropertyValue (New-Object PSObject) }
$envCfg = $cfg.env
if ($envCfg.PSObject.Properties[$mark]) {
  foreach ($k in @($envCfg.$mark -split ',' | Where-Object { $_ })) { $envCfg.PSObject.Properties.Remove($k) }
  $envCfg.PSObject.Properties.Remove($mark)
}
$otelNote = $null
if (-not $Uninstall) {
  if ($envCfg.PSObject.Properties['OTEL_LOGS_EXPORTER']) {
    $otelNote = 'Télémétrie : OTEL_LOGS_EXPORTER est déjà configuré dans settings.json, laissé tel quel (pas de tokens ni de coût sur le tableau).'
  } else {
    $added = @($otel.Keys | Where-Object { -not $envCfg.PSObject.Properties[$_] })
    foreach ($k in $added) { $envCfg | Add-Member -NotePropertyName $k -NotePropertyValue $otel[$k] }
    $envCfg | Add-Member -NotePropertyName $mark -NotePropertyValue ($added -join ',')
    $otelNote = 'Télémétrie OpenTelemetry activée : tokens et coût de chaque session.'
  }
}
if (-not @($envCfg.PSObject.Properties).Count) { $cfg.PSObject.Properties.Remove('env') }

# UTF-8 sans BOM : Claude Code lit settings.json comme du JSON strict
[IO.File]::WriteAllText($settings, (ConvertTo-Json -InputObject $cfg -Depth 32), (New-Object Text.UTF8Encoding $false))

if ($Uninstall) {
  Write-Host "Hooks retirés de $settings (copie de l'ancien fichier : $settings.bak-agents)."
  return
}

$runner = if ($gitBash) { "Git Bash + curl.exe" } else { "PowerShell (Git Bash introuvable)" }
Write-Host "Hooks installés dans $settings pour la machine « $HostName », exécutés par $runner."
if ($otelNote) { Write-Host $otelNote }

# Un corps vide est refusé (400) sans créer de session : ça prouve que l'URL et le token sont bons
$headers = @{}
if ($Token) { $headers['X-Hook-Token'] = $Token }
$code = 0
try {
  Invoke-WebRequest -Uri "$Url/api/hooks" -Method Post -ContentType 'application/json' -Body '{}' -Headers $headers -TimeoutSec 5 -UseBasicParsing | Out-Null
  $code = 200
} catch {
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
}
switch ($code) {
  400 { Write-Host "Test de connexion : OK. Relance tes sessions Claude Code ouvertes pour qu'elles apparaissent sur $Url" }
  401 { Write-Warning 'Test de connexion : token refusé. Vérifie HOOK_TOKEN dans le .env de la stack.' }
  default { Write-Warning "Test de connexion : échec (code $code). Vérifie que cette machine est sur le réseau local et résout $Url." }
}
