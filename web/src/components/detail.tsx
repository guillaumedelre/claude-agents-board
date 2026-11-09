import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Bot, CheckCircle2, Copy, FolderGit2, Monitor, ScrollText, Trash2 } from "lucide-react"
import { Gantt } from "@/components/gantt"
import { AgentTree } from "@/components/session-list"
import { StatusBadge } from "@/components/status"
import { Bubble, Timeline } from "@/components/timeline"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go } from "@/hooks/use-board"
import { ago, clock, duration, sessionLabel, shortModel, tokens } from "@/lib/format"
import { agentDisplay, sessionDisplay } from "@/lib/status"
import { buildTree } from "@/lib/tree"
import type { SessionDetail } from "@/lib/types"

const VIEW_KEY = "agents.detailView"
type View = "journal" | "timeline"

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "timeline" ? "timeline" : "journal"
  } catch {
    return "journal"
  }
}

// Suit le bas de la chronologie tant que l'utilisateur n'est pas remonté lire plus haut
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => (stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80)
    el.addEventListener("scroll", onScroll)
    return () => el.removeEventListener("scroll", onScroll)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

export function Detail({ session: s, agentId, now }: { session: SessionDetail; agentId: string | null; now: number }) {
  const [view, setView] = useState<View>(readView)
  const pickView = (v: string) => {
    setView(v as View)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* préférence non retenue */
    }
  }
  const agent = agentId ? s.agents[agentId] : undefined
  const events = agent ? (agent.events ?? []) : s.events
  const scrollRef = useStickToBottom(`${view}/${s.id}/${agentId}/${events.length}/${events.at(-1)?.pending}`)
  const agents = Object.values(s.agents)
  const byToolUse = new Map(agents.filter((a) => a.toolUseId).map((a) => [a.toolUseId!, a.id]))
  const children = buildTree(agents.filter((a) => (a.parentId ?? null) === (agent?.id ?? null)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="-ml-2 md:hidden" onClick={() => go(agent ? s.id : null)} aria-label="Retour">
            <ArrowLeft />
          </Button>
          {agent && (
            <Button variant="ghost" size="sm" className="-ml-2 hidden md:inline-flex" onClick={() => go(s.id)}>
              <ArrowLeft /> {sessionLabel({ title: s.title, firstPrompt: null })}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h1 className="min-w-0 flex-1 text-lg leading-tight font-semibold break-words">
            {agent ? (
              <span className="flex items-center gap-2">
                <Bot className="size-5 shrink-0 text-muted-foreground" />
                {agent.description ?? "Agent sans description"}
              </span>
            ) : (
              sessionLabel({
                title: s.title,
                firstPrompt: s.events.find((e) => e.kind === "prompt")?.text,
              })
            )}
          </h1>
          <StatusBadge status={agent ? agentDisplay(agent, now) : sessionDisplay(s, now)} />
          {!agent && <DeleteSession id={s.id} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {agent ? (
            <>
              <span className="font-mono">{agent.type ?? "agent"}</span>
              {shortModel(agent.model) && <span className="font-mono">{shortModel(agent.model)}</span>}
              <span>Lancé à {clock(agent.startedAt)}</span>
              <span>Durée {duration(agent.durationMs ?? (agent.endedAt ?? now) - agent.startedAt)}</span>
              {agent.tokens != null && <span>{tokens(agent.tokens)} tokens</span>}
              <CopyId label="ID agent" value={agent.id} />
            </>
          ) : (
            <>
              <span className="flex items-center gap-1" title={s.cwd ?? ""}>
                <FolderGit2 className="size-3.5" />
                <span className="font-mono">{s.cwd ?? "?"}</span>
              </span>
              <span className="flex items-center gap-1">
                <Monitor className="size-3.5" />
                {s.host}
              </span>
              {shortModel(s.model) && <span className="font-mono">{shortModel(s.model)}</span>}
              {s.permissionMode && (
                <Badge variant="outline" className="text-[10px]">
                  {s.permissionMode}
                </Badge>
              )}
              <span>Vu {ago(s.lastSeen, now)}</span>
              <CopyId label="ID session" value={s.id} copyText={`claude --resume ${s.id}`} />
            </>
          )}
        </div>
        <Tabs value={view} onValueChange={pickView}>
          <TabsList>
            <TabsTrigger value="journal">Journal</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {view === "timeline" ? (
          <div className="px-4 py-4 md:px-6">
            <Gantt session={s} agentId={agentId} />
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-4 md:px-6">
            {children.length > 0 && (
              <section className="rounded-lg border bg-card p-1.5">
                <h2 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
                  {agent ? "Sous-agents lancés" : "Agents de la session"}
                </h2>
                <AgentTree nodes={children} sessionId={s.id} selectedId={agentId} now={now} />
              </section>
            )}

            {agent?.prompt && (
              <Collapsible defaultOpen={agent.prompt.length < 1500}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-fit">
                    <ScrollText /> Consigne de l'agent
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Bubble icon={<ScrollText className="size-3.5" />} label="Consigne">
                    {agent.prompt}
                  </Bubble>
                </CollapsibleContent>
              </Collapsible>
            )}

            {agent && !agent.toolUseId && !agent.prompt && (
              <p className="text-xs text-muted-foreground">
                Consigne inconnue : l'appel qui a lancé cet agent n'a pas été reçu (workflow, ou hooks installés après son lancement).
              </p>
            )}

            <Separator />

            <Timeline events={events} agentFor={(id) => byToolUse.get(id)} onOpenAgent={(id) => go(s.id, id)} />

            {agent?.result && (
              <Bubble
                icon={<CheckCircle2 className="size-3.5 text-done" />}
                label="Rapport final"
                at={agent.endedAt ?? undefined}
                tone="answer"
              >
                {agent.result}
              </Bubble>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CopyId({ label, value, copyText }: { label: string; value: string; copyText?: string }) {
  // navigator.clipboard n'existe qu'en contexte sécurisé, or l'app est servie en HTTP
  const copy = () => {
    const text = copyText ?? value
    if (navigator.clipboard) return void navigator.clipboard.writeText(text)
    const ta = Object.assign(document.createElement("textarea"), {
      value: text,
    })
    document.body.append(ta)
    ta.select()
    document.execCommand("copy")
    ta.remove()
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={copy} className="flex items-center gap-1 font-mono hover:text-foreground">
          <Copy className="size-3" />
          {value.slice(0, 8)}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copyText ? `Copier « ${copyText} »` : `Copier ${label}`}</TooltipContent>
    </Tooltip>
  )
}

function DeleteSession({ id }: { id: string }) {
  const remove = async () => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    go(null)
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Retirer la session">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retirer cette session du tableau ?</AlertDialogTitle>
          <AlertDialogDescription>
            Son historique et ses agents disparaissent du tableau. La session Claude Code elle-même n'est pas touchée, et réapparaîtra au
            prochain événement qu'elle envoie.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={remove}>Retirer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
