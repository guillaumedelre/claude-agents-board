// Carte du travail adaptée de lot-map (https://github.com/alexeyw/lot-map).
// Copyright (c) 2026 Aleksei Volodin, licence MIT : https://github.com/alexeyw/lot-map/blob/main/LICENSE
import type { BoardEvent, SessionDetail } from "@/lib/types"

export type StationId = "you" | "model" | "memory" | "files" | "shell" | "web" | "browser" | "agents" | "skills" | "hooks"
type Status = "run" | "ok" | "err" | "block"

export type Entry = {
  id: string
  station: StationId
  label: string
  // Départ de l'impulsion : le centre, la station Agents (appel d'un sous-agent) ou la station elle-même (signal entrant)
  from: "core" | "agents" | "inbound"
  startedAt: number
  endedAt?: number
  status: Status
  mark?: "switch" | "done"
  hub?: string // session d'origine, sur l'arbre de l'accueil
}

export type MapBoard = {
  entries: Entry[]
  counts: Partial<Record<StationId, number>>
  pushed: number
  faults: Partial<Record<StationId, number>>
  agents: number
  model: string | null
  switchedAt?: number
  core: string
}

const ring = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

export const STATIONS: { id: StationId; name: string; icon: string }[] = [
  { id: "you", name: "Toi", icon: `${ring(0, -3.6, 3.4)}M-6.5 8c0-4 3-6.2 6.5-6.2s6.5 2.2 6.5 6.2` },
  { id: "model", name: "Modèle", icon: "M-5 -5h10v10h-10zM-2 -8.5v3.5M2 -8.5v3.5M-2 5v3.5M2 5v3.5M-8.5 -2h3.5M-8.5 2h3.5M5 -2h3.5M5 2h3.5" },
  { id: "memory", name: "Mémoire", icon: `M-5 4.5L0 -5L6 3.5M-5 4.5L6 3.5${ring(-5, 4.5, 2.1)}${ring(0, -5, 2.1)}${ring(6, 3.5, 2.1)}` },
  { id: "files", name: "Fichiers", icon: "M-5.5 -8h7.5l3.5 3.5v12.5h-11zM2 -8v3.5h3.5" },
  { id: "shell", name: "Terminal", icon: "M-7.5 -5l5 5l-5 5M0 6h7.5" },
  { id: "web", name: "Réseau", icon: `${ring(0, 0, 7.8)}M-7.8 0h15.6M0 -7.8c-4.2 4.2 -4.2 11.4 0 15.6M0 -7.8c4.2 4.2 4.2 11.4 0 15.6` },
  { id: "browser", name: "Navigateur", icon: "M-8.5 -6.5h17v13h-17zM-8.5 -2.8h17M-6.3 -4.7h.1M-3.8 -4.7h.1" },
  { id: "agents", name: "Agents", icon: `M0 -4v3.5M0 -.5L-6 4M0 -.5L6 4${ring(0, -6, 2.1)}${ring(-6.5, 5.5, 2.1)}${ring(6.5, 5.5, 2.1)}` },
  { id: "skills", name: "Skills", icon: "M1.5 -8.5L-5.5 1h4.5l-1.5 7.5l7.5 -9.8h-4.5z" },
  { id: "hooks", name: "Hooks", icon: `M2.5 -5.5v8a4.2 4.2 0 1 1 -8.4 0v-1.5${ring(2.5, -7.3, 1.8)}` },
]
export const STATION_NAME = Object.fromEntries(STATIONS.map((s) => [s.id, s.name])) as Record<StationId, string>

// --- Classement des appels ---

const lastTwo = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-2).join("/")
const str = (v: unknown) => (typeof v === "string" ? v : "")
const isMemoryPath = (path: string) =>
  /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory[\\/]/.test(path) || /[\\/]\.claude[\\/]rules[\\/]/.test(path) || /CLAUDE\.md$/.test(path)

function hostOf(url: string) {
  try {
    return new URL(url).host.slice(0, 40)
  } catch {
    return "web"
  }
}

const FILE_WORDS = new Set(["cat", "head", "tail", "sed", "grep", "rg", "find", "ls", "wc", "cp", "mv", "mkdir", "touch", "diff", "cmp", "sort", "uniq", "cut", "tr", "awk", "tee", "stat", "file", "du", "tree", "ln", "basename", "dirname", "realpath", "jq", "rm"])
const NEUTRAL_WORDS = new Set(["echo", "printf", "cd", "export", "true", "set", "pwd", "sleep", "which", "test", "["])
const NET_WORDS = new Set(["curl", "wget", "gh", "ssh", "scp", "sftp", "ftp", "rsync", "nc", "ncat", "telnet", "ping", "dig", "nslookup"])
const NET_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["push", "pull", "fetch", "clone", "ls-remote"]),
  npm: new Set(["install", "i", "ci", "add", "update", "publish", "view", "audit"]),
  pnpm: new Set(["install", "i", "add", "update", "publish"]),
  yarn: new Set(["install", "add", "upgrade", "publish"]),
  pip: new Set(["install", "download"]),
  pip3: new Set(["install", "download"]),
  docker: new Set(["pull", "push", "login"]),
  cargo: new Set(["install", "fetch", "publish", "update"]),
}

function segments(command: string, deep = false) {
  return command
    .split(deep ? /&&|\|\||;|\||\n|\$\(|`|\(|\)/ : /&&|\|\||;|\||\n/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .map((words) => {
      let i = 0
      while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) i++
      return words.slice(i)
    })
    .filter((words) => words.length > 0)
}

const base = (word = "") => word.replace(/["']/g, "").split("/").pop() ?? word

function classifyBash(command: string, description: string): { station: StationId; label: string } {
  const lines = segments(command)
  const label = description.trim() || base(lines[0]?.[0] ?? "shell")
  for (const words of segments(command, true)) {
    const head = base(words[0])
    // docker compose pull, docker compose push…
    const sub = head === "docker" && words[1] === "compose" ? words[2] : words[1]
    if (NET_WORDS.has(head) || NET_SUBCOMMANDS[head]?.has(sub ?? "")) return { station: "web", label }
  }
  const real = lines.filter((words) => !NEUTRAL_WORDS.has(base(words[0])))
  if (real.length > 0 && real.every((words) => FILE_WORDS.has(base(words[0])))) {
    return { station: isMemoryPath(command) ? "memory" : "files", label }
  }
  return { station: "shell", label }
}

function classify(tool: string, input: Record<string, unknown>): { station: StationId; label: string } {
  switch (tool) {
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit": {
      const path = str(input.file_path) || str(input.notebook_path)
      return { station: isMemoryPath(path) ? "memory" : "files", label: lastTwo(path) || tool }
    }
    case "Grep":
    case "Glob":
      return { station: "files", label: str(input.pattern) ? `${tool} ${str(input.pattern)}` : tool }
    case "Bash":
      return classifyBash(str(input.command), str(input.description))
    case "WebFetch":
      return { station: "web", label: hostOf(str(input.url)) }
    case "WebSearch":
      return { station: "web", label: "recherche web" }
    case "Artifact":
      return { station: "web", label: "artefact" }
    case "Agent":
    case "Task":
      return { station: "agents", label: str(input.description) || "sous-agent" }
    case "Workflow":
      return { station: "agents", label: "workflow" }
    case "SendMessage":
    case "TaskStop":
      return { station: "agents", label: tool }
    case "Skill":
      return { station: "skills", label: str(input.skill) || "skill" }
    case "ToolSearch":
      return { station: "skills", label: "chargement d'outils" }
    case "AskUserQuestion":
      return { station: "you", label: "question pour toi" }
    case "SendUserFile":
      return { station: "you", label: "fichier pour toi" }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!mcp) return { station: "shell", label: tool }
  const [, server, name] = mcp
  const pretty = name.replace(/_/g, " ")
  if (server === "memory") return { station: "memory", label: pretty }
  if (/Claude_Browser|claude-in-chrome/.test(server)) {
    const url = str(input.url)
    return { station: "browser", label: /^[a-z]+:/i.test(url) ? hostOf(url) : pretty }
  }
  if (server === "terminal") return { station: "shell", label: pretty }
  return { station: "web", label: `${server.replace(/^claude_ai_/, "")} : ${pretty}` }
}

// L'entrée stockée est du JSON tronqué à 4 000 caractères : le résumé du serveur sert de repli
function inputOf(ev: BoardEvent): Record<string, unknown> {
  try {
    const v = JSON.parse(ev.input ?? "")
    if (v && typeof v === "object") return v
  } catch {
    // tronqué ou absent
  }
  const s = ev.summary ?? ""
  return { file_path: s, command: s, url: s, skill: s, description: ev.tool === "Bash" ? s : "" }
}

export const shortModel = (model: string | null | undefined) => {
  if (!model) return ""
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  return m ? `${m[1]} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : model.replace(/^claude-/, "")
}

const firstLine = (text: string, max = 72) => {
  const line = (text.split("\n").find((l) => l.trim()) ?? "").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// --- Construction du tableau à partir des fils d'événements ---

function entriesOf(events: BoardEvent[], from: "core" | "agents", open: boolean): Entry[] {
  const out: Entry[] = []
  const compacting: Entry[] = []
  for (const ev of events) {
    const base = { id: ev.id, startedAt: ev.at }
    if (ev.kind === "prompt") {
      if (from === "core") out.push({ ...base, station: "you", from: "inbound", label: firstLine(ev.text ?? "", 60) || "nouveau message", status: "ok", endedAt: ev.at })
    } else if (ev.kind === "message") {
      if (from === "core") out.push({ ...base, station: "you", from, label: "réponse prête", status: "ok", endedAt: ev.at, mark: "done" })
    } else if (ev.kind === "error") {
      out.push({ ...base, station: "model", from, label: firstLine(ev.text ?? "erreur"), status: "err", endedAt: ev.at })
    } else if (ev.kind === "tool" && ev.tool) {
      // duration_ms de Claude Code d'abord : l'heure de réception inclut la latence des hooks
      const end = ev.durationMs != null ? ev.at + ev.durationMs : (ev.endedAt ?? ev.at)
      // Sans PostToolUse une fois le fil terminé : appel refusé (hook, permission) ou interrompu
      if (ev.denied || (ev.pending && !open)) {
        out.push({ ...base, station: "hooks", from, label: `${ev.tool} ${ev.denied ? "refusé" : "arrêté"}`, status: "block", endedAt: ev.denied ? end : ev.at })
        continue
      }
      const { station, label } = classify(ev.tool, inputOf(ev))
      out.push({ ...base, station, from, label, status: ev.pending ? "run" : ev.ok === false ? "err" : "ok", endedAt: ev.pending ? undefined : end })
    } else if (ev.hook === "PermissionRequest") {
      out.push({ ...base, station: "you", from, label: `autorisation demandée : ${ev.tool ?? "?"}`, status: "ok", endedAt: ev.at })
    } else if (ev.hook === "PreCompact") {
      const e: Entry = { ...base, station: "model", from, label: (ev.text ?? "compactage").toLowerCase(), status: open ? "run" : "ok", endedAt: open ? undefined : ev.at }
      compacting.push(e)
      out.push(e)
    } else if (ev.hook === "PostCompact") {
      const e = compacting.shift()
      if (e) {
        e.status = "ok"
        e.endedAt = ev.at
      }
    } else if (ev.hook === "PostModelSwitch") {
      out.push({ ...base, station: "model", from, label: `${shortModel(ev.from)} → ${shortModel(ev.to)}`, status: "ok", endedAt: ev.at, mark: "switch" })
    } else if (ev.hook === "InstructionsLoaded") {
      out.push({ ...base, station: "memory", from: "inbound", label: lastTwo(ev.summary ?? "") || "instructions", status: "ok", endedAt: ev.at })
    }
  }
  return out
}

// Aucun hook par requête au modèle : une étape se déduit des appels d'outils. Le modèle répond entre la fin
// d'un lot d'appels (ou le début du tour) et le lot suivant (ou la fin du tour). Des appels lancés ensemble
// avant la fin des précédents forment un seul lot.
const BATCH_MS = 300

type Window = { id: string; start: number; end: number | null; open: boolean }

function stepsOf(events: BoardEvent[], win: Window, modelAt: (t: number) => string, from: "core" | "agents"): Entry[] {
  const tools = events.filter((e) => e.kind === "tool" && e.at >= win.start && (win.end == null || e.at <= win.end))
  const out: Entry[] = []
  const step = (start: number, end: number | null) => {
    const model = modelAt(start)
    out.push({
      id: `step-${win.id}-${start}`,
      station: "model",
      from,
      label: `${model ? `${model} · ` : ""}étape ${out.length + 1}`,
      startedAt: start,
      endedAt: end ?? undefined,
      status: end == null ? "run" : "ok",
    })
  }
  let batch: { start: number; end: number | null } | null = null
  for (const t of tools) {
    // Heure de réception des deux côtés, pour comparer avec le PreToolUse suivant
    const end = t.pending ? null : (t.endedAt ?? t.at + (t.durationMs ?? 0))
    if (batch && (batch.end == null || t.at < batch.end || t.at - batch.start < BATCH_MS)) {
      batch.end = batch.end == null || end == null ? null : Math.max(batch.end, end)
      continue
    }
    const think = batch ? batch.end! : win.start
    step(think, Math.max(think, t.at))
    batch = { start: t.at, end }
  }
  // Après le dernier lot : la réponse finale, ou une étape en cours si le fil est toujours ouvert
  const think = batch ? batch.end : win.start
  if (think != null) {
    if (win.end != null) step(think, Math.max(think, win.end))
    else if (win.open) step(think, null)
  }
  return out
}

// Vue d'une session (centre = agent principal) ou d'un agent (centre = cet agent, ses descendants partent d'Agents)
export function buildBoard(s: SessionDetail, agentId: string | null): MapBoard {
  const all = Object.values(s.agents)
  const agent = agentId ? s.agents[agentId] : undefined
  const childrenOf = (id: string | null) => all.filter((a) => (a.parentId ?? null) === id)
  const descendants = (id: string | null) => {
    const out = []
    const queue = childrenOf(id)
    while (queue.length) {
      const a = queue.shift()!
      out.push(a)
      queue.push(...childrenOf(a.id))
    }
    return out
  }
  // Sans parent connu, un agent est rattaché à la session principale
  const crew = agent ? descendants(agent.id) : all
  const open = agent ? agent.status === "running" : s.status === "running"

  const entries = entriesOf(agent ? (agent.events ?? []) : s.events, "core", open)
  for (const a of crew) entries.push(...entriesOf(a.events ?? [], "agents", a.status === "running"))

  // Modèle de la session à un instant donné, d'après les changements de modèle reçus
  const switches = s.events.filter((e) => e.hook === "PostModelSwitch")
  const sessionModelAt = (t: number) => shortModel(switches.findLast((e) => e.at <= t)?.to ?? switches[0]?.from ?? s.model)
  const agentSteps = (a: (typeof all)[number], from: "core" | "agents") =>
    stepsOf(a.events ?? [], { id: a.id, start: a.startedAt, end: a.endedAt, open: a.status === "running" }, () => shortModel(a.model) || a.type || "", from)

  if (agent) entries.push(...agentSteps(agent, "core"))
  else {
    for (const t of s.turns) {
      // Un tour resté ouvert dans une session qui ne tourne plus est clos à la dernière nouvelle
      const end = t.end ?? (open ? null : s.lastSeen)
      entries.push(...stepsOf(s.events, { id: `t${t.start}`, start: t.start, end, open }, sessionModelAt, "core"))
    }
  }
  for (const a of crew) entries.push(...agentSteps(a, "agents"))
  entries.sort((a, b) => a.startedAt - b.startedAt)

  const counts: MapBoard["counts"] = {}
  for (const e of entries) counts[e.station] = (counts[e.station] ?? 0) + 1
  const lastPrompt = agent ? 0 : (s.events.findLast((e) => e.kind === "prompt")?.at ?? 0)
  const faults: MapBoard["faults"] = {}
  for (const e of entries) if ((e.status === "err" || e.status === "block") && e.startedAt >= lastPrompt) faults[e.station] = (faults[e.station] ?? 0) + 1
  const switched = entries.findLast((e) => e.mark === "switch")

  return {
    entries,
    counts,
    pushed: entries.filter((e) => e.station === "memory" && e.from === "inbound").length,
    faults,
    agents: crew.filter((a) => a.status === "running").length,
    model: agent ? agent.model : s.model,
    switchedAt: switched?.startedAt,
    core: agent ? `#${agent.number}` : "CLAUDE",
  }
}

// --- Dessin ---

const W = 460
const H = 430
const CX = 230
const CY = 212
const RX = 176
const RY = 164
const NODE = 22
const CORE = 40
const HUB = CORE + 8

export type Palette = Record<"ground" | "raised" | "line" | "spoke" | "bone" | "ash" | "dim" | "accent" | "hot" | "red" | "mem" | "memHot", string>

const DARK: Palette = {
  ground: "#0a0c11",
  raised: "#12151c",
  line: "#272c36",
  spoke: "#1a1e27",
  bone: "#ebe6dc",
  ash: "#9ba1ab",
  dim: "#6b7280",
  accent: "#e1ac6e",
  hot: "#f0c595",
  red: "#e8654f",
  mem: "#62c7ba",
  memHot: "#a5e6dc",
}

const LIGHT: Palette = {
  ground: "#f5f2ea",
  raised: "#ffffff",
  line: "#cfc9bc",
  spoke: "#e3ded2",
  bone: "#1f2228",
  ash: "#5f6570",
  dim: "#8b909a",
  accent: "#b8762a",
  hot: "#8f560f",
  red: "#c5402b",
  mem: "#1c8c81",
  memHot: "#136a62",
}

export const paletteOf = (dark: boolean) => (dark ? DARK : LIGHT)

const FONT = 'font-family="ui-monospace, SF Mono, Menlo, monospace"'
const PULSE_MS = 800
const RIPPLE_MS = 450
const GLOW_MS = 3200
const ALARM_MS = 6000
const SWITCH_MS = 8000
const DONE_MS = 1100
const TRAIL_STOPS = 7

type Point = { x: number; y: number }

const turn = (i: number) => (i * 2 * Math.PI) / STATIONS.length
const at = (a: number, f = 1): Point => ({ x: CX + RX * f * Math.sin(a), y: CY - RY * f * Math.cos(a) })
const place = (i: number) => at(turn(i))
const indexOf = (id: StationId) => STATIONS.findIndex((s) => s.id === id)
const n1 = (v: number) => (Math.round(v * 10) / 10).toString()
// Instant sur l'horloge du SVG, remise à zéro à chaque dessin : une valeur négative reprend une animation en cours
const clock = (ms: number) => `${(ms / 1000).toFixed(3)}s`

function edge(from: Point, to: Point, r: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: from.x + ((to.x - from.x) * r) / d, y: from.y + ((to.y - from.y) * r) / d }
}

function aside(a: Point, b: Point, off: number): [Point, Point] {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const dx = (-(b.y - a.y) * off) / d
  const dy = ((b.x - a.x) * off) / d
  return [
    { x: a.x + dx, y: a.y + dy },
    { x: b.x + dx, y: b.y + dy },
  ]
}

// isSingle : un seul point au lieu de la comète de trois
function pulse(a: Point, b: Point, color: string, age: number, radius: number, isHollow = false, isSingle = false) {
  const path = `M${n1(a.x)} ${n1(a.y)}L${n1(b.x)} ${n1(b.y)}`
  let out = ""
  for (let k = isHollow || isSingle ? 0 : 2; k >= 0; k--) {
    const timing = `begin="${clock(k * 45 - age)}" dur="${clock(PULSE_MS)}" fill="freeze"`
    const peak = n1(1 - 0.36 * k)
    const paint = isHollow ? `fill="none" stroke="${color}" stroke-width="1.4"` : `fill="${color}"`
    out +=
      `<circle r="${n1(radius * (1 - 0.27 * k))}" ${paint} opacity="0">` +
      `<animateMotion path="${path}" ${timing}/>` +
      `<animate attributeName="opacity" values="${peak};${peak};0" keyTimes="0;.82;1" ${timing}/>` +
      `</circle>`
  }
  return out
}

function ripple(p: Point, r: number, color: string, age: number) {
  const timing = `begin="${clock(PULSE_MS - age)}" dur="${clock(RIPPLE_MS)}" fill="freeze"`
  return (
    `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0">` +
    `<animate attributeName="r" values="${r};${r + 11}" ${timing}/>` +
    `<animate attributeName="opacity" values=".7;0" ${timing}/></circle>`
  )
}

function beam(a: Point, b: Point, color: string, age: number, isDashed: boolean) {
  return (
    `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${color}" stroke-width="1.4"${isDashed ? ' stroke-dasharray="3 4"' : ""} opacity="0">` +
    `<animate attributeName="opacity" values=".75;0" begin="${clock(-age)}" dur="${clock(GLOW_MS / 2)}" fill="freeze"/></line>`
  )
}

const BEND = [0.5, 0.5, 0.4, 0.45, 0.55, 0.75]

function leg(i: number, j: number) {
  const n = STATIONS.length
  let steps = (((j - i) % n) + n) % n
  if (steps > n / 2) steps -= n
  const bend = at(turn(i + steps / 2), BEND[Math.abs(steps)] ?? 0.5)
  const a = edge(place(i), bend, NODE + 4)
  const b = edge(place(j), bend, NODE + 4)
  return { path: `M${n1(a.x)} ${n1(a.y)}Q${n1(bend.x)} ${n1(bend.y)} ${n1(b.x)} ${n1(b.y)}`, end: b }
}

// Stations traversées par le fil du centre, sans le modèle (sinon chaque trajet passerait par lui)
function routeOf(entries: Entry[]) {
  const stops: { station: StationId; at: number }[] = []
  for (const e of entries) {
    if (e.from === "agents" || e.station === "model") continue
    const last = stops.at(-1)
    if (last && last.station === e.station) last.at = e.startedAt
    else stops.push({ station: e.station, at: e.startedAt })
  }
  return stops.slice(-TRAIL_STOPS)
}

function trail(entries: Entry[], now: number, c: Palette) {
  const stops = routeOf(entries)
  let out = ""
  for (let k = 1; k < stops.length; k++) {
    const from = stops[k - 1]
    const to = stops[k]
    const { path, end } = leg(indexOf(from.station), indexOf(to.station))
    const isHead = k === stops.length - 1
    const opacity = n1(0.12 + (0.5 * k) / (stops.length - 1))
    const drawing = isHead
      ? ` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(to.at - now)}" dur=".5s" fill="freeze"/></path>`
      : "/>"
    out += `<path d="${path}" fill="none" stroke="${c.bone}" stroke-width="${isHead ? 1.5 : 1.1}" stroke-linecap="round" opacity="${opacity}"${drawing}`
    if (isHead) {
      out +=
        `<circle cx="${n1(end.x)}" cy="${n1(end.y)}" r="2.4" fill="${c.bone}" opacity="0">` +
        `<animate attributeName="opacity" values="0;.85" begin="${clock(to.at - now + 400)}" dur=".15s" fill="freeze"/></circle>`
    }
  }
  return out
}

function station(s: (typeof STATIONS)[number], p: Point, entries: Entry[], board: MapBoard, now: number, c: Palette, selected: boolean) {
  const x = n1(p.x)
  const y = n1(p.y)
  const count = board.counts[s.id] ?? 0
  const own = entries.filter((e) => e.station === s.id)
  const running = own.filter((e) => e.status === "run")
  const latest = own.at(-1)
  const since = latest ? now - (latest.endedAt ?? latest.startedAt) : Infinity
  const alarm = own.filter((e) => e.status === "block" || e.status === "err").pop()
  const alarmAge = alarm ? now - (alarm.endedAt ?? alarm.startedAt) : Infinity
  const isAlarm = alarmAge < ALARM_MS
  const isLit = running.length > 0 || since < GLOW_MS
  const [main, hot] = s.id === "memory" ? [c.mem, c.memHot] : [c.accent, c.hot]
  const color = isAlarm ? c.red : main
  const fade = isAlarm ? alarmAge : since
  const span = isAlarm ? ALARM_MS : GLOW_MS

  let under = ""
  if (isLit || isAlarm) {
    under +=
      running.length > 0 && !isAlarm
        ? `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity=".16"/>`
        : `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity="0">` +
          `<animate attributeName="opacity" values=".3;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
  }
  if (running.length > 0) {
    const elapsed = Math.max(0, now - Math.min(...running.map((e) => e.startedAt)))
    const beat = `begin="${clock(-(elapsed % 1400))}" dur="1.4s" repeatCount="indefinite"`
    under +=
      `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.3">` +
      `<animate attributeName="r" values="${NODE};${NODE + 15}" ${beat}/>` +
      `<animate attributeName="opacity" values=".9;0" ${beat}/></circle>`
    // Aiguilles : l'intérieure fait le tour en une minute, l'extérieure en dix
    const hand = (r: number, width: number, lapMs: number, isOnce: boolean) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${hot}" stroke-width="${width}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-90 ${x} ${y})">` +
      `<animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(-(isOnce ? Math.min(elapsed, lapMs) : elapsed % lapMs))}" dur="${clock(lapMs)}" ${isOnce ? 'fill="freeze"' : 'repeatCount="indefinite"'}/></circle>`
    under += hand(NODE + 4, 2.2, 60_000, false) + hand(NODE + 8, 1.2, 600_000, true)
  }

  const lit = `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.2"`
  const cooling =
    running.length > 0
      ? `${lit}/>`
      : isLit || isAlarm
        ? `${lit} opacity="0"><animate attributeName="opacity" values="1;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
        : ""
  const glyphColor = isAlarm ? c.red : isLit ? hot : s.id === "memory" && count > 0 ? main : c.ash
  const rim = `paint-order="stroke" stroke="${c.ground}" stroke-width="3.5" stroke-linejoin="round"`
  let over =
    `<circle cx="${x}" cy="${y}" r="${NODE}" fill="${c.raised}" stroke="${c.line}" stroke-width="1.2"/>${cooling}` +
    `<path transform="translate(${x} ${y})" d="${s.icon}" fill="none" stroke="${glyphColor}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="${x}" y="${n1(p.y + NODE + 15)}" text-anchor="middle" ${FONT} font-size="11.5" ${rim} fill="${isLit || isAlarm ? c.bone : c.ash}">${s.name}</text>`

  if (count > 0) {
    // Mémoire : ce qui a été demandé, et ce qui est arrivé sans demande (↓)
    const pushed = s.id === "memory" ? Math.min(count, board.pushed) : 0
    const asked = count - pushed
    const figures = pushed === 0 ? String(count) : `${asked > 0 ? `${asked} ` : ""}<tspan fill="${main}">↓${pushed}</tspan>`
    over += `<text x="${x}" y="${n1(p.y + NODE + 28)}" text-anchor="middle" ${FONT} font-size="9.5" ${rim} fill="${c.dim}">${figures}</text>`
  }

  const corner = NODE * 0.74
  if (running.length > 1) {
    over +=
      `<circle cx="${n1(p.x + corner)}" cy="${n1(p.y - corner)}" r="8" fill="${c.raised}" stroke="${color}" stroke-width="1"/>` +
      `<text x="${n1(p.x + corner)}" y="${n1(p.y - corner + 3)}" text-anchor="middle" ${FONT} font-size="8.5" fill="${hot}">×${running.length}</text>`
  }
  const faults = board.faults[s.id] ?? 0
  if (faults > 0) {
    over +=
      `<circle cx="${n1(p.x - corner)}" cy="${n1(p.y - corner)}" r="7.5" fill="${c.red}"/>` +
      `<text x="${n1(p.x - corner)}" y="${n1(p.y - corner + 3.1)}" text-anchor="middle" ${FONT} font-size="9" font-weight="700" fill="${c.ground}">${faults > 99 ? "99+" : faults}</text>`
  }
  // Zone de survol et de clic : l'interface retrouve la station par data-station
  const hit = `<circle cx="${x}" cy="${y}" r="${NODE + 8}" fill="${c.ground}" fill-opacity="0"/>`
  const ring = selected ? `<circle cx="${x}" cy="${y}" r="${NODE + 5}" fill="none" stroke="${c.bone}" stroke-width="1.2" stroke-dasharray="3 3"/>` : ""
  return { under, over: `<g data-station="${s.id}" style="cursor:pointer">${hit}${ring}${over}</g>` }
}

export function drawMap(board: MapBoard, now: number, c: Palette, motion: boolean, selected: StationId | null = null): string {
  const core: Point = { x: CX, y: CY }
  const recent = board.entries.slice(-40)
  const live = motion ? recent : []
  const flights = live.filter((e) => now - e.startedAt < PULSE_MS + RIPPLE_MS).slice(-14)
  const returns = live.filter((e) => e.endedAt !== undefined && e.from !== "inbound" && e.mark === undefined && now - e.endedAt < PULSE_MS + RIPPLE_MS).slice(-14)
  const beams = live.filter((e) => now - e.startedAt < GLOW_MS / 2).slice(-10)
  const anyRunning = recent.some((e) => e.status === "run")
  const agentsAt = place(indexOf("agents"))
  const isBad = (e: Entry) => e.status === "block" || e.status === "err"
  const tone = (e: Entry) => (e.station === "memory" ? [c.mem, c.memHot] : [c.accent, c.hot])

  let body = `<rect width="${W}" height="${H}" rx="12" fill="${c.ground}"/>`
  for (const [rx, ry] of [
    [66, 62],
    [104, 97],
    [142, 132],
  ]) {
    body += `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="none" stroke="${c.line}" stroke-width=".7" opacity=".45" stroke-dasharray="2 5"/>`
  }

  STATIONS.forEach((_, i) => {
    const p = place(i)
    const a = edge(core, p, HUB)
    const b = edge(p, core, NODE)
    body += `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke-width="1.4" stroke-linecap="round" stroke="${c.spoke}"/>`
  })

  const drawn = STATIONS.map((s, i) => station(s, place(i), recent, board, now, c, s.id === selected))
  body += drawn.map((d) => d.under).join("")
  body += trail(recent, now, c)

  const ends = (e: Entry): [Point, Point] => {
    const p = place(indexOf(e.station))
    const start = e.from === "agents" ? agentsAt : core
    return [edge(start, p, e.from === "agents" ? NODE : HUB), edge(p, start, NODE)]
  }
  const lane = (list: Entry[], e: Entry) => {
    const peers = list.filter((x) => x.station === e.station && x.from === e.from)
    return (peers.indexOf(e) - (peers.length - 1) / 2) * 5
  }

  for (const e of beams) {
    if (e.from === "agents" && e.station === "agents") continue
    const [a, b] = ends(e)
    body += beam(a, b, isBad(e) ? c.red : tone(e)[0], now - e.startedAt, e.from === "inbound")
  }
  for (const e of flights) {
    if (e.from === "agents" && e.station === "agents") continue
    const [a, b] = aside(...ends(e), lane(flights, e))
    const age = now - e.startedAt
    const color = e.status === "block" ? c.red : tone(e)[1]
    if (e.from === "inbound") body += pulse(b, a, color, age, 3.8, true) + ripple(core, HUB - 2, color, age)
    else body += pulse(a, b, color, age, 3.8) + ripple(place(indexOf(e.station)), NODE, color, age)
  }
  for (const e of returns) {
    if (e.from === "agents" && e.station === "agents") continue
    const [a, b] = aside(...ends(e), lane(returns, e))
    body += pulse(b, a, e.status === "ok" ? c.ash : c.red, now - e.endedAt!, 2.6)
  }

  body += drawn.map((d) => d.over).join("")

  // Chaque sous-agent en cours tourne autour de la station Agents
  const crew = Math.min(6, board.agents)
  for (let k = 0; k < crew; k++) {
    const lap = 7000
    const spin = `${n1(agentsAt.x)} ${n1(agentsAt.y)}`
    const rotate = motion
      ? `<animateTransform attributeName="transform" type="rotate" from="0 ${spin}" to="360 ${spin}" begin="${clock(-((now + (k * lap) / crew) % lap))}" dur="${clock(lap)}" repeatCount="indefinite"/>`
      : ""
    body +=
      `<g transform="rotate(${n1((360 * k) / crew)} ${spin})">${rotate}` +
      `<circle cx="${n1(agentsAt.x)}" cy="${n1(agentsAt.y - NODE - 6)}" r="3" fill="${c.hot}"/></g>`
  }

  const coreSize = Math.min(17, 62 / (0.75 * board.core.length))
  const period = anyRunning ? 1600 : 4800
  const breath = `begin="${clock(-(now % period))}" dur="${clock(period)}" repeatCount="indefinite"`
  body +=
    `<circle cx="${CX}" cy="${CY}" r="${CORE + 6}" fill="${c.accent}" opacity=".08">` +
    (motion
      ? `<animate attributeName="r" values="${CORE + 3};${CORE + 13};${CORE + 3}" ${breath}/>` +
        `<animate attributeName="opacity" values=".05;${anyRunning ? ".24" : ".12"};.05" ${breath}/>`
      : "") +
    `</circle>` +
    `<circle data-core="1" style="cursor:pointer" cx="${CX}" cy="${CY}" r="${CORE}" fill="${c.raised}" stroke="${anyRunning ? c.accent : c.line}" stroke-width="1.3"/>`

  const switchAge = board.switchedAt === undefined ? Infinity : now - board.switchedAt
  const isSwitching = switchAge >= 0 && switchAge < SWITCH_MS
  const model = shortModel(board.model)
  body += `<text x="${CX}" y="${CY + (model ? 1 : 6)}" text-anchor="middle" ${FONT} font-size="${n1(coreSize)}" letter-spacing="${n1(coreSize * 0.147)}" fill="${c.bone}" pointer-events="none">${escapeXml(board.core)}</text>`
  if (model) body += `<text x="${CX}" y="${CY + 17}" text-anchor="middle" ${FONT} font-size="9" fill="${isSwitching ? c.hot : c.ash}" pointer-events="none">${escapeXml(model)}</text>`

  if (isSwitching && motion) {
    const station = place(indexOf("model"))
    const laps = Math.ceil((SWITCH_MS - switchAge) / 1600)
    for (const [p, r] of [
      [core, CORE],
      [station, NODE],
    ] as const) {
      const ringing = `begin="${clock(-(switchAge % 1600))}" dur="1.6s" repeatCount="${laps}" fill="freeze"`
      body +=
        `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${c.bone}" stroke-width="1.4" opacity="0">` +
        `<animate attributeName="r" values="${r};${r + 26}" ${ringing}/>` +
        `<animate attributeName="opacity" values=".7;0" ${ringing}/></circle>`
    }
  }

  // La réponse quitte le centre en un large anneau
  const done = live.filter((e) => e.mark === "done").pop()
  if (done && now - done.startedAt < DONE_MS) {
    const leaving = `begin="${clock(done.startedAt - now)}" dur="${clock(DONE_MS)}" fill="freeze"`
    body +=
      `<circle cx="${CX}" cy="${CY}" r="${CORE}" fill="none" stroke="${c.bone}" stroke-width="1.6" opacity="0">` +
      `<animate attributeName="r" values="${CORE};${CORE + 38}" ${leaving}/>` +
      `<animate attributeName="opacity" values=".6;0" ${leaving}/></circle>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${body}</svg>`
}

// --- Arbre de l'accueil : Toi en haut, les sessions au milieu, les stations partagées en bas ---

export type TreeSession = { id: string; number: number; label: string; project: string; host: string; status: "running" | "attention" | "idle"; agents: number }

const TREE_H = 440
const TREE_YOU = 52
const TREE_SESSION = 200
const TREE_STATION = 352
const BOX_H = 44

export function drawTree(board: MapBoard, sessions: TreeSession[], now: number, c: Palette, motion: boolean, selected: StationId | null = null): string {
  const tools = STATIONS.filter((s) => s.id !== "you")
  const w = Math.max(720, sessions.length * 110)
  const you: Point = { x: w / 2, y: TREE_YOU }
  const stationAt = new Map(tools.map((s, k) => [s.id, { x: (w * (k + 0.5)) / tools.length, y: TREE_STATION }]))
  stationAt.set("you", you)
  const sessionAt = new Map(sessions.map((s, k) => [s.id, { x: (w * (k + 0.5)) / sessions.length, y: TREE_SESSION }]))
  const boxW = Math.min(170, w / Math.max(1, sessions.length) - 28)
  // Les liens partent du haut du rectangle (vers Toi) et du bas (vers les stations)
  const top = (p: Point): Point => ({ x: p.x, y: p.y - BOX_H / 2 })
  const bottom = (p: Point): Point => ({ x: p.x, y: p.y + BOX_H / 2 })
  const recent = board.entries.filter((e) => e.hub && sessionAt.has(e.hub)).slice(-60)
  const live = motion ? recent : []
  const tone = (e: Entry) => (e.station === "memory" ? [c.mem, c.memHot] : [c.accent, c.hot])
  const attention = (h: TreeSession) => h.status === "attention"

  let body = `<rect width="${w}" height="${TREE_H}" rx="12" fill="${c.ground}"/>`

  // Machines : nom au-dessus de leurs sessions, accolade discrète
  const hosts = [...new Set(sessions.map((s) => s.host))]
  for (const host of hosts) {
    const xs = sessions.filter((s) => s.host === host).map((s) => sessionAt.get(s.id)!.x)
    const [x1, x2] = [Math.min(...xs) - boxW / 2, Math.max(...xs) + boxW / 2]
    const y = TREE_SESSION - BOX_H / 2 - 22
    body +=
      `<path d="M${n1(x1)} ${y + 6}v-6h${n1(x2 - x1)}v6" fill="none" stroke="${c.line}" stroke-width=".8"/>` +
      `<text x="${n1((x1 + x2) / 2)}" y="${y - 5}" text-anchor="middle" ${FONT} font-size="10" fill="${c.dim}">${escapeXml(host)}</text>`
  }

  // Toi relié à chaque session, en ambre quand elle t'attend
  for (const h of sessions) {
    const p = sessionAt.get(h.id)!
    const b = top(p)
    const a = edge(you, b, NODE)
    const line = `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}"`
    body += attention(h)
      ? `${line} style="stroke:var(--attention)" stroke-width="1.6" stroke-dasharray="4 4">${motion ? `<animate attributeName="stroke-dashoffset" values="8;0" dur="0.8s" repeatCount="indefinite"/>` : ""}</line>`
      : `${line} stroke="${c.line}" stroke-width="1"/>`
  }

  // Chaque session reliée à chaque station
  for (const h of sessions) {
    const a = bottom(sessionAt.get(h.id)!)
    for (const t of tools) {
      const b = edge(stationAt.get(t.id)!, a, NODE)
      body += `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke-width="1" stroke-linecap="round" stroke="${c.spoke}"/>`
    }
  }

  const drawn = STATIONS.map((s) => station(s, stationAt.get(s.id)!, recent, board, now, c, s.id === selected))
  body += drawn.map((d) => d.under).join("")

  const ends = (e: Entry): [Point, Point] => {
    const p = sessionAt.get(e.hub!)!
    const a = e.station === "you" ? top(p) : bottom(p)
    return [a, edge(stationAt.get(e.station)!, a, NODE)]
  }
  const lane = (list: Entry[], e: Entry) => {
    const peers = list.filter((x) => x.station === e.station && x.hub === e.hub)
    return (peers.indexOf(e) - (peers.length - 1) / 2) * 5
  }
  const flights = live.filter((e) => now - e.startedAt < PULSE_MS + RIPPLE_MS).slice(-20)
  const returns = live.filter((e) => e.endedAt !== undefined && e.from !== "inbound" && e.mark === undefined && e.station !== "you" && now - e.endedAt < PULSE_MS + RIPPLE_MS).slice(-20)
  for (const e of flights) {
    const [a, b] = aside(...ends(e), lane(flights, e))
    const age = now - e.startedAt
    const color = e.status === "block" ? c.red : tone(e)[1]
    if (e.from === "inbound") body += pulse(b, a, color, age, 3.8, true) + ripple(e.station === "you" ? top(sessionAt.get(e.hub!)!) : bottom(sessionAt.get(e.hub!)!), 4, color, age)
    else body += pulse(a, b, color, age, 3.8, false, true) + ripple(stationAt.get(e.station)!, NODE, color, age)
  }
  for (const e of returns) {
    const [a, b] = aside(...ends(e), lane(returns, e))
    body += pulse(b, a, e.status === "ok" ? c.ash : c.red, now - e.endedAt!, 2.6, false, true)
  }

  body += drawn.map((d) => d.over).join("")

  for (const h of sessions) body += sessionNode(h, sessionAt.get(h.id)!, boxW, now, c, motion)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${TREE_H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="true">${body}</svg>`
}

// Rectangle d'une session : titre et projet à l'intérieur, contour selon son état, sous-agents en cours dans un badge
function sessionNode(h: TreeSession, p: Point, boxW: number, now: number, c: Palette, motion: boolean) {
  const stroke = h.status === "running" ? `stroke="${c.accent}"` : h.status === "attention" ? 'style="stroke:var(--attention)"' : `stroke="${c.line}"`
  const fit = (t: string, size: number) => {
    const max = Math.max(4, Math.floor((boxW - 16) / (size * 0.62)))
    return t.length > max ? `${t.slice(0, max - 1)}…` : t
  }
  const x = n1(p.x - boxW / 2)
  const y = n1(p.y - BOX_H / 2)
  const box = `x="${x}" y="${y}" width="${n1(boxW)}" height="${BOX_H}" rx="10"`
  let out = `<rect x="${n1(p.x - boxW / 2 - 6)}" y="${n1(p.y - BOX_H / 2 - 6)}" width="${n1(boxW + 12)}" height="${BOX_H + 12}" rx="14" fill="${c.ground}" fill-opacity="0"/>`
  if (h.status !== "idle" && motion) {
    const breath = `begin="${clock(-(now % 1600))}" dur="1.6s" repeatCount="indefinite"`
    out +=
      `<rect ${box} fill="none" ${stroke} stroke-width="1" opacity="0">` +
      `<animate attributeName="stroke-width" values="1;9;1" ${breath}/>` +
      `<animate attributeName="opacity" values=".45;0;.45" ${breath}/></rect>`
  }
  out +=
    `<rect ${box} fill="${c.raised}" ${stroke} stroke-width="1.6"/>` +
    `<text x="${n1(p.x)}" y="${n1(p.y - 3)}" text-anchor="middle" ${FONT} font-size="11" font-weight="600" fill="${c.bone}" pointer-events="none">${escapeXml(fit(h.label, 11))}</text>` +
    `<text x="${n1(p.x)}" y="${n1(p.y + 12)}" text-anchor="middle" ${FONT} font-size="9.5" fill="${c.ash}" pointer-events="none">${escapeXml(fit(h.project, 9.5))}</text>`
  if (h.agents > 0) {
    const bx = p.x + boxW / 2 - 2
    const by = p.y - BOX_H / 2 + 2
    out +=
      `<circle cx="${n1(bx)}" cy="${n1(by)}" r="8" fill="${c.raised}" stroke="${c.hot}" stroke-width="1"/>` +
      `<text x="${n1(bx)}" y="${n1(by + 3)}" text-anchor="middle" ${FONT} font-size="8.5" fill="${c.hot}" pointer-events="none">+${h.agents}</text>`
  }
  return `<g data-hub="${escapeXml(h.id)}" style="cursor:pointer">${out}</g>`
}

function escapeXml(text: string) {
  return text.replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]!)
}

// --- Fil sous la carte ---

export type Row = { entry: Entry; times: number; tookMs: number }

const isPlain = (e: Entry) => e.status === "ok" && e.mark === undefined

// Les plus récentes d'abord ; des appels terminés qui se suivent sur une station se replient en une ligne
export function foldRows(entries: Entry[], max = 16): Row[] {
  const rows: Row[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    const took = e.endedAt === undefined ? 0 : Math.max(0, e.endedAt - e.startedAt)
    const last = rows.at(-1)
    if (last && isPlain(e) && isPlain(last.entry) && last.entry.station === e.station && last.entry.from === e.from) {
      last.times++
      last.tookMs += took
      continue
    }
    if (rows.length === max) break
    rows.push({ entry: e, times: 1, tookMs: took })
  }
  return rows
}

export function describeNow(board: MapBoard) {
  const running = board.entries.filter((e) => e.status === "run")
  const top = running.at(-1)
  if (!top) return "Rien en cours."
  return `${STATION_NAME[top.station]} : ${top.label}${running.length > 1 ? ` et ${running.length - 1} de plus` : ""}`
}

// --- Détail d'une station ---

// Ce qu'une station a le plus servi, pour l'infobulle
export function topLabels(entries: Entry[], station: StationId, max = 5) {
  const counts = new Map<string, number>()
  for (const e of entries) if (e.station === station && e.mark === undefined) counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
}
