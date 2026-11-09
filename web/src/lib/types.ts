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
  firstPrompt: string | null
}

export type SessionDetail = SessionBase & {
  events: BoardEvent[]
  agents: Record<string, Agent>
}

export type Board = { version: number; now: number; sessions: SessionSummary[] }
