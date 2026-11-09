import { useState } from "react"
import { AlertTriangle, ArrowUpRight, Bot, ChevronRight, Loader2, User, X } from "lucide-react"
import { ToolIcon } from "@/components/status"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { clock, duration } from "@/lib/format"
import type { BoardEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

const SOURCES: Record<string, string> = {
  sdk: "SDK",
  system: "système",
  loop_wakeup: "/loop",
  schedule_wakeup: "planifié",
  poll_event: "événement",
}

export function Timeline({
  events,
  agentFor,
  onOpenAgent,
}: {
  events: BoardEvent[]
  agentFor?: (toolUseId: string) => string | undefined
  onOpenAgent?: (agentId: string) => void
}) {
  if (!events.length) return <p className="py-8 text-center text-sm text-muted-foreground">Aucune activité reçue.</p>
  return (
    <ol className="flex flex-col gap-1.5">
      {events.map((ev) => (
        <li key={ev.id}>
          {ev.kind === "tool" ? (
            <ToolRow ev={ev} agentId={ev.toolUseId ? agentFor?.(ev.toolUseId) : undefined} onOpenAgent={onOpenAgent} />
          ) : ev.kind === "prompt" ? (
            <Bubble icon={<User className="size-3.5" />} label="Prompt" at={ev.at} extra={ev.source && SOURCES[ev.source]}>
              {ev.text}
            </Bubble>
          ) : ev.kind === "message" ? (
            <Bubble icon={<Bot className="size-3.5" />} label="Réponse" at={ev.at} tone="answer">
              {ev.text}
            </Bubble>
          ) : ev.kind === "error" ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <pre className="font-sans whitespace-pre-wrap">{ev.text}</pre>
            </div>
          ) : (
            <p className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {ev.text} · {clock(ev.at)}
              <span className="h-px flex-1 bg-border" />
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

export function Bubble({
  icon,
  label,
  at,
  extra,
  tone,
  children,
}: {
  icon: React.ReactNode
  label: string
  at?: number
  extra?: string | false
  tone?: "answer"
  children: React.ReactNode
}) {
  return (
    <div className={cn("my-1.5 rounded-lg border px-3.5 py-2.5", tone === "answer" ? "bg-card" : "bg-muted/50")}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
        {extra && <Badge variant="outline" className="text-[10px]">{extra}</Badge>}
        {at && <span className="ml-auto font-normal">{clock(at)}</span>}
      </div>
      <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">{children}</div>
    </div>
  )
}

function ToolRow({
  ev,
  agentId,
  onOpenAgent,
}: {
  ev: BoardEvent
  agentId?: string
  onOpenAgent?: (agentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-card">
      <div className="flex items-center">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <ToolIcon tool={ev.tool} className="text-muted-foreground" />
          <span className="shrink-0 font-mono font-medium">{ev.tool}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{ev.summary}</span>
          {ev.pending ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-running" />
          ) : ev.ok === false ? (
            <X className="size-3.5 shrink-0 text-destructive" />
          ) : null}
          {ev.durationMs != null && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{duration(ev.durationMs)}</span>
          )}
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">{clock(ev.at)}</span>
        </CollapsibleTrigger>
        {agentId && onOpenAgent && (
          <button
            type="button"
            onClick={() => onOpenAgent(agentId)}
            className="mr-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Ouvrir <ArrowUpRight className="size-3" />
          </button>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-2 border-t px-2.5 py-2">
        <Block label="Entrée" text={ev.input} />
        {!ev.pending && <Block label={ev.ok === false ? "Erreur" : "Sortie"} text={ev.output} danger={ev.ok === false} />}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Block({ label, text, danger }: { label: string; text?: string | null; danger?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground uppercase">{label}</div>
      <pre
        className={cn(
          "max-h-80 overflow-auto rounded bg-muted/60 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap",
          danger && "text-destructive",
        )}
      >
        {text || "(vide)"}
      </pre>
    </div>
  )
}
