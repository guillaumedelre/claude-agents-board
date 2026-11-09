import { useState } from "react"
import { Circle, CircleCheck, LoaderCircle } from "lucide-react"
import { StatusDot } from "@/components/status"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go, useNow } from "@/hooks/use-board"
import { clock, duration } from "@/lib/format"
import type { Display } from "@/lib/status"
import { type Lane, type Tone, buildLanes, earliest, scopeLabel, ticks } from "@/lib/timeline"
import type { SessionDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

const RANGES = { "5m": 5 * 60e3, "30m": 30 * 60e3, "2h": 2 * 3600e3, all: 0 } as const
type Range = keyof typeof RANGES
const RANGE_KEY = "agents.timelineRange"

const BAR: Record<Tone, string> = {
  running: "bg-running/80",
  done: "bg-done/70",
  idle: "bg-muted-foreground/35",
  error: "bg-destructive/70",
  muted: "bg-muted-foreground/25",
}

function readRange(): Range {
  try {
    const v = localStorage.getItem(RANGE_KEY)
    return v && v in RANGES ? (v as Range) : "all"
  } catch {
    return "all"
  }
}

export function Gantt({ session, agentId }: { session: SessionDetail; agentId: string | null }) {
  const now = useNow(1000)
  const [range, setRange] = useState<Range>(readRange)
  const { lanes, tasks } = buildLanes(session, agentId, now)
  const all = [...lanes, ...tasks]

  const span = RANGES[range] || Math.max(60e3, now - (earliest(all) ?? now - 60e3))
  // Marge à droite pour voir les estimations de fin
  const end = now + span * 0.2
  const start = end - span * 1.2
  const { ticks: marks, step } = ticks(start, end)
  const pct = (t: number) => ((t - start) / (end - start)) * 100

  const pick = (v: string) => {
    if (!v) return
    setRange(v as Range)
    try {
      localStorage.setItem(RANGE_KEY, v)
    } catch {
      /* préférence non retenue */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={pick}>
          <ToggleGroupItem value="5m">5 min</ToggleGroupItem>
          <ToggleGroupItem value="30m">30 min</ToggleGroupItem>
          <ToggleGroupItem value="2h">2 h</ToggleGroupItem>
          <ToggleGroupItem value="all">Tout</ToggleGroupItem>
        </ToggleGroup>
        <Legend />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Row label={<span className="text-[11px] text-muted-foreground">{clock(now)}</span>} header>
          {marks.map((t) => (
            <span
              key={t}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground tabular-nums"
              style={{ left: `${pct(t)}%` }}
            >
              {step < 60e3 ? clock(t) : clock(t).slice(0, 5)}
            </span>
          ))}
        </Row>
        {lanes.map((l) => (
          <LaneRow key={l.key} lane={l} sessionId={session.id} pct={pct} marks={marks} now={now} />
        ))}
        {tasks.length > 0 && (
          <>
            <div className="border-t bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground uppercase">
              Tâches ({tasks.filter((t) => t.status === "completed").length}/{tasks.length})
            </div>
            {tasks.map((l) => (
              <LaneRow key={l.key} lane={l} sessionId={session.id} pct={pct} marks={marks} now={now} />
            ))}
          </>
        )}
        {lanes.length + tasks.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Rien à afficher pour l'instant.</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Les estimations sont la durée médiane des agents du même type (ou des tâches) déjà terminés, sur ce projet s'il y en a au moins 3,
        sinon sur tous les projets. Elles disparaissent tant que l'historique est insuffisant.
      </p>
    </div>
  )
}

function Row({ label, header, children }: { label: React.ReactNode; header?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-[8.5rem_1fr] md:grid-cols-[16rem_1fr]", !header && "border-t")}>
      <div className="min-w-0 border-r px-3 py-1.5">{label}</div>
      <div className={cn("relative", header ? "h-7" : "h-10")}>{children}</div>
    </div>
  )
}

function LaneRow({
  lane: l,
  sessionId,
  pct,
  marks,
  now,
}: {
  lane: Lane
  sessionId: string
  pct: (t: number) => number
  marks: number[]
  now: number
}) {
  const clamp = (v: number) => Math.min(100, Math.max(0, v))
  const box = (a: number, b: number) => {
    const left = clamp(pct(a))
    const right = clamp(pct(b))
    return right <= 0 || left >= 100 ? null : { left: `${left}%`, width: `max(${right - left}%, 3px)` }
  }

  const label = (
    <div className="flex min-w-0 flex-col" style={{ paddingLeft: `${l.depth * 0.75}rem` }}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <LaneIcon lane={l} />
        <span className="truncate">{l.label}</span>
      </span>
      <span className="truncate pl-4 text-[10px] text-muted-foreground">{l.detail}</span>
    </div>
  )

  return (
    <Row
      label={
        l.agentId ? (
          <button type="button" onClick={() => go(sessionId, l.agentId)} className="w-full text-left hover:underline">
            {label}
          </button>
        ) : (
          label
        )
      }
    >
      {marks.map((t) => (
        <span key={t} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${pct(t)}%` }} />
      ))}
      <span className="absolute inset-y-0 z-10 w-px bg-running" style={{ left: `${pct(now)}%` }} />

      {l.eta && !l.eta.overrun && box(now, l.eta.end) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute top-2 h-4 rounded-sm border border-dashed border-running/70 bg-running/10" style={box(now, l.eta.end)!} />
          </TooltipTrigger>
          <TooltipContent>
            Fin estimée vers {clock(l.eta.end)} ({scopeLabel(l.eta.estimate)} : {duration(l.eta.estimate.median)})
          </TooltipContent>
        </Tooltip>
      )}

      {l.bars.map((b, i) => {
        const style = box(b.start, b.end)
        return (
          style && (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span className={cn("absolute top-2 h-4 rounded-sm", BAR[b.tone])} style={style} />
              </TooltipTrigger>
              <TooltipContent>
                {b.title} · {clock(b.start)} → {clock(b.end)}
              </TooltipContent>
            </Tooltip>
          )
        )
      })}

      {l.eta?.overrun && box(l.eta.end, now) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute top-2 h-4 rounded-r-sm bg-attention/80" style={box(l.eta.end, now)!} />
          </TooltipTrigger>
          <TooltipContent>
            Dépasse l'estimation de {duration(now - l.eta.end)} ({scopeLabel(l.eta.estimate)} : {duration(l.eta.estimate.median)})
          </TooltipContent>
        </Tooltip>
      )}

      {l.pendingAt && box(l.pendingAt, l.pendingAt) && (
        <span
          className="absolute top-3 size-2.5 -translate-x-1/2 rounded-full border-2 border-muted-foreground/60 bg-card"
          style={{ left: `${clamp(pct(l.pendingAt))}%` }}
          title={`Créée à ${clock(l.pendingAt)}`}
        />
      )}

      {l.marks.map((m, i) => {
        const style = box(m.start, m.end)
        return (
          style && (
            <span
              key={i}
              title={m.title}
              className={cn("absolute bottom-1 h-1 rounded-full", m.failed ? "bg-destructive" : "bg-foreground/45")}
              style={style}
            />
          )
        )
      })}
    </Row>
  )
}

function LaneIcon({ lane: l }: { lane: Lane }) {
  if (l.kind === "task") {
    if (l.status === "completed") return <CircleCheck className="size-3 shrink-0 text-done" />
    if (l.status === "in_progress") return <LoaderCircle className="size-3 shrink-0 animate-spin text-running" />
    return <Circle className="size-3 shrink-0 text-muted-foreground" />
  }
  if (l.kind === "agent") return <StatusDot status={l.status as Display} className="size-2" />
  return <span className="size-2 shrink-0 rounded-full bg-foreground/60" />
}

function Legend() {
  const item = (cls: string, text: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-4 rounded-sm", cls)} />
      {text}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {item("bg-running/80", "En cours")}
      {item("bg-done/70", "Terminé")}
      {item("border border-dashed border-running/70 bg-running/10", "Estimation")}
      {item("bg-attention/80", "Au-delà de l'estimation")}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-1 w-4 rounded-full bg-foreground/45" />
        Appels d'outils
      </span>
    </div>
  )
}
