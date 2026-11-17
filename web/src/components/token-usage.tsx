import { useDark } from "@/components/lotmap/hooks"
import { Stat, useActivity } from "@/components/activity-heatmap"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { COST_NOTE } from "@/components/usage"
import { shortModel, tokens, totalTokens, usd } from "@/lib/format"
import type { Usage } from "@/lib/types"

const DAYS = 7
// Palette catégorielle de référence (4 premiers rangs), validée en clair et en sombre ; au-delà, « autres »
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500"]
const OTHERS = "autres"

const empty = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0, requests: 0 })
const add = (into: Usage, u: Usage) => {
  into.input += u.input
  into.output += u.output
  into.cacheRead += u.cacheRead
  into.cacheCreation += u.cacheCreation
  into.cost += u.cost
  into.requests += u.requests
}
const dayLabel = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
const cacheShare = (u: Usage) => (totalTokens(u) ? `${Math.round((100 * u.cacheRead) / totalTokens(u))} %` : "–")

// Tokens et coût estimé par jour et par modèle, d'après la télémétrie OpenTelemetry
export function TokenUsage({ now }: { now: number }) {
  const hours = useActivity()
  const colors = useDark() ? SERIES_DARK : SERIES_LIGHT
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const starts = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (DAYS - 1 - i))
    return d
  })
  const since = starts[0].getTime()

  // La couleur suit le modèle (ordre alphabétique), jamais son rang du jour
  const names = [...new Set((hours ?? []).filter((h) => h.at >= since).flatMap((h) => Object.keys(h.models ?? {})))].sort()
  const series = names.length > colors.length ? [...names.slice(0, colors.length - 1), OTHERS] : names
  const seriesOf = (m: string) => (series.includes(m) ? m : OTHERS)

  const days = starts.map((d) => {
    const end = new Date(d)
    end.setDate(end.getDate() + 1)
    const byModel = new Map<string, Usage>()
    for (const h of hours ?? []) {
      if (h.at < d.getTime() || h.at >= end.getTime()) continue
      for (const [m, u] of Object.entries(h.models ?? {})) {
        const key = seriesOf(m)
        if (!byModel.has(key)) byModel.set(key, empty())
        add(byModel.get(key)!, u)
      }
    }
    const total = empty()
    for (const u of byModel.values()) add(total, u)
    return { date: d, byModel, total }
  })
  const week = empty()
  for (const d of days) add(week, d.total)
  const perModel = series.map((m) => {
    const u = empty()
    for (const d of days) if (d.byModel.has(m)) add(u, d.byModel.get(m)!)
    return { model: m, u }
  })
  const max = Math.max(1, ...days.map((d) => totalTokens(d.total)))
  const todayTotal = days.at(-1)!.total
  const label = (m: string) => (m === OTHERS ? "autres modèles" : shortModel(m))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tokens et coût</CardTitle>
        <CardDescription>Toutes machines confondues, sur 7 jours, par modèle. {COST_NOTE}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {!hours ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : !names.length ? (
          <p className="text-sm text-muted-foreground">
            Aucune donnée de tokens : la télémétrie OpenTelemetry n'est pas encore activée sur les machines. Relance le script d'installation des hooks, puis les sessions Claude Code.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Tokens sur 7 jours" value={tokens(totalTokens(week))} hint={`${week.requests.toLocaleString("fr-FR")} requêtes au modèle`} />
              <Stat label="Coût estimé sur 7 jours" value={usd(week.cost)} hint="tarif public de l'API" />
              <Stat label="Aujourd'hui" value={tokens(totalTokens(todayTotal))} hint={usd(todayTotal.cost)} />
              <Stat label="Lu depuis le cache" value={cacheShare(week)} hint="des tokens sur 7 jours" />
            </div>

            <div className="flex flex-col gap-2">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende">
                {series.map((m, i) => (
                  <li key={m} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: colors[i] }} />
                    <span className="font-mono">{label(m)}</span>
                  </li>
                ))}
              </ul>
              <div className="grid h-44 grid-cols-7 items-end gap-3 border-b pb-px" role="img" aria-label="Tokens par jour et par modèle">
                {days.map((d) => (
                  <Tooltip key={d.date.getTime()}>
                    <TooltipTrigger asChild>
                      <div className="flex h-full cursor-default flex-col justify-end rounded-t px-1 hover:bg-accent/40">
                        <div className="mx-auto flex w-full max-w-12 flex-col-reverse gap-0.5" style={{ height: `${(100 * totalTokens(d.total)) / max}%` }}>
                          {series.map((m, i) => {
                            const u = d.byModel.get(m)
                            if (!u || !totalTokens(u)) return null
                            return <div key={m} className="w-full last:rounded-t" style={{ flexGrow: totalTokens(u), minHeight: 2, background: colors[i] }} />
                          })}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="flex flex-col gap-1 text-xs">
                      <span className="font-medium">
                        {d.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : {tokens(totalTokens(d.total))} · {usd(d.total.cost)}
                      </span>
                      {series
                        .filter((m) => d.byModel.has(m))
                        .map((m) => (
                          <span key={m} className="flex justify-between gap-4 tabular-nums">
                            <span className="font-mono">{label(m)}</span>
                            <span>
                              {tokens(totalTokens(d.byModel.get(m)!))} · {usd(d.byModel.get(m)!.cost)}
                            </span>
                          </span>
                        ))}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-3 text-center text-xs text-muted-foreground">
                {days.map((d, i) => (
                  <span key={d.date.getTime()} className={i === DAYS - 1 ? "font-medium text-foreground" : undefined}>
                    {i === DAYS - 1 ? "Auj." : dayLabel(d.date)}
                  </span>
                ))}
              </div>
            </div>

            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 text-left font-normal">Modèle</th>
                  <th className="py-1.5 text-right font-normal">Tokens</th>
                  <th className="hidden py-1.5 text-right font-normal sm:table-cell">Entrée</th>
                  <th className="hidden py-1.5 text-right font-normal sm:table-cell">Sortie</th>
                  <th className="py-1.5 text-right font-normal">Cache lu</th>
                  <th className="hidden py-1.5 text-right font-normal sm:table-cell">Requêtes</th>
                  <th className="py-1.5 text-right font-normal">Coût estimé</th>
                </tr>
              </thead>
              <tbody>
                {perModel.map(({ model, u }, i) => (
                  <tr key={model} className="border-b last:border-0">
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
                        <span className="font-mono">{label(model)}</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{tokens(totalTokens(u))}</td>
                    <td className="hidden py-1.5 text-right sm:table-cell">{tokens(u.input)}</td>
                    <td className="hidden py-1.5 text-right sm:table-cell">{tokens(u.output)}</td>
                    <td className="py-1.5 text-right">{cacheShare(u)}</td>
                    <td className="hidden py-1.5 text-right sm:table-cell">{u.requests.toLocaleString("fr-FR")}</td>
                    <td className="py-1.5 text-right">{usd(u.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
