export type SessionStatus = "running" | "idle" | "error" | "ended"
export type AgentStatus = "running" | "done" | "stopped"

export type BoardEvent = {
  id: string
  at: number
  kind: "prompt" | "tool" | "message" | "notice" | "error"
  text?: string | null
  source?: string
  tool?: string
  toolUseId?: string
  summary?: string | null
  input?: string | null
  output?: string | null
  ok?: boolean
  pending?: boolean
  denied?: boolean
  durationMs?: number
  endedAt?: number
  hook?: string // événement d'origine des notices récentes (PermissionRequest, PreCompact…)
  from?: string | null
  to?: string | null
}

export type LastTool = { tool: string; summary: string | null; at: number }

export type Agent = {
  id: string
  number: number
  type: string | null
  toolUseId: string | null
  description: string | null
  prompt?: string | null
  parentId: string | null
  model: string | null
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  lastSeen: number
  lastTool: LastTool | null
  result?: string | null
  tokens: number | null
  context?: ContextUsage
  durationMs: number | null
  events?: BoardEvent[]
  eventCount?: number
}

type SessionBase = {
  id: string
  number: number
  name: string | null
  /** Page of the run in the orchestrator that started the session (Hive), if any */
  link?: string | null
  subject: string | null
  lastTool?: LastTool | null
  host: string
  cwd: string | null
  currentCwd: string | null
  title: string | null
  model: string | null
  permissionMode: string | null
  status: SessionStatus
  attention: string | null
  attentionAgent?: string | null // sous-agent à l'origine de la demande, absent des anciennes sessions
  startedAt: number
  lastSeen: number
  endedAt: number | null
  // Tokens et coût reçus par la télémétrie OpenTelemetry, absents sans elle
  usage?: SessionUsage
  context?: ContextUsage
  contextWindow?: number // taille exacte reçue de la status line
  compactions?: number
}

export type Usage = { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number; requests: number }

export type SessionUsage = Usage & { models: Record<string, Usage> }

// Tokens envoyés au modèle à la dernière requête du fil (OpenTelemetry)
export type ContextUsage = { at: number; model: string; tokens: number }

export type SessionSummary = SessionBase & {
  agents: Agent[]
  eventCount: number
  lastEvent: BoardEvent | null
}

export type Turn = { start: number; end: number | null }

export type TaskStatus = "pending" | "in_progress" | "completed"

export type Task = {
  id: string
  subject: string | null
  description: string | null
  activeForm: string | null
  status: TaskStatus
  owner: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export type Estimate = { median: number; n: number; scope: "project" | "all" }

export type SessionDetail = SessionBase & {
  events: BoardEvent[]
  agents: Record<string, Agent>
  turns: Turn[]
  tasks: Record<string, Task>
  estimates: { agents: Record<string, Estimate>; tasks: Estimate | null }
}

export type Settings = { autoCleanupMs: number }

// Limites de l'abonnement : service usage du homelab si son relevé est frais, sinon dernières rate_limits de la status line
export type Limit = { pct: number; resetsAt: number | null }
export type Limits = {
  fiveHour: Limit | null
  sevenDay: Limit | null
  // Fournies par le service usage seulement, null tant que le compte ne les a pas
  sevenDayOpus?: Limit | null
  sevenDaySonnet?: Limit | null
  at: number
  host: string
  source?: "usage" | "statusline"
}

// costByHour : coût estimé par heure (clé : début de l'heure en ms) sur les 26 dernières heures
export type Board = {
  version: number
  now: number
  settings: Settings
  limits: Limits | null
  costByHour?: Record<string, number>
  sessions: SessionSummary[]
}
