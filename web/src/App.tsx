import { useEffect, useState } from "react"
import { Activity, BellRing, Bot, Loader2, Monitor, Radio, Unplug } from "lucide-react"
import { CleanupMenu } from "@/components/cleanup-menu"
import { Detail } from "@/components/detail"
import { Logo } from "@/components/logo"
import { Overview } from "@/components/overview"
import { SessionList } from "@/components/session-list"
import { ThemeMenu } from "@/components/theme-menu"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { go, useBoard, useHashRoute, useNow, useSession } from "@/hooks/use-board"
import { agentDisplay, isClosed, sessionDisplay } from "@/lib/status"
import { cn } from "@/lib/utils"

const SHOW_ENDED_KEY = "agents.showEnded"

function readShowEnded() {
  try {
    return localStorage.getItem(SHOW_ENDED_KEY) === "1"
  } catch {
    return false
  }
}

export default function App() {
  const { board, online } = useBoard()
  const { sessionId, agentId } = useHashRoute()
  const now = useNow()
  const [showEnded, setShowEnded] = useState(readShowEnded)
  const summary = board?.sessions.find((s) => s.id === sessionId)
  const { detail, missing } = useSession(sessionId, summary?.lastSeen)

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_ENDED_KEY, showEnded ? "1" : "0")
    } catch {
      /* stockage indisponible : préférence non retenue */
    }
  }, [showEnded])

  const sessions = (board?.sessions ?? []).filter((s) => showEnded || !isClosed(s, now) || s.id === sessionId)
  const live = board?.sessions.filter((s) => !isClosed(s, now)) ?? []
  const runningAgents = live.flatMap((s) => s.agents).filter((a) => agentDisplay(a, now) === "running").length
  const waiting = live.filter((s) => sessionDisplay(s, now) === "attention").length
  const hosts = new Set(live.map((s) => s.host))
  const endedCount = (board?.sessions.length ?? 0) - live.length
  const autoCleanupMs = board?.settings?.autoCleanupMs ?? 0

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5">
        <button
          type="button"
          onClick={() => go(null)}
          className="flex items-center gap-2 rounded-md font-semibold outline-none hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title="Retour à l'accueil"
        >
          <Logo className="size-5 text-[#d97757]" />
          Agents
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            <Monitor /> {hosts.size} machine{hosts.size > 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline">
            <Activity /> {live.length} session{live.length > 1 ? "s" : ""}
          </Badge>
          <Badge variant="outline" className={cn(runningAgents > 0 && "border-running/40 text-running")}>
            <Loader2 className={cn(runningAgents > 0 && "animate-spin")} /> {runningAgents} agent{runningAgents > 1 ? "s" : ""} en cours
          </Badge>
          {waiting > 0 && (
            <Badge variant="outline" className="border-attention/50 text-attention">
              <BellRing /> {waiting} en attente
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {endedCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showEnded} onCheckedChange={setShowEnded} size="sm" />
              Fermées ({endedCount})
            </label>
          )}
          {board && <CleanupMenu closedCount={endedCount} autoCleanupMs={autoCleanupMs} />}
          <ThemeMenu />
          <span
            className={cn("flex items-center gap-1.5 text-xs", online ? "text-done" : "text-destructive")}
            title={online ? "Flux temps réel connecté" : "Flux temps réel coupé, reconnexion…"}
          >
            {online ? <Radio className="size-3.5" /> : <Unplug className="size-3.5" />}
            <span className="hidden sm:inline">{online ? "En direct" : "Hors ligne"}</span>
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <aside className={cn("min-h-0 w-full border-r md:block md:w-[400px] md:shrink-0", sessionId && "hidden")}>
          {board && sessions.length > 0 ? (
            <ScrollArea className="h-full">
              <SessionList sessions={sessions} selection={{ sessionId, agentId }} now={now} autoCleanupMs={autoCleanupMs} />
            </ScrollArea>
          ) : (
            board && <NoSessions hasEnded={endedCount > 0} />
          )}
        </aside>
        <section className={cn("min-h-0 min-w-0 flex-1", !sessionId && "hidden md:block")}>
          {!sessionId ? (
            board && <Overview sessions={board.sessions} now={now} />
          ) : detail ? (
            <Detail session={detail} agentId={agentId} now={now} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {missing ? "Cette session n'est plus sur le tableau." : <Loader2 className="animate-spin" />}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function NoSessions({ hasEnded }: { hasEnded: boolean }) {
  const origin = window.location.origin
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Bot />
        </EmptyMedia>
        <EmptyTitle>{hasEnded ? "Aucune session ouverte" : "Aucune session reçue"}</EmptyTitle>
        <EmptyDescription>
          {hasEnded
            ? "Les sessions fermées sont masquées."
            : "Branche une machine en installant ses hooks, puis relance ses sessions Claude Code."}
        </EmptyDescription>
      </EmptyHeader>
      {!hasEnded && (
        <EmptyContent className="max-w-full items-stretch text-left">
          <InstallCommand label="Linux, macOS" command={`curl -fsSL ${origin}/install-hooks.sh | sh -s -- --host <nom>`} />
          <InstallCommand
            label="Windows (PowerShell)"
            command={`& ([scriptblock]::Create((irm ${origin}/install-hooks.ps1))) -HostName <nom>`}
          />
        </EmptyContent>
      )}
    </Empty>
  )
}

function InstallCommand({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <code className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] break-all select-all">{command}</code>
    </div>
  )
}
