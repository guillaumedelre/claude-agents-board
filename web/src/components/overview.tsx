import { BellRing } from "lucide-react"
import { useState } from "react"
import { ActivityHeatmap } from "@/components/activity-heatmap"
import { GlobalMap } from "@/components/lotmap/global"
import { OpenSpace } from "@/components/openspace"
import { StatusDot, ToolIcon } from "@/components/status"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { go } from "@/hooks/use-board"
import { agentLabel, ago, basename, duration, sessionLabel } from "@/lib/format"
import { agentDisplay, isClosed, sessionDisplay } from "@/lib/status"
import type { Agent, SessionSummary } from "@/lib/types"

const RECENT_DONE = 8
const TAB_KEY = "agents.homeTab"
type Tab = "map" | "activity" | "openspace"

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
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY)
      return v === "activity" || v === "openspace" ? v : "map"
    } catch {
      return "map"
    }
  })
  const pickTab = (v: string) => {
    const next = v === "activity" || v === "openspace" ? v : "map"
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // stockage indisponible : le choix vaut pour la page
    }
  }

  return (
    // relative : les textes sr-only (absolus) de la heatmap restent dans la page au lieu de l'allonger
    <div className="relative flex h-full flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4 md:px-6">
        {waiting.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-attention/50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-attention">
              <BellRing className="size-4" /> En attente de toi
            </span>
            {waiting.map((s) => (
              <button key={s.id} type="button" onClick={() => go(s.id)} className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/60">
                <StatusDot status="attention" className="size-2" />
                <span className="font-medium">{sessionLabel(s)}</span>
                <Where session={s} />
                <span className="min-w-0 truncate text-xs text-attention">{s.attention}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ago(s.lastSeen, now)}</span>
              </button>
            ))}
          </div>
        )}
        <Tabs value={tab} onValueChange={pickTab}>
          <TabsList>
            <TabsTrigger value="map">Carte</TabsTrigger>
            <TabsTrigger value="activity">
              Activité
              {running.length > 0 && <span className="ml-1 rounded-full bg-running px-1.5 text-[10px] text-background tabular-nums">{running.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="openspace">Open space</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "map" ? (
        <div className="min-h-0 flex-1 p-4 md:px-6">
          <GlobalMap sessions={open} className="h-full min-h-80" />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-4 py-4 md:px-6">
            {tab === "openspace" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Open space</CardTitle>
                  <CardDescription>Toutes les sessions ouvertes, regroupées par machine. Un clic sur un personnage ouvre son détail.</CardDescription>
                </CardHeader>
                <CardContent>
                  <OpenSpace sessions={open} />
                </CardContent>
              </Card>
            ) : (
              <>
                <ActivityHeatmap now={now} />
                <div className="grid gap-6 xl:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>Agents en cours</CardTitle>
                      <CardDescription>Sur toutes les machines, du plus ancien au plus récent.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {running.length ? <AgentRows rows={running} now={now} /> : <p className="py-2 text-sm text-muted-foreground">Aucun agent ne tourne en ce moment.</p>}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Terminés récemment</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {done.length ? <AgentRows rows={done} now={now} /> : <p className="py-2 text-sm text-muted-foreground">Aucun agent terminé pour l'instant.</p>}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
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
