import { useState } from "react"
import { BellRing, ChevronRight, FolderGit2, Monitor, PowerOff, Unplug } from "lucide-react"
import { StatusDot, ToolIcon } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { go } from "@/hooks/use-board"
import { agentLabel, ago, basename, duration, sessionLabel, shortModel } from "@/lib/format"
import { type Display, agentDisplay, isClosed, sessionDisplay } from "@/lib/status"
import { type TreeNode, buildTree } from "@/lib/tree"
import type { SessionSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

type Selection = { sessionId: string | null; agentId: string | null }

type Project = { cwd: string | null; sessions: SessionSummary[]; open: number; status: Display }
type Machine = { host: string; projects: Project[]; open: number; status: Display }

const COLLAPSED_KEY = "agents.collapsed"

// État le plus urgent d'un groupe, pour qu'il reste visible une fois replié
function summarize(sessions: SessionSummary[], now: number) {
  return {
    open: sessions.filter((s) => !isClosed(s, now)).length,
    status:
      (["attention", "running", "idle"] as const).find((d) => sessions.some((s) => sessionDisplay(s, now) === d)) ?? ("ended" as Display),
  }
}

// Les sessions arrivent triées par activité récente : l'ordre des machines et des projets en découle
function groupByMachine(sessions: SessionSummary[], now: number): Machine[] {
  const machines = new Map<string, Map<string | null, SessionSummary[]>>()
  for (const s of sessions) {
    if (!machines.has(s.host)) machines.set(s.host, new Map())
    const projects = machines.get(s.host)!
    if (!projects.has(s.cwd)) projects.set(s.cwd, [])
    projects.get(s.cwd)!.push(s)
  }
  return [...machines].map(([host, projects]) => {
    const list = [...projects].map(([cwd, items]) => ({
      cwd,
      sessions: [...items].sort((a, b) => Number(isClosed(a, now)) - Number(isClosed(b, now))),
      ...summarize(items, now),
    }))
    return {
      host,
      projects: list,
      ...summarize(
        list.flatMap((p) => p.sessions),
        now,
      ),
    }
  })
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"))
    } catch {
      return new Set()
    }
  })
  const toggle = (key: string, open: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (open) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        /* préférence non retenue */
      }
      return next
    })
  return { isOpen: (key: string) => !collapsed.has(key), toggle }
}

const plural = (n: number) => `${n} session${n > 1 ? "s" : ""} ouverte${n > 1 ? "s" : ""}`

export function SessionList({
  sessions,
  selection,
  now,
  autoCleanupMs,
}: {
  sessions: SessionSummary[]
  selection: Selection
  now: number
  autoCleanupMs: number
}) {
  const { isOpen, toggle } = useCollapsed()
  return (
    <div className="flex flex-col gap-4 p-3">
      {groupByMachine(sessions, now).map((m) => {
        const mKey = `m:${m.host}`
        return (
          <Collapsible key={m.host} open={isOpen(mKey)} onOpenChange={(o) => toggle(mKey, o)} className="flex flex-col gap-3">
            <CollapsibleTrigger className="group flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <Monitor className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-semibold">{m.host}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot status={m.status} className="size-2" />
                {plural(m.open)}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3">
              {m.projects.map((p) => {
                const pKey = `p:${m.host}|${p.cwd}`
                return (
                  <Collapsible
                    key={p.cwd ?? "?"}
                    open={isOpen(pKey)}
                    onOpenChange={(o) => toggle(pKey, o)}
                    className="ml-2 flex flex-col gap-2 border-l pl-3"
                  >
                    <CollapsibleTrigger
                      className="group flex items-center gap-2 rounded-sm text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      title={p.cwd ?? ""}
                    >
                      <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                      <FolderGit2 className="size-3.5 shrink-0" />
                      <span className="truncate text-foreground">{basename(p.cwd)}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 font-normal group-data-[state=open]:hidden">
                        <StatusDot status={p.status} className="size-2" />
                        {plural(p.open)}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-2">
                      {p.sessions.map((s) => (
                        <SessionCard key={s.id} session={s} selection={selection} now={now} autoCleanupMs={autoCleanupMs} />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

function SessionCard({
  session: s,
  selection,
  now,
  autoCleanupMs,
}: {
  session: SessionSummary
  selection: Selection
  now: number
  autoCleanupMs: number
}) {
  const display = sessionDisplay(s, now)
  const closed = isClosed(s, now)
  const selected = selection.sessionId === s.id && !selection.agentId
  const running = s.agents.filter((a) => agentDisplay(a, now) === "running").length
  const removal = autoCleanupMs ? s.lastSeen + autoCleanupMs - now : null
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground transition-colors",
        closed && "border-dashed bg-muted/30 text-muted-foreground",
        selection.sessionId === s.id && "border-solid border-ring",
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
          <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", closed && "line-through decoration-muted-foreground/40")}>
            {sessionLabel(s)}
          </span>
          {!closed && <span className="shrink-0 text-xs text-muted-foreground">{ago(s.lastSeen, now)}</span>}
        </div>
        {s.subject && <span className="truncate pl-4.5 text-xs text-muted-foreground">sujet : {s.subject}</span>}
        {closed ? (
          <div className="flex flex-wrap items-center gap-1.5 pl-4.5 text-[11px]">
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              {display === "ended" ? <PowerOff /> : <Unplug />}
              {display === "ended" ? "Fermée" : "Sans nouvelles"} {ago(s.endedAt ?? s.lastSeen, now)}
            </Badge>
            {removal != null && <span>retirée {removal > 60e3 ? `dans ${duration(removal)}` : "sous peu"}</span>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 pl-4.5">
            {shortModel(s.model) && (
              <Badge variant="secondary" className="font-mono text-[11px]">
                {shortModel(s.model)}
              </Badge>
            )}
            {s.agents.length > 0 && (
              <Badge variant="outline" className="text-[11px]">
                {running > 0
                  ? `${running}/${s.agents.length} agent${running > 1 ? "s" : ""} actif${running > 1 ? "s" : ""}`
                  : `${s.agents.length} agent${s.agents.length > 1 ? "s" : ""}`}
              </Badge>
            )}
            {basename(s.currentCwd) !== basename(s.cwd) && (
              <span className="truncate font-mono text-[11px] text-muted-foreground">→ {basename(s.currentCwd)}</span>
            )}
          </div>
        )}
        {display === "attention" && (
          <div className="flex items-start gap-1.5 pl-4.5 text-xs text-attention">
            <BellRing className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{s.attention}</span>
          </div>
        )}
      </button>
      {!closed && (
        <div className="border-t px-1.5 py-1.5">
          <MainThread session={s} display={display} selected={selected} now={now} />
          {s.agents.length > 0 && (
            <AgentTree nodes={buildTree(s.agents)} sessionId={s.id} selectedId={selection.agentId} now={now} depth={1} />
          )}
        </div>
      )}
    </div>
  )
}

function MainThread({ session: s, display, selected, now }: { session: SessionSummary; display: Display; selected: boolean; now: number }) {
  const working = display === "running" || display === "attention"
  return (
    <button
      type="button"
      onClick={() => go(s.id)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "bg-accent",
      )}
    >
      <span className="flex items-center gap-2 text-xs">
        <StatusDot status={display} className="size-2" />
        <span className="min-w-0 flex-1 truncate font-medium">Session principale</span>
        {!working && <span className="shrink-0 text-[11px] text-muted-foreground">{ago(s.lastSeen, now)}</span>}
      </span>
      {working && s.lastTool && (
        <span className="flex items-center gap-1.5 pl-4 font-mono text-[11px] text-muted-foreground">
          <ToolIcon tool={s.lastTool.tool} className="size-3" />
          <span className="shrink-0">{s.lastTool.tool}</span>
          <span className="truncate">{s.lastTool.summary}</span>
        </span>
      )}
    </button>
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
                <span className="shrink-0 font-mono text-muted-foreground">#{a.number}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{a.type ?? "agent"}</span>
                <span className="min-w-0 flex-1 truncate">{agentLabel(a)}</span>
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
