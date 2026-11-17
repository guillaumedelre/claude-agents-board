import { Gauge } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ago } from "@/lib/format"
import type { Limit, Limits } from "@/lib/types"
import { cn } from "@/lib/utils"

// Fenêtre dont la date de reset est passée : la status line ne l'envoie plus, elle est repartie de zéro
const current = (l: Limit | null, now: number) => (l && l.resetsAt != null && l.resetsAt <= now ? { pct: 0, resetsAt: null } : l)

const tone = (pct: number) => (pct >= 85 ? "text-destructive" : pct >= 60 ? "text-attention" : "")

const resetLabel = (ts: number | null) =>
  ts == null ? "réinitialisée" : `reset ${new Date(ts).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`

function Line({ name, limit }: { name: string; limit: Limit | null }) {
  if (!limit) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="font-medium">{name}</span>
        <span>{Math.round(limit.pct)} %</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background/30">
        <div className="h-full rounded-full bg-current" style={{ width: `${Math.min(100, limit.pct)}%` }} />
      </div>
      <span className="opacity-80">{resetLabel(limit.resetsAt)}</span>
    </div>
  )
}

// Consommation de l'abonnement : semaine (7 jours glissants) et fenêtre de 5 h
export function LimitsBadge({ limits, now }: { limits: Limits | null; now: number }) {
  if (!limits) return null
  const week = current(limits.sevenDay, now)
  const five = current(limits.fiveHour, now)
  const main = week ?? five
  if (!main) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("mr-2 flex cursor-default items-center gap-1.5 tabular-nums", tone(main.pct))}>
          <Gauge className="size-3.5" />
          <span className="hidden md:inline">{week ? "Semaine" : "5 h"}</span>
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-current" style={{ width: `${Math.min(100, main.pct)}%` }} />
          </span>
          {Math.round(main.pct)} %
          {week && five && <span className="hidden opacity-70 lg:inline">· 5 h {Math.round(five.pct)} %</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex w-56 flex-col gap-2 text-xs">
        <Line name="Semaine" limit={week} />
        <Line name="5 heures" limit={five} />
        <span className="opacity-80">
          Limites de l'abonnement, reçues de la status line de {limits.host} {ago(limits.at, now)}.
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
