import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Hour = { at: number; tools: number; prompts: number }

const DAYS = 7
const HOUR_MS = 3600e3
const REFRESH_MS = 60e3

// Rampe séquentielle à une teinte : du fond neutre vers la couleur « en cours », plus foncée en clair, plus claire en sombre
const LEVELS = [35, 55, 78, 100].map((p) => `color-mix(in oklch, var(--running) ${p}%, var(--muted))`)

const dayLabel = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
const fullDay = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`

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

export function ActivityHeatmap({ now }: { now: number }) {
  const hours = useActivity()
  const byHour = new Map((hours ?? []).map((h) => [h.at, h]))
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return d
  })
  const grid = days.map((d) =>
    Array.from({ length: 24 }, (_, h) => {
      const start = new Date(d)
      start.setHours(h)
      const at = start.getTime()
      const b = byHour.get(at)
      return { at, tools: b?.tools ?? 0, prompts: b?.prompts ?? 0, future: at > now }
    }),
  )
  const cells = grid.flat()
  const total = cells.reduce((n, c) => n + c.tools + c.prompts, 0)
  const max = Math.max(0, ...cells.map((c) => c.tools + c.prompts))
  const peak = max ? cells.find((c) => c.tools + c.prompts === max)! : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activité des 7 derniers jours</CardTitle>
        <CardDescription>
          {hours == null
            ? "Chargement…"
            : total
              ? `${plural(total, "action")} (appels d'outils et prompts), toutes machines confondues. Pic : ${dayLabel(new Date(peak!.at))} à ${new Date(peak!.at).getHours()} h.`
              : "Aucune activité enregistrée sur la période."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <table className="w-full table-fixed border-separate border-spacing-[2px] text-[10px] text-muted-foreground">
          <caption className="sr-only">Nombre d'actions par jour et par heure</caption>
          <thead>
            <tr>
              <th className="w-12 sm:w-16" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="text-left font-normal">
                  <span className={cn(h % 6 !== 0 && "sr-only")}>{h} h</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={days[i].getTime()}>
                <th scope="row" className="truncate pr-1 text-left font-normal">
                  {i === DAYS - 1 ? "Auj." : dayLabel(days[i])}
                </th>
                {row.map((c) => {
                  const value = c.tools + c.prompts
                  const level = value && max ? Math.ceil((value / max) * LEVELS.length) - 1 : -1
                  const label = `${plural(value, "action")} le ${fullDay(new Date(c.at))} entre ${new Date(c.at).getHours()} h et ${new Date(c.at + HOUR_MS).getHours()} h`
                  if (c.future) {
                    return (
                      <td key={c.at} className="p-0">
                        <div className="aspect-square rounded-[3px] border border-dashed" />
                      </td>
                    )
                  }
                  return (
                    <td key={c.at} className="p-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            tabIndex={0}
                            aria-label={label}
                            className="aspect-square rounded-[3px] bg-muted outline-none hover:ring-2 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
                            style={level >= 0 ? { background: LEVELS[level] } : undefined}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold tabular-nums">{plural(value, "action")}</span>
                            {value > 0 && (
                              <span className="opacity-80">
                                {plural(c.tools, "outil")} · {plural(c.prompts, "prompt")}
                              </span>
                            )}
                            <span className="opacity-80">
                              {dayLabel(new Date(c.at))}, de {new Date(c.at).getHours()} h à {new Date(c.at + HOUR_MS).getHours()} h
                            </span>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <span className="mr-1">Moins</span>
          <span className="size-3 rounded-[3px] bg-muted" />
          {LEVELS.map((bg) => (
            <span key={bg} className="size-3 rounded-[3px]" style={{ background: bg }} />
          ))}
          <span className="ml-1">Plus</span>
        </div>
      </CardContent>
    </Card>
  )
}
