import { useState } from "react"
import { go, useLive, useNow } from "@/hooks/use-board"
import { basename, sessionLabel } from "@/lib/format"
import { sessionDisplay } from "@/lib/status"
import type { SessionDetail, SessionSummary } from "@/lib/types"
import { SessionCard, StationCard } from "./card"
import { reducedMotion, useDark, useLocalTimes } from "./hooks"
import { type MapBoard, type StationId, type TreeSession, buildBoard, describeNow, drawTree, paletteOf } from "./map"


type Tip = { kind: "station"; id: StationId; x: number; y: number } | { kind: "hub"; id: string; x: number; y: number }

// Sessions ouvertes : chargées à la connexion au flux, puis remplacées une à une à chaque hook
function useOpenDetails(sessions: SessionSummary[]) {
  const [details, setDetails] = useState<Record<string, SessionDetail>>({})
  // Une réponse plus ancienne que ce qui est déjà arrivé en direct ne l'écrase pas
  const keep = (all: Record<string, SessionDetail>, list: SessionDetail[]) => {
    const next = { ...all }
    for (const d of list) if (!next[d.id] || next[d.id].lastSeen <= d.lastSeen) next[d.id] = d
    return next
  }
  const load = () =>
    fetch("/api/galaxy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDetails((all) => keep(all, d.sessions ?? [])))
      .catch(() => {})
  useLive("all", (d) => setDetails((all) => keep(all, [d])), load)
  const ids = new Set(sessions.map((s) => s.id))
  return Object.values(details).filter((d) => ids.has(d.id))
}

// Toutes les sessions sur un seul tableau : identifiants préfixés par la session, libellés par la machine et la session
function mergeBoards(details: SessionDetail[], now: number): { board: MapBoard; tree: TreeSession[] } {
  const board: MapBoard = { entries: [], counts: {}, pushed: 0, faults: {}, agents: 0, model: null, core: "" }
  const tree: TreeSession[] = []
  const ordered = [...details].sort((a, b) => a.host.localeCompare(b.host) || a.startedAt - b.startedAt)
  for (const d of ordered) {
    const display = sessionDisplay(d, now)
    const b = buildBoard(d, null)
    tree.push({ id: d.id, number: d.number, label: sessionLabel(d), project: basename(d.cwd), host: d.host, status: display === "running" || display === "attention" ? display : "idle", agents: b.agents })
    const id = (x: string) => `${d.id}/${x}`
    const where = `${d.host} · ${sessionLabel(d)} · `
    board.entries.push(...b.entries.map((e) => ({ ...e, id: id(e.id), label: where + e.label, hub: d.id })))
    for (const [k, n] of Object.entries(b.counts)) board.counts[k as StationId] = (board.counts[k as StationId] ?? 0) + n
    for (const [k, n] of Object.entries(b.faults)) board.faults[k as StationId] = (board.faults[k as StationId] ?? 0) + n
    board.pushed += b.pushed
    board.agents += b.agents
  }
  board.entries.sort((a, b) => a.startedAt - b.startedAt)
  return { board, tree }
}

export function GlobalMap({ sessions, className }: { sessions: SessionSummary[]; className?: string }) {
  const dark = useDark()
  const localize = useLocalTimes()
  const now = useNow(1000)
  const c = paletteOf(dark)
  const [pinned, setPinned] = useState<StationId | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const details = useOpenDetails(sessions)

  if (sessions.length === 0) return <p className="py-2 text-sm text-muted-foreground">Aucune session ouverte.</p>

  const { board: raw, tree } = mergeBoards(details, now)
  const board: MapBoard = { ...raw, entries: localize(raw.entries, now, (e) => e.hub ?? "") }
  const svg = drawTree(board, tree, now, c, !reducedMotion(), pinned)
  const hosts = new Set(details.map((d) => d.host)).size

  const onMove = (e: React.MouseEvent) => {
    const target = e.target as Element
    const id = target.closest("[data-station]")?.getAttribute("data-station") as StationId | null
    const hub = target.closest("[data-hub]")?.getAttribute("data-hub")
    if (id) setTip({ kind: "station", id, x: e.clientX, y: e.clientY })
    else if (hub) setTip({ kind: "hub", id: hub, x: e.clientX, y: e.clientY })
    else setTip(null)
  }
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as Element
    const id = target.closest("[data-station]")?.getAttribute("data-station") as StationId | null
    if (id) setPinned((p) => (p === id ? null : id))
    const hub = target.closest("[data-hub]")?.getAttribute("data-hub")
    if (hub) go(hub)
  }

  return (
    <div className={`relative overflow-hidden rounded-xl ${className ?? "h-[520px]"}`} style={{ background: c.ground, color: c.ash }}>
      <div
        className="absolute inset-0 p-2 pt-12"
        role="img"
        aria-label={`Arbre du travail : toi, les sessions ouvertes et leurs outils. ${describeNow(board)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="pointer-events-none absolute top-3 left-3 rounded px-2 py-1 font-mono text-xs" style={{ background: c.raised, border: `1px solid ${c.line}`, color: c.dim }}>
        {details.length} session{details.length > 1 ? "s" : ""} · {hosts} machine{hosts > 1 ? "s" : ""}
      </div>

      <div className="pointer-events-none absolute top-3 right-3 flex max-w-[50%] flex-col items-end gap-2 font-mono text-xs">
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
            <HubTip board={board} id={tip.id} details={details} c={c} />
          )}
        </div>
      )}
    </div>
  )
}

// Fenêtre d'un cercle : le fil de cette session seule
function HubTip({ board, id, details, c }: { board: MapBoard; id: string; details: SessionDetail[]; c: ReturnType<typeof paletteOf> }) {
  const d = details.find((x) => x.id === id)
  if (!d) return null
  const where = `${d.host} · ${sessionLabel(d)} · `
  const own: MapBoard = { ...board, entries: board.entries.filter((e) => e.hub === id).map((e) => ({ ...e, label: e.label.slice(where.length) })), model: d.model }
  return (
    <>
      <SessionCard board={own} c={c} title={`${sessionLabel(d)} · ${d.host} · ${basename(d.cwd)}`} />
      <div className="font-mono text-[11px]" style={{ color: c.dim }}>
        clic : ouvrir la session
      </div>
    </>
  )
}
