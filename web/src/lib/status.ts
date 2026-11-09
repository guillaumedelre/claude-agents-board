import type { AgentStatus, SessionStatus } from "./types"

// Aucun hook depuis ce délai alors que la session travaille : plantage ou fenêtre fermée sans SessionEnd
const STALE_MS = 10 * 60 * 1000

export type Display = "running" | "attention" | "idle" | "done" | "error" | "ended" | "stale" | "stopped"

export function sessionDisplay(s: { status: SessionStatus; attention: string | null; lastSeen: number }, now: number): Display {
  if (s.attention && s.status !== "ended") return "attention"
  if (s.status === "running" && now - s.lastSeen > STALE_MS) return "stale"
  return s.status
}

export function agentDisplay(a: { status: AgentStatus; lastSeen: number }, now: number): Display {
  if (a.status === "running" && now - a.lastSeen > STALE_MS) return "stale"
  return a.status
}

export const LABELS: Record<Display, string> = {
  running: "En cours",
  attention: "En attente de toi",
  idle: "Au repos",
  done: "Terminé",
  error: "Erreur",
  ended: "Fermée",
  stale: "Sans nouvelles",
  stopped: "Interrompu",
}

// Fermée proprement (SessionEnd) ou muette alors qu'elle travaillait : même règle que le nettoyage du serveur
export const isClosed = (s: { status: SessionStatus; lastSeen: number }, now: number) =>
  s.status === "ended" || (s.status === "running" && now - s.lastSeen > STALE_MS)
