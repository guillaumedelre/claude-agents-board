import { agentLabel, duration } from "./format"
import { agentDisplay, type Display } from "./status"
import { buildTree, type TreeNode } from "./tree"
import type { BoardEvent, Estimate, SessionDetail, Task } from "./types"

export type Tone = "running" | "done" | "idle" | "error" | "muted"

export type Bar = { start: number; end: number; tone: Tone; title: string }
export type Mark = { start: number; end: number; title: string; failed: boolean }
export type Eta = { end: number; overrun: boolean; estimate: Estimate }

export type Lane = {
  key: string
  kind: "session" | "agent" | "task"
  label: string
  detail: string
  depth: number
  status?: Display | Task["status"]
  agentId?: string
  bars: Bar[]
  marks: Mark[]
  eta?: Eta
  pendingAt?: number
}

const TONE: Partial<Record<Display, Tone>> = { running: "running", done: "done", error: "error", stale: "muted", stopped: "muted" }

const toolMarks = (events: BoardEvent[] | undefined): Mark[] =>
  (events ?? [])
    .filter((e) => e.kind === "tool")
    .map((e) => ({
      start: e.at,
      end: e.at + (e.durationMs ?? 0),
      title: `${e.tool}${e.summary ? ` · ${e.summary}` : ""}${e.durationMs != null ? ` (${duration(e.durationMs)})` : ""}`,
      failed: e.ok === false,
    }))

export const scopeLabel = (e: Estimate) =>
  `médiane de ${e.n} terminés (${e.scope === "project" ? "ce projet" : "tous les projets"})`

function etaFor(start: number, estimate: Estimate | null | undefined, now: number): Eta | undefined {
  if (!estimate) return undefined
  const end = start + estimate.median
  return { end, overrun: end < now, estimate }
}

function remaining(eta: Eta | undefined, now: number) {
  if (!eta) return ""
  return eta.overrun ? ` · +${duration(now - eta.end)} au-delà de l'estimation` : ` · ≈ ${duration(eta.end - now)} restantes`
}

function agentLanes(nodes: TreeNode[], s: SessionDetail, now: number, depth: number): Lane[] {
  return nodes.flatMap(({ agent: a, children }) => {
    const display = agentDisplay(a, now)
    const running = display === "running"
    const end = a.endedAt ?? (running ? now : a.lastSeen)
    const eta = running ? etaFor(a.startedAt, s.estimates.agents[a.type ?? "agent"], now) : undefined
    const elapsed = a.durationMs ?? end - a.startedAt
    const lane: Lane = {
      key: `agent:${a.id}`,
      kind: "agent",
      label: `#${a.number} ${agentLabel(a)}`,
      detail: `${a.type ?? "agent"} · ${duration(elapsed)}${remaining(eta, now)}`,
      depth,
      status: display,
      agentId: a.id,
      bars: [{ start: a.startedAt, end, tone: TONE[display] ?? "idle", title: `${a.type ?? "agent"} · ${duration(elapsed)}` }],
      marks: toolMarks(a.events),
      eta,
    }
    return [lane, ...agentLanes(children, s, now, depth + 1)]
  })
}

function taskLane(t: Task, s: SessionDetail, now: number): Lane {
  const start = t.startedAt ?? t.createdAt
  const end = t.completedAt ?? (t.status === "in_progress" ? now : null)
  const eta = t.status === "in_progress" && t.startedAt ? etaFor(t.startedAt, s.estimates.tasks, now) : undefined
  const label = t.status === "in_progress" && t.activeForm ? t.activeForm : (t.subject ?? `Tâche ${t.id}`)
  const state = t.status === "completed" ? "terminée" : t.status === "in_progress" ? "en cours" : "en attente"
  return {
    key: `task:${t.id}`,
    kind: "task",
    label,
    detail: `${state}${end ? ` · ${duration(end - start)}` : ""}${remaining(eta, now)}`,
    depth: 0,
    status: t.status,
    bars: end ? [{ start, end, tone: t.status === "completed" ? "done" : "running", title: label }] : [],
    marks: [],
    eta,
    pendingAt: end ? undefined : t.createdAt,
  }
}

export function buildLanes(s: SessionDetail, agentId: string | null, now: number) {
  const agents = Object.values(s.agents)
  const tree = buildTree(agents)
  const findNode = (nodes: TreeNode[]): TreeNode | undefined =>
    nodes.reduce<TreeNode | undefined>((hit, n) => hit ?? (n.agent.id === agentId ? n : findNode(n.children)), undefined)

  const lanes: Lane[] = []
  if (agentId) {
    const node = findNode(tree)
    if (node) lanes.push(...agentLanes([node], s, now, 0))
  } else {
    const open = s.turns.at(-1)?.end == null && s.status === "running"
    lanes.push({
      key: "session",
      kind: "session",
      label: "Agent principal",
      detail: `${s.turns.length} tour${s.turns.length > 1 ? "s" : ""}${open ? " · en cours" : ""}`,
      depth: 0,
      bars: s.turns.map((t, i) => {
        const end = t.end ?? (s.status === "running" ? now : s.lastSeen)
        return { start: t.start, end, tone: t.end == null ? "running" : "idle", title: `Tour ${i + 1} · ${duration(end - t.start)}` }
      }),
      marks: toolMarks(s.events),
    })
    lanes.push(...agentLanes(tree, s, now, 0))
  }

  const owned = (t: Task) => !agentId || t.owner === agentId
  const tasks = Object.values(s.tasks ?? {})
    .filter(owned)
    .sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt))
    .map((t) => taskLane(t, s, now))

  return { lanes, tasks }
}

// Premier instant affiché quand on demande « tout »
export function earliest(lanes: Lane[]) {
  const starts = lanes.flatMap((l) => [...l.bars.map((b) => b.start), ...(l.pendingAt ? [l.pendingAt] : [])])
  return starts.length ? Math.min(...starts) : null
}

const STEPS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map((s) => s * 1000)

export function ticks(start: number, end: number) {
  const step = STEPS.find((s) => (end - start) / s <= 7) ?? STEPS.at(-1)!
  const out: number[] = []
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t)
  return { step, ticks: out }
}
