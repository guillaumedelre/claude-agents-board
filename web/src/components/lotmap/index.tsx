import { useState } from "react"
import { useLive, useNow } from "@/hooks/use-board"
import type { BoardEvent, SessionDetail } from "@/lib/types"
import { SessionCard, StationCard } from "./card"
import { reducedMotion, useDark, useLocalTimes } from "./hooks"
import { type MapBoard, type StationId, buildBoard, describeNow, drawMap, paletteOf } from "./map"

type Tip = { kind: "station"; id: StationId; x: number; y: number } | { kind: "core"; x: number; y: number }

// Événements allégés reçus en direct, superposés au détail complet (rechargé moins souvent) :
// l'historique reste entier, les derniers changements arrivent sans attendre
function mergeEvents(base: BoardEvent[], fresh: BoardEvent[]) {
  const byId = new Map(base.map((e) => [e.id, e]))
  for (const e of fresh) {
    const old = byId.get(e.id)
    // Le direct tronque entrées et textes et n'a pas les sorties : on garde ceux du détail
    byId.set(e.id, old ? { ...old, ...e, input: old.input ?? e.input, text: old.text ?? e.text } : e)
  }
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

function overlay(full: SessionDetail, live: SessionDetail | null): SessionDetail {
  if (!live || live.id !== full.id || live.lastSeen < full.lastSeen) return full
  const agents = { ...full.agents }
  for (const a of Object.values(live.agents)) {
    const old = agents[a.id]
    agents[a.id] = old ? { ...old, ...a, prompt: old.prompt, result: old.result, events: mergeEvents(old.events ?? [], a.events ?? []) } : a
  }
  const turns = new Map(full.turns.map((t) => [t.start, t]))
  for (const t of live.turns) turns.set(t.start, t)
  return {
    ...full,
    ...live,
    tasks: full.tasks,
    estimates: full.estimates,
    events: mergeEvents(full.events, live.events),
    agents,
    turns: [...turns.values()].sort((a, b) => a.start - b.start),
  }
}

export function LotMap({ session: full, agentId }: { session: SessionDetail; agentId: string | null }) {
  const [live, setLive] = useState<SessionDetail | null>(null)
  useLive(full.id, setLive)
  const s = overlay(full, live)
  const dark = useDark()
  const localize = useLocalTimes()
  const now = useNow(1000)
  const c = paletteOf(dark)
  // Station épinglée par un clic : sa fenêtre reste affichée
  const [pinned, setPinned] = useState<StationId | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  const raw = buildBoard(s, agentId)
  const agent = agentId ? s.agents[agentId] : undefined
  // Heures locales de réception, pour que les impulsions partent à l'arrivée de l'événement
  const board: MapBoard = { ...raw, entries: localize(raw.entries, now) }
  board.switchedAt = board.entries.findLast((e) => e.mark === "switch")?.startedAt
  const svg = drawMap(board, now, c, !reducedMotion(), pinned)

  const onSvgMove = (e: React.MouseEvent) => {
    const target = e.target as Element
    const id = target.closest("[data-station]")?.getAttribute("data-station") as StationId | null
    if (id) setTip({ kind: "station", id, x: e.clientX, y: e.clientY })
    else if (target.closest("[data-core]")) setTip({ kind: "core", x: e.clientX, y: e.clientY })
    else setTip(null)
  }
  const onSvgClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest("[data-station]")?.getAttribute("data-station") as StationId | null
    if (id) setPinned((f) => (f === id ? null : id))
  }
  const title = agent ? `#${agent.number} ${agent.type ?? "agent"}` : (s.name ?? `Session ${s.number}`)

  return (
    // La carte occupe tout le panneau ; l'action en cours en surimpression, informations dans les fenêtres au survol
    <div className="relative h-full min-h-80 overflow-hidden rounded-xl" style={{ background: c.ground, color: c.ash }}>
      <div
        className="absolute inset-0 p-2 pt-12"
        role="img"
        aria-label={`Carte du travail. ${describeNow(board)}`}
        onMouseMove={onSvgMove}
        onMouseLeave={() => setTip(null)}
        onClick={onSvgClick}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="pointer-events-none absolute top-3 right-3 flex max-w-[60%] flex-col items-end gap-2 font-mono text-xs">
        <div className="max-w-full truncate rounded px-2 py-1" style={{ background: c.raised, border: `1px solid ${c.line}`, color: c.bone }} title={describeNow(board)}>
          {describeNow(board)}
        </div>
        {pinned && (
          <div className="pointer-events-auto flex flex-col items-end gap-1">
            <StationCard board={board} station={pinned} c={c} now={now} />
            <button type="button" className="underline" style={{ color: c.dim }} onClick={() => setPinned(null)}>
              détacher
            </button>
          </div>
        )}
      </div>

      {tip && (
        <div className="pointer-events-none fixed z-50 flex flex-col gap-1" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.kind === "station" ? (
            <>
              <StationCard board={board} station={tip.id} c={c} now={now} />
              <div className="font-mono text-[11px]" style={{ color: c.dim }}>
                {pinned === tip.id ? "clic : détacher" : "clic : épingler"}
              </div>
            </>
          ) : (
            <SessionCard board={board} c={c} title={title} />
          )}
        </div>
      )}
    </div>
  )
}
