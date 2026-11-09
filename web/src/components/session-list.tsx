import { BellRing, FolderGit2, Monitor } from "lucide-react"
import { StatusDot, ToolIcon } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { go } from "@/hooks/use-board"
import { ago, basename, duration, sessionLabel, shortModel } from "@/lib/format"
import { agentDisplay, sessionDisplay } from "@/lib/status"
import { type TreeNode, buildTree } from "@/lib/tree"
import type { SessionSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

type Selection = { sessionId: string | null; agentId: string | null }

function groupByProject(sessions: SessionSummary[]) {
  const groups = new Map<string, { key: string; cwd: string | null; host: string; sessions: SessionSummary[] }>()
  for (const s of sessions) {
    const key = `${s.host}|${s.cwd}`
    if (!groups.has(key)) groups.set(key, { key, cwd: s.cwd, host: s.host, sessions: [] })
    groups.get(key)!.sessions.push(s)
  }
  return [...groups.values()]
}

export function SessionList({
  sessions,
  selection,
  now,
  showHost,
}: {
  sessions: SessionSummary[]
  selection: Selection
  now: number
  showHost: boolean
}) {
  return (
    <div className="flex flex-col gap-5 p-3">
      {groupByProject(sessions).map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground" title={g.cwd ?? ""}>
            <FolderGit2 className="size-3.5" />
            <span className="truncate text-foreground">{basename(g.cwd)}</span>
            {showHost && (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <Monitor className="size-3" />
                {g.host}
              </span>
            )}
          </div>
          {g.sessions.map((s) => (
            <SessionCard key={s.id} session={s} selection={selection} now={now} />
          ))}
        </section>
      ))}
    </div>
  )
}

function SessionCard({ session: s, selection, now }: { session: SessionSummary; selection: Selection; now: number }) {
  const display = sessionDisplay(s, now)
  const selected = selection.sessionId === s.id && !selection.agentId
  const running = s.agents.filter((a) => agentDisplay(a, now) === "running").length
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground transition-colors",
        selection.sessionId === s.id && "border-ring",
        display === "ended" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={() => go(s.id)}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected && "bg-accent",
        )}
      >
        <div className="flex items-center gap-2">
          <StatusDot status={display} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{sessionLabel(s)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(s.lastSeen, now)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-4.5">
          {shortModel(s.model) && (
            <Badge variant="secondary" className="font-mono text-[11px]">
              {shortModel(s.model)}
            </Badge>
          )}
          {s.agents.length > 0 && (
            <Badge variant="outline" className="text-[11px]">
              {running > 0 ? `${running}/${s.agents.length} agent${running > 1 ? "s" : ""} actif${running > 1 ? "s" : ""}` : `${s.agents.length} agent${s.agents.length > 1 ? "s" : ""}`}
            </Badge>
          )}
          {basename(s.currentCwd) !== basename(s.cwd) && (
            <span className="truncate font-mono text-[11px] text-muted-foreground">→ {basename(s.currentCwd)}</span>
          )}
        </div>
        {display === "attention" && (
          <div className="flex items-start gap-1.5 pl-4.5 text-xs text-attention">
            <BellRing className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{s.attention}</span>
          </div>
        )}
      </button>
      {s.agents.length > 0 && (
        <div className="border-t px-1.5 py-1.5">
          <AgentTree nodes={buildTree(s.agents)} sessionId={s.id} selectedId={selection.agentId} now={now} />
        </div>
      )}
    </div>
  )
}

export function AgentTree({
  nodes,
  sessionId,
  selectedId,
  now,
  depth = 0,
}: {
  nodes: TreeNode[]
  sessionId: string
  selectedId: string | null
  now: number
  depth?: number
}) {
  return (
    <ul className={cn("flex flex-col", depth > 0 && "ml-3 border-l pl-1.5")}>
      {nodes.map(({ agent: a, children }) => {
        const display = agentDisplay(a, now)
        const elapsed = a.durationMs ?? (a.endedAt ?? now) - a.startedAt
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => go(sessionId, a.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selectedId === a.id && "bg-accent",
              )}
            >
              <span className="flex items-center gap-2 text-xs">
                <StatusDot status={display} className="size-2" />
                <span className="shrink-0 font-mono text-muted-foreground">{a.type ?? "agent"}</span>
                <span className="min-w-0 flex-1 truncate">{a.description ?? "Sans description"}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{duration(elapsed)}</span>
              </span>
              {display === "running" && a.lastTool && (
                <span className="flex items-center gap-1.5 pl-4 font-mono text-[11px] text-muted-foreground">
                  <ToolIcon tool={a.lastTool.tool} className="size-3" />
                  <span className="shrink-0">{a.lastTool.tool}</span>
                  <span className="truncate">{a.lastTool.summary}</span>
                </span>
              )}
            </button>
            {children.length > 0 && (
              <AgentTree nodes={children} sessionId={sessionId} selectedId={selectedId} now={now} depth={depth + 1} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
