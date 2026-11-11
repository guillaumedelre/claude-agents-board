import { useEffect, useState } from "react"
import { useDark } from "@/components/lotmap/hooks"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Hour = { at: number; tools: number; prompts: number }
type Cell = { at: number; tools: number; prompts: number; value: number; future: boolean }

const DAYS = 7
const HOUR_MS = 3600e3
const REFRESH_MS = 60e3

// Rampe séquentielle bleue, une seule teinte : du presque rien au maximum. En thème sombre, ses propres
// paliers (le faible se fond dans le fond sombre, le fort s'éclaircit), pas l'inverse mécanique du clair.
const RAMP_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
const RAMP_DARK = ["#13325c", "#184f95", "#1c5cab", "#256abf", "#3987e5", "#6da7ec", "#b7d3f6"]

const dayLabel = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
const fullDay = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
const plural = (n: number, word: string) => `${n.toLocaleString("fr-FR")} ${word}${n > 1 ? "s" : ""}`
const span = (at: number) => `de ${new Date(at).getHours()} h à ${new Date(at + HOUR_MS).getHours()} h`

function useActivity() {
  const [hours, setHours] = useState<Hour[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch("/api/activity")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setHours(d.hours))
        .catch(() => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return hours
}

// Échelle en racine carrée : les petites heures restent visibles à côté des pics
const levelOf = (value: number, max: number, steps: number) => (value && max ? Math.min(steps - 1, Math.floor(Math.sqrt(value / max) * steps)) : -1)

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function ActivityHeatmap({ now }: { now: number }) {
  const hours = useActivity()
  const ramp = useDark() ? RAMP_DARK : RAMP_LIGHT
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)
  const byHour = new Map((hours ?? []).map((h) => [h.at, h]))
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return d
  })
  const grid: Cell[][] = days.map((d) =>
    Array.from({ length: 24 }, (_, h) => {
      const start = new Date(d)
      start.setHours(h)
      const at = start.getTime()
      const b = byHour.get(at)
      const tools = b?.tools ?? 0
      const prompts = b?.prompts ?? 0
      return { at, tools, prompts, value: tools + prompts, future: at > now }
    }),
  )
  const cells = grid.flat()
  const total = cells.reduce((n, c) => n + c.value, 0)
  const max = Math.max(0, ...cells.map((c) => c.value))
  const dayTotals = grid.map((row) => row.reduce((n, c) => n + c.value, 0))
  const hourTotals = Array.from({ length: 24 }, (_, h) => grid.reduce((n, row) => n + row[h].value, 0))
  const maxDay = Math.max(1, ...dayTotals)
  const maxHour = Math.max(1, ...hourTotals)
  const busiestHour = hourTotals.indexOf(Math.max(...hourTotals))
  const busiestDay = dayTotals.indexOf(Math.max(...dayTotals))
  const currentHour = new Date(now).getHours()

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Actions sur 7 jours" value={hours == null ? "…" : total.toLocaleString("fr-FR")} hint="appels d'outils et prompts" />
        <Stat label="Aujourd'hui" value={hours == null ? "…" : dayTotals[DAYS - 1].toLocaleString("fr-FR")} />
        <Stat label="Heure la plus active" value={total ? `${busiestHour} h` : "—"} hint={total ? plural(hourTotals[busiestHour], "action") + " sur 7 jours" : undefined} />
        <Stat label="Jour le plus actif" value={total ? dayLabel(days[busiestDay]) : "—"} hint={total ? plural(dayTotals[busiestDay], "action") : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activité heure par heure</CardTitle>
          <CardDescription>
            {hours == null ? "Chargement…" : total ? "Toutes machines confondues. Au-dessus, le profil de la journée type ; à droite, le total de chaque jour." : "Aucune activité enregistrée sur la période."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-[3.5rem_repeat(24,minmax(0,1fr))_4.5rem] gap-[2px] text-[10px] text-muted-foreground" role="table" aria-label="Nombre d'actions par jour et par heure" onMouseLeave={() => setHover(null)}>
            {/* Profil horaire : somme des 7 jours pour chaque heure */}
            <div role="presentation" />
            {hourTotals.map((v, h) => (
              <div key={h} className="flex h-8 items-end" role="presentation">
                <div
                  className="w-full rounded-t-[2px] transition-opacity"
                  style={{ height: `${Math.max(v ? 6 : 0, (v / maxHour) * 100)}%`, background: ramp[4], opacity: hover && hover.col !== h ? 0.45 : 1 }}
                  title={`${h} h : ${plural(v, "action")} sur 7 jours`}
                />
              </div>
            ))}
            <div role="presentation" />

            <div role="presentation" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className={cn("text-center tabular-nums", hover?.col === h && "font-semibold text-foreground")} role="columnheader">
                {h % 3 === 0 || hover?.col === h ? h : ""}
              </div>
            ))}
            <div className="pl-2" role="columnheader">
              total
            </div>

            {grid.map((row, i) => (
              <div key={days[i].getTime()} className="contents" role="row">
                <div className={cn("flex items-center truncate pr-1", (hover?.row === i || i === DAYS - 1) && "font-semibold text-foreground")} role="rowheader">
                  {i === DAYS - 1 ? "Auj." : dayLabel(days[i])}
                </div>
                {row.map((c, h) => {
                  if (c.future) return <div key={c.at} className="h-5 rounded-[3px] border border-dashed border-muted-foreground/20" role="cell" aria-label="à venir" />
                  const level = levelOf(c.value, max, ramp.length)
                  const crossed = hover && (hover.row === i || hover.col === h)
                  return (
                    <Tooltip key={c.at}>
                      <TooltipTrigger asChild>
                        <div
                          role="cell"
                          tabIndex={0}
                          aria-label={`${plural(c.value, "action")} le ${fullDay(new Date(c.at))} ${span(c.at)}`}
                          onMouseEnter={() => setHover({ row: i, col: h })}
                          onFocus={() => setHover({ row: i, col: h })}
                          className={cn(
                            "h-5 rounded-[3px] bg-muted/60 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
                            hover && !crossed && "opacity-55",
                            hover?.row === i && hover.col === h && "ring-2 ring-foreground/70",
                            i === DAYS - 1 && h === currentHour && "ring-1 ring-foreground/50",
                          )}
                          style={level >= 0 ? { background: ramp[level] } : undefined}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold tabular-nums">{plural(c.value, "action")}</span>
                          {c.value > 0 && (
                            <span className="opacity-80">
                              {plural(c.tools, "appel")} d'outil · {plural(c.prompts, "prompt")}
                            </span>
                          )}
                          <span className="opacity-80">
                            {dayLabel(new Date(c.at))}, {span(c.at)}
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
                {/* Total du jour en barre horizontale */}
                <div className="flex items-center gap-1 pl-2" role="cell" aria-label={`${plural(dayTotals[i], "action")} ce jour-là`}>
                  <div className="h-2 rounded-r-[2px]" style={{ width: `${(dayTotals[i] / maxDay) * 60}%`, background: ramp[4] }} />
                  <span className="tabular-nums">{dayTotals[i] || ""}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
            <span>0</span>
            <div className="h-2.5 w-40 rounded-full" style={{ background: `linear-gradient(to right, ${ramp.join(", ")})` }} aria-hidden="true" />
            <span className="tabular-nums">{max ? `${max} / h` : "—"}</span>
            <span className="ml-2">échelle en racine carrée</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
