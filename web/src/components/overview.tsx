import { BellRing, CheckCircle2, FolderGit2, Loader2, Monitor, type LucideIcon } from "lucide-react"
import { ActivityHeatmap } from "@/components/activity-heatmap"
import { StatusDot, ToolIcon } from "@/components/status"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { go } from "@/hooks/use-board"
import { agentLabel, ago, basename, duration, sessionLabel } from "@/lib/format"
import { agentDisplay, isClosed, sessionDisplay } from "@/lib/status"
import type { Agent, SessionSummary } from "@/lib/types"

const RECENT_DONE = 8

type AgentRow = { agent: Agent; session: SessionSummary }

// Page d'accueil : ce qui demande de l'attention et ce qui tourne, toutes machines confondues
export function Overview({ sessions, now }: { sessions: SessionSummary[]; now: number }) {
  const open = sessions.filter((s) => !isClosed(s, now))
  const waiting = open.filter((s) => sessionDisplay(s, now) === "attention")
  const rows = sessions.flatMap((s) => s.agents.map((agent) => ({ agent, session: s })))
  const running = rows.filter((r) => agentDisplay(r.agent, now) === "running").sort((a, b) => a.agent.startedAt - b.agent.startedAt)
  const done = rows
    .filter((r) => r.agent.status === "done" && r.agent.endedAt)
    .sort((a, b) => b.agent.endedAt! - a.agent.endedAt!)
    .slice(0, RECENT_DONE)
  const startOfDay = new Date(now).setHours(0, 0, 0, 0)
  const doneToday = rows.filter((r) => r.agent.status === "done" && (r.agent.endedAt ?? 0) >= startOfDay).length
  const machines = new Set(open.map((s) => s.host)).size

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={Monitor} label="Machines actives" value={machines} />
          <Stat icon={FolderGit2} label="Sessions ouvertes" value={open.length} />
          <Stat icon={Loader2} label="Agents en cours" value={running.length} tone={running.length ? "text-running" : undefined} />
          <Stat icon={CheckCircle2} label="Agents terminés aujourd'hui" value={doneToday} />
        </div>

        {waiting.length > 0 && (
          <Card className="border-attention/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-attention">
                <BellRing className="size-4" /> En attente de toi
              </CardTitle>
              <CardDescription>Ces sessions attendent une réponse ou une permission.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {waiting.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(s.id)}
                  className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <StatusDot status="attention" className="size-2" />
                    <span className="font-medium">{sessionLabel(s)}</span>
                    <Where session={s} />
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ago(s.lastSeen, now)}</span>
                  </span>
                  <span className="truncate pl-4 text-xs text-attention">{s.attention}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Agents en cours</CardTitle>
            <CardDescription>Sur toutes les machines, du plus ancien au plus récent.</CardDescription>
          </CardHeader>
          <CardContent>
            {running.length ? (
              <AgentRows rows={running} now={now} />
            ) : (
              <p className="py-2 text-sm text-muted-foreground">Aucun agent ne tourne en ce moment.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Terminés récemment</CardTitle>
          </CardHeader>
          <CardContent>
            {done.length ? (
              <AgentRows rows={done} now={now} />
            ) : (
              <p className="py-2 text-sm text-muted-foreground">Aucun agent terminé pour l'instant.</p>
            )}
          </CardContent>
        </Card>

        <ActivityHeatmap now={now} />
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</span>
      </CardContent>
    </Card>
  )
}

function Where({ session: s }: { session: SessionSummary }) {
  return (
    <span className="truncate text-xs text-muted-foreground">
      {s.host} · {basename(s.cwd)}
    </span>
  )
}

function AgentRows({ rows, now }: { rows: AgentRow[]; now: number }) {
  return (
    <ul className="flex flex-col">
      {rows.map(({ agent: a, session: s }) => {
        const display = agentDisplay(a, now)
        const elapsed = a.durationMs ?? (a.endedAt ?? now) - a.startedAt
        return (
          <li key={`${s.id}/${a.id}`}>
            <button
              type="button"
              onClick={() => go(s.id, a.id)}
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
            >
              <span className="flex items-center gap-2 text-sm">
                <StatusDot status={display} className="size-2" />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  #{a.number} {a.type ?? "agent"}
                </span>
                <span className="min-w-0 truncate">{agentLabel(a)}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {display === "running" ? duration(elapsed) : `${duration(elapsed)} · ${ago(a.endedAt ?? a.lastSeen, now)}`}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                <span className="shrink-0">{sessionLabel(s)}</span>
                <span>·</span>
                <Where session={s} />
                {display === "running" && a.lastTool && (
                  <span className="ml-auto hidden min-w-0 items-center gap-1 font-mono text-[11px] md:flex">
                    <ToolIcon tool={a.lastTool.tool} className="size-3" />
                    <span className="truncate">{a.lastTool.summary ?? a.lastTool.tool}</span>
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
