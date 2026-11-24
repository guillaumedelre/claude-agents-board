import { Calendar, Gauge, type LucideIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ago } from "@/lib/format"
import type { Limit, Limits } from "@/lib/types"
import { cn } from "@/lib/utils"

const HOUR_MS = 3600e3
const FIVE_HOURS_MS = 5 * HOUR_MS
const WEEK_MS = 7 * 24 * HOUR_MS
// Au-delà, un relevé de la status line est signalé comme ancien (même seuil que le service usage)
const STALE_MS = 20 * 60e3

// Passée sa date de reset, une fenêtre repart de 0 en attendant la prochaine valeur
const current = (l: Limit | null | undefined, now: number) =>
  !l ? null : l.resetsAt != null && l.resetsAt <= now ? { pct: 0, resetsAt: null } : l

const tone = (pct: number) => (pct >= 85 ? "text-destructive" : pct >= 60 ? "text-attention" : "")

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })

// Heure du reset, précédée du jour s'il n'est pas aujourd'hui
const resetShort = (ts: number | null, now: number) =>
  ts == null
    ? null
    : new Date(ts).toDateString() === new Date(now).toDateString()
      ? hhmm(ts)
      : new Date(ts).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })

const resetLabel = (ts: number | null) =>
  ts == null ? "réinitialisée" : `reset ${new Date(ts).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`

// Part de la fenêtre déjà écoulée (0 à 100), null sans date de reset
const elapsedPct = (l: Limit, windowMs: number, now: number) =>
  l.resetsAt == null ? null : Math.min(100, Math.max(0, (1 - (l.resetsAt - now) / windowMs) * 100))

// Barre de consommation avec, en repère, la part de la fenêtre écoulée : la dépasser, c'est consommer plus vite que le temps
function Bar({ pct, pace, className, markerClassName }: { pct: number; pace: number | null; className?: string; markerClassName?: string }) {
  return (
    <span className={cn("relative h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span className="block h-full rounded-full bg-current" style={{ width: `${Math.min(100, pct)}%` }} />
      {pace != null && <span className={cn("absolute inset-y-0 w-px bg-foreground/70", markerClassName)} style={{ left: `${pace}%` }} />}
    </span>
  )
}

function Meter({ icon: Icon, name, limit, windowMs, now }: { icon: LucideIcon; name: string; limit: Limit | null; windowMs: number; now: number }) {
  if (!limit) return null
  const reset = resetShort(limit.resetsAt, now)
  return (
    <span className={cn("flex items-center gap-1.5", tone(limit.pct))}>
      <Icon className="size-3.5" />
      <span className="hidden md:inline">{name}</span>
      <Bar pct={limit.pct} pace={elapsedPct(limit, windowMs, now)} className="w-8 sm:w-12" />
      {Math.round(limit.pct)} %{reset && <span className="hidden opacity-70 lg:inline">{reset}</span>}
    </span>
  )
}

function Line({ name, limit, windowMs, now }: { name: string; limit: Limit | null; windowMs: number; now: number }) {
  if (!limit) return null
  const pace = elapsedPct(limit, windowMs, now)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-4 tabular-nums">
        <span className="font-medium">{name}</span>
        <span>{Math.round(limit.pct)} %</span>
      </div>
      <Bar pct={limit.pct} pace={pace} className="w-full bg-background/30" markerClassName="bg-background" />
      <span className="opacity-80">
        {resetLabel(limit.resetsAt)}
        {pace != null && ` · ${Math.round(pace)} % de la fenêtre écoulée`}
      </span>
    </div>
  )
}

// Origine du relevé : service usage frais, status line récente ou status line ancienne
function sourceOf(limits: Limits, now: number) {
  if (limits.source === "usage") return { dot: "bg-done", text: `Relevées par le service usage ${ago(limits.at, now)}.` }
  const stale = now - limits.at > STALE_MS
  return {
    dot: stale ? "bg-attention" : "bg-muted-foreground",
    text: `Service usage indisponible : reçues de la status line de ${limits.host} ${ago(limits.at, now)}${stale ? ", valeurs anciennes" : ""}.`,
  }
}

// Consommation de l'abonnement : semaine (7 jours glissants), fenêtre de 5 h et, quand le compte les a, semaines Opus et Sonnet
export function SubscriptionMeters({ limits, now }: { limits: Limits | null; now: number }) {
  if (!limits) return null
  const week = current(limits.sevenDay, now)
  const five = current(limits.fiveHour, now)
  const opus = current(limits.sevenDayOpus, now)
  const sonnet = current(limits.sevenDaySonnet, now)
  if (!week && !five) return null
  const source = sourceOf(limits, now)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex cursor-default items-center gap-3 tabular-nums">
          <Meter icon={Gauge} name="Semaine" limit={week} windowMs={WEEK_MS} now={now} />
          <Meter icon={Calendar} name="5 h" limit={five} windowMs={FIVE_HOURS_MS} now={now} />
          <span className={cn("size-1.5 rounded-full", source.dot)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex w-64 flex-col gap-2 text-xs">
        <Line name="Semaine" limit={week} windowMs={WEEK_MS} now={now} />
        <Line name="5 heures" limit={five} windowMs={FIVE_HOURS_MS} now={now} />
        <Line name="Semaine Opus" limit={opus} windowMs={WEEK_MS} now={now} />
        <Line name="Semaine Sonnet" limit={sonnet} windowMs={WEEK_MS} now={now} />
        <span className="opacity-80">Le trait vertical marque la part de la fenêtre écoulée : le dépasser, c'est consommer plus vite que le temps.</span>
        <span className="opacity-80">{source.text}</span>
      </TooltipContent>
    </Tooltip>
  )
}
