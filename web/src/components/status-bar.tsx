import { Activity, CircleDollarSign, Loader2, Monitor, Radio, Unplug, Volume2, VolumeX } from "lucide-react"
import { CleanupMenu } from "@/components/cleanup-menu"
import { SubscriptionMeters } from "@/components/limits"
import { ThemeMenu } from "@/components/theme-menu"
import { Button } from "@/components/ui/button"
import { ago, usd } from "@/lib/format"
import type { Limits } from "@/lib/types"
import { cn } from "@/lib/utils"

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`

const Divider = () => <span className="h-3.5 w-px shrink-0 bg-border" />

// Coût estimé depuis minuit (heure locale du navigateur), à partir des totaux horaires du serveur
function costToday(costByHour: Record<string, number> | undefined, now: number) {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  let total = 0
  for (const [at, cost] of Object.entries(costByHour ?? {})) if (Number(at) >= midnight) total += cost
  return total
}

// Barre d'état en quatre zones : connexion, activité, abonnement (centré), réglages
export function StatusBar({
  online,
  hosts,
  sessions,
  runningAgents,
  lastEvent,
  now,
  endedCount,
  showEnded,
  onShowEnded,
  autoCleanupMs,
  ready,
  sounds,
  onSounds,
  limits,
  costByHour,
}: {
  online: boolean
  hosts: number
  sessions: number
  runningAgents: number
  lastEvent: number | null
  now: number
  endedCount: number
  showEnded: boolean
  onShowEnded: (v: boolean) => void
  autoCleanupMs: number
  ready: boolean
  sounds: boolean
  onSounds: (v: boolean) => void
  limits: Limits | null
  costByHour?: Record<string, number>
}) {
  const cost = costToday(costByHour, now)
  return (
    <footer
      className={cn(
        "grid h-8 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t px-3 text-xs text-muted-foreground",
        !online && "bg-destructive/10 text-destructive",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        {/* Connexion : flux temps réel et âge du dernier événement reçu */}
        <span
          className={cn("flex shrink-0 items-center gap-1.5", online && "text-done")}
          title={
            (online ? "Flux temps réel connecté" : "Flux temps réel coupé, reconnexion…") +
            (lastEvent != null ? `. Dernier événement reçu d'un hook ${ago(lastEvent, now)}.` : "")
          }
        >
          {online ? <Radio className="size-3.5" /> : <Unplug className="size-3.5" />}
          <span className="hidden sm:inline">{online ? "En direct" : "Hors ligne"}</span>
          {lastEvent != null && (
            <span className="hidden text-muted-foreground lg:inline">· {ago(lastEvent, now).replace("il y a ", "")}</span>
          )}
        </span>

        <Divider />

        {/* Activité : machines, sessions ouvertes, agents en cours, coût du jour */}
        <span className="flex min-w-0 items-center gap-3 tabular-nums">
          <span className="hidden items-center gap-1 sm:flex" title={plural(hosts, "machine")}>
            <Monitor className="size-3.5" />
            {hosts}
            <span className="hidden xl:inline">machine{hosts > 1 ? "s" : ""}</span>
          </span>
          <span className="hidden items-center gap-1 sm:flex" title={plural(sessions, "session") + " ouverte" + (sessions > 1 ? "s" : "")}>
            <Activity className="size-3.5" />
            {sessions}
            <span className="hidden xl:inline">session{sessions > 1 ? "s" : ""}</span>
          </span>
          <span
            className={cn("flex items-center gap-1", runningAgents > 0 && "text-running")}
            title={`${plural(runningAgents, "agent")} en cours`}
          >
            <Loader2 className={cn("size-3.5", runningAgents > 0 && "animate-spin")} />
            {runningAgents}
            <span className="hidden xl:inline">en cours</span>
          </span>
          {cost > 0 && (
            <span
              className="hidden items-center gap-1 md:flex"
              title="Coût estimé depuis minuit, toutes machines confondues, au tarif public de l'API (ce n'est pas ce que facture l'abonnement)"
            >
              <CircleDollarSign className="size-3.5" />
              {usd(cost)}
              <span className="hidden xl:inline">aujourd'hui</span>
            </span>
          )}
        </span>
      </span>

      {/* Abonnement : semaine et fenêtre de 5 h */}
      <SubscriptionMeters limits={limits} now={now} />

      {/* Réglages : sessions fermées et nettoyage, sons, thème */}
      <span className="flex items-center justify-end gap-1">
        {ready && <CleanupMenu closedCount={endedCount} autoCleanupMs={autoCleanupMs} showEnded={showEnded} onShowEnded={onShowEnded} />}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-inherit"
          title={sounds ? "Sons : activés" : "Sons : désactivés"}
          aria-pressed={sounds}
          onClick={() => onSounds(!sounds)}
        >
          {sounds ? <Volume2 /> : <VolumeX />}
          <span className="sr-only">Sons</span>
        </Button>
        <ThemeMenu />
      </span>
    </footer>
  )
}
