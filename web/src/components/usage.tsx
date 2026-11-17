import { Coins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { shortModel, tokens, totalTokens, usd } from "@/lib/format"
import type { SessionUsage, Usage } from "@/lib/types"

export const COST_NOTE = "Coût estimé par Claude Code au tarif public de l'API, pas ce qui est facturé avec un abonnement."

// Répartition d'un usage : tokens par catégorie et part lue depuis le cache
export function UsageLines({ u }: { u: Usage }) {
  const total = totalTokens(u)
  const cached = total ? Math.round((100 * u.cacheRead) / total) : 0
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
      <dt>Entrée</dt>
      <dd className="text-right">{tokens(u.input)}</dd>
      <dt>Sortie</dt>
      <dd className="text-right">{tokens(u.output)}</dd>
      <dt>Cache lu</dt>
      <dd className="text-right">
        {tokens(u.cacheRead)} ({cached} %)
      </dd>
      <dt>Cache écrit</dt>
      <dd className="text-right">{tokens(u.cacheCreation)}</dd>
      <dt>Requêtes</dt>
      <dd className="text-right">{u.requests}</dd>
    </dl>
  )
}

// Badge tokens et coût d'une session, détail au survol
export function UsageBadge({ usage, className }: { usage: SessionUsage; className?: string }) {
  const models = Object.entries(usage.models).sort((a, b) => b[1].cost - a[1].cost)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`gap-1 font-mono text-[11px] tabular-nums ${className ?? ""}`}>
          <Coins className="size-3" />
          {tokens(totalTokens(usage))} · {usd(usage.cost)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="flex max-w-80 flex-col gap-2 text-xs">
        <span className="font-medium">
          {tokens(totalTokens(usage))} tokens · {usd(usage.cost)}
        </span>
        <UsageLines u={usage} />
        {models.length > 1 && (
          <ul className="flex flex-col gap-0.5 tabular-nums">
            {models.map(([m, u]) => (
              <li key={m} className="flex justify-between gap-3">
                <span className="font-mono">{shortModel(m)}</span>
                <span>
                  {tokens(totalTokens(u))} · {usd(u.cost)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <span className="opacity-80">{COST_NOTE}</span>
      </TooltipContent>
    </Tooltip>
  )
}
