import { StatusDot } from "@/components/status"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go } from "@/hooks/use-board"
import { basename, sessionLabel } from "@/lib/format"
import { LABELS, sessionDisplay } from "@/lib/status"
import type { SessionSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

// Deux lettres pour un projet : les initiales de ses deux premiers mots, sinon ses deux premières lettres
function initials(cwd: string | null) {
  const words = basename(cwd).split(/[-_.\s]+/).filter(Boolean)
  const text = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)
  return text.toUpperCase()
}

// Barre latérale repliée : un raccourci par session, regroupés par machine dans l'ordre de la liste
export function SessionRail({ sessions, selectedId, now }: { sessions: SessionSummary[]; selectedId: string | null; now: number }) {
  const hosts = [...new Set(sessions.map((s) => s.host))]
  return (
    <nav className="flex h-full flex-col items-center gap-3 overflow-y-auto py-3" aria-label="Sessions">
      {hosts.map((host, i) => {
        const own = sessions.filter((s) => s.host === host)
        return (
          <div key={host} className="flex flex-col items-center gap-3">
            {i > 0 && <span className="my-1 h-px w-6 bg-border" aria-hidden="true" />}
            {own.map((s) => {
              const status = sessionDisplay(s, now)
              const running = s.agents.filter((a) => a.status === "running").length
              const twins = own.filter((x) => x.cwd === s.cwd).length > 1
              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => go(s.id)}
                      aria-label={`${sessionLabel(s)}, ${basename(s.cwd)}, ${host} : ${LABELS[status]}`}
                      aria-current={s.id === selectedId ? "page" : undefined}
                      className={cn(
                        "relative flex size-9 items-center justify-center rounded-md border bg-card font-mono text-[11px] font-semibold outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        s.id === selectedId && "border-foreground/60 bg-accent",
                        status === "attention" && "border-attention/60 text-attention",
                        (status === "ended" || status === "stale") && "opacity-50",
                      )}
                    >
                      {initials(s.cwd)}
                      {twins && <span className="absolute bottom-0.5 left-1 text-[8px] font-normal text-muted-foreground">{s.number}</span>}
                      <StatusDot status={status} className="absolute -right-0.5 -bottom-0.5 size-2" />
                      {running > 0 && (
                        <span className="absolute -top-1 -right-1 rounded-full bg-running px-1 text-[9px] leading-3.5 font-medium text-background">{running}</span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="flex max-w-72 flex-col gap-0.5">
                    <span className="font-medium">
                      {sessionLabel(s)} · {basename(s.cwd)}
                    </span>
                    <span className="opacity-80">
                      {host} · {LABELS[status]}
                      {running > 0 && ` · ${running} agent${running > 1 ? "s" : ""}`}
                    </span>
                    {(s.attention ?? s.subject) && <span className="truncate opacity-80">{s.attention ?? s.subject}</span>}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
