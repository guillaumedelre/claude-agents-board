import { Activity, Loader2, Monitor, Radio, Unplug, Volume2, VolumeX } from "lucide-react"
import { CleanupMenu } from "@/components/cleanup-menu"
import { LimitsBadge } from "@/components/limits"
import { ThemeMenu } from "@/components/theme-menu"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ago } from "@/lib/format"
import type { Limits } from "@/lib/types"
import { cn } from "@/lib/utils"

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`

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
}) {
  return (
    <footer
      className={cn(
        "flex h-8 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground",
        !online && "bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn("flex items-center gap-1.5", online && "text-done")}
        title={online ? "Flux temps réel connecté" : "Flux temps réel coupé, reconnexion…"}
      >
        {online ? <Radio className="size-3.5" /> : <Unplug className="size-3.5" />}
        <span className="hidden sm:inline">{online ? "En direct" : "Hors ligne"}</span>
      </span>

      <span className="h-3.5 w-px bg-border" />

      <span className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1" title={plural(hosts, "machine")}>
          <Monitor className="size-3.5" />
          {hosts}
          <span className="hidden md:inline">machine{hosts > 1 ? "s" : ""}</span>
        </span>
        <span className="flex items-center gap-1" title={plural(sessions, "session")}>
          <Activity className="size-3.5" />
          {sessions}
          <span className="hidden md:inline">session{sessions > 1 ? "s" : ""}</span>
        </span>
        <span
          className={cn("flex items-center gap-1", runningAgents > 0 && "text-running")}
          title={`${plural(runningAgents, "agent")} en cours`}
        >
          <Loader2 className={cn("size-3.5", runningAgents > 0 && "animate-spin")} />
          {runningAgents}
          <span className="hidden md:inline">agent{runningAgents > 1 ? "s" : ""} en cours</span>
        </span>
        {lastEvent != null && (
          <span className="hidden truncate lg:inline" title="Dernier événement reçu d'un hook">
            dernier événement {ago(lastEvent, now)}
          </span>
        )}
      </span>

      <span className="ml-auto flex items-center gap-1">
        <LimitsBadge limits={limits} now={now} />
        {endedCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent hover:text-accent-foreground">
            <Switch checked={showEnded} onCheckedChange={onShowEnded} size="sm" />
            <span>
              <span className="hidden sm:inline">Fermées </span>({endedCount})
            </span>
          </label>
        )}
        {ready && <CleanupMenu closedCount={endedCount} autoCleanupMs={autoCleanupMs} />}
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
