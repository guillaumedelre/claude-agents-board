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
  durationMs?: number
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
  durationMs: number | null
  events?: BoardEvent[]
  eventCount?: number
}

type SessionBase = {
  id: string
  number: number
  name: string | null
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
  startedAt: number
  lastSeen: number
  endedAt: number | null
}

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

export type Board = { version: number; now: number; settings: Settings; sessions: SessionSummary[] }
