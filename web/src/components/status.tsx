import {
  Bot,
  FileText,
  FilePen,
  Globe,
  ListChecks,
  type LucideIcon,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { type Display, LABELS } from "@/lib/status"
import { cn } from "@/lib/utils"

const DOT: Record<Display, string> = {
  running: "bg-running",
  attention: "bg-attention",
  idle: "bg-muted-foreground/40",
  done: "bg-done",
  error: "bg-destructive",
  ended: "bg-muted-foreground/25",
  stale: "bg-muted-foreground/60",
  stopped: "bg-muted-foreground/40",
}

export function StatusDot({ status, className }: { status: Display; className?: string }) {
  const live = status === "running" || status === "attention"
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)} title={LABELS[status]}>
      {live && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", DOT[status])} />}
      <span className={cn("relative inline-flex size-2.5 rounded-full", DOT[status])} />
    </span>
  )
}

const BADGE: Record<Display, string> = {
  running: "border-running/40 text-running",
  attention: "border-attention/50 text-attention",
  idle: "text-muted-foreground",
  done: "border-done/40 text-done",
  error: "border-destructive/50 text-destructive",
  ended: "text-muted-foreground",
  stale: "text-muted-foreground",
  stopped: "text-muted-foreground",
}

export function StatusBadge({ status }: { status: Display }) {
  return (
    <Badge variant="outline" className={BADGE[status]}>
      <StatusDot status={status} className="size-2" />
      {LABELS[status]}
    </Badge>
  )
}

const ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Read: FileText,
  Write: FilePen,
  Edit: FilePen,
  NotebookEdit: FilePen,
  Grep: Search,
  Glob: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Agent: Bot,
  Skill: Sparkles,
  TodoWrite: ListChecks,
  TaskCreate: ListChecks,
  TaskUpdate: ListChecks,
}

export function ToolIcon({ tool, className }: { tool?: string; className?: string }) {
  const Icon = (tool && ICONS[tool]) || Wrench
  return <Icon className={cn("size-3.5 shrink-0", className)} />
}
