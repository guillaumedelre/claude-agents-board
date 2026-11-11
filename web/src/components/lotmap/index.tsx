import { Suspense, lazy, useEffect, useState } from "react"
import { useNow } from "@/hooks/use-board"
import { sessionDisplay } from "@/lib/status"
import type { SessionDetail } from "@/lib/types"
import { AgentCard, SessionCard, StationCard } from "./card"
import { typeColors } from "./colors"
import { reducedMotion, useDark, useLocalTimes } from "./hooks"
import { type MapBoard, type StationId, boardAt, buildBoard, countsFromUsage, describeNow, drawMap, paletteOf } from "./map"

const Map3D = lazy(() => import("./map3d"))

const MODE_KEY = "agents.mapMode"
const WEAR_KEY = "agents.mapWear"
const BLOOM_KEY = "agents.bloom"
const SPEEDS = [1, 5, 20, 60]

function useStored<T extends string | number>(key: string, fallback: T, valid: (v: string) => T | null) {
  const [value, setValue] = useState<T>(() => {
    try {
      return valid(localStorage.getItem(key) ?? "") ?? fallback
    } catch {
      return fallback
    }
  })
  const set = (v: T) => {
    setValue(v)
    try {
      localStorage.setItem(key, String(v))
    } catch {
      // stockage indisponible : le choix vaut pour la page
    }
  }
  return [value, set] as const
}


type Replay = { atStart: number; wallStart: number; speed: number; playing: boolean }
type Tip = { kind: "station"; id: StationId; x: number; y: number } | { kind: "core"; x: number; y: number } | { kind: "agent"; id: string; x: number; y: number }

const replayAt = (r: Replay, wall: number) => (r.playing ? r.atStart + (wall - r.wallStart) * r.speed : r.atStart)
const hhmmss = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

// Usure du projet sur 7 jours, demandée au serveur quand le choix est actif
function useProjectUsage(cwd: string | null, active: boolean) {
  const [usage, setUsage] = useState<{ cwd: string; counts: Record<string, number> } | null>(null)
  useEffect(() => {
    if (!active || !cwd) return
    let alive = true
    fetch(`/api/usage?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setUsage({ cwd, counts: d.counts ?? {} }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [cwd, active])
  return active && usage?.cwd === cwd ? usage.counts : null
}

export function LotMap({ session: s, agentId }: { session: SessionDetail; agentId: string | null }) {
  const dark = useDark()
  const localize = useLocalTimes()
  const [replay, setReplay] = useState<Replay | null>(null)
  const now = useNow(replay?.playing ? 200 : 1000)
  const c = paletteOf(dark)
  const motion = !reducedMotion()
  const [mode, setMode] = useStored<"2d" | "3d">(MODE_KEY, "2d", (v) => (v === "3d" || v === "2d" ? v : null))
  const [bloom, setBloom] = useStored<"on" | "off">(BLOOM_KEY, "off", (v) => (v === "on" || v === "off" ? v : null))
  const [wear, setWear] = useStored<"session" | "project">(WEAR_KEY, "session", (v) => (v === "project" || v === "session" ? v : null))
  // Station épinglée par un clic : sa fenêtre reste affichée
  const [pinned, setPinned] = useState<StationId | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const usage = useProjectUsage(s.cwd, wear === "project")

  const raw = buildBoard(s, agentId)
  const agent = agentId ? s.agents[agentId] : undefined
  const start = agent?.startedAt ?? s.startedAt
  const end = Math.max(agent?.endedAt ?? s.lastSeen, ...raw.entries.map((e) => e.endedAt ?? e.startedAt))
  // Relecture : horodatages du serveur et heure rejouée ; en direct : heures locales de réception
  const at = replay ? Math.min(end, Math.max(start, replayAt(replay, now))) : now
  let board: MapBoard
  if (replay) board = boardAt(raw, at)
  else {
    board = { ...raw, entries: localize(raw.entries, now) }
    board.switchedAt = board.entries.findLast((e) => e.mark === "switch")?.startedAt
  }
  const shownCounts = usage ? countsFromUsage(usage) : board.counts
  const drawn = usage ? { ...board, counts: shownCounts, pushed: 0 } : board

  // Arrivée au bout : la relecture s'arrête d'elle-même
  const playing = !!replay?.playing && at < end

  const svg = mode === "2d" ? drawMap(drawn, at, c, motion, pinned) : ""
  const choice = (active: boolean) => ({
    color: active ? c.ground : c.ash,
    background: active ? c.accent : c.raised,
    border: `1px solid ${active ? c.accent : c.line}`,
  })
  const seek = (t: number, patch: Partial<Replay> = {}) =>
    setReplay((r) => ({ speed: r?.speed ?? 5, playing: r?.playing ?? true, ...patch, atStart: t, wallStart: Date.now() }))
  const pick = (id: StationId) => setPinned((f) => (f === id ? null : id))
  const hoverStation = (id: StationId | null, x = 0, y = 0) => setTip(id ? { kind: "station", id, x, y } : null)
  const hoverCore = (x: number | null, y = 0) => setTip(x === null ? null : { kind: "core", x, y })
  const hoverAgent = (id: string | null, x = 0, y = 0) => setTip(id ? { kind: "agent", id, x, y } : null)
  const onSvgMove = (e: React.MouseEvent) => {
    const target = e.target as Element
    const id = target.closest("[data-station]")?.getAttribute("data-station") as StationId | null
    if (id) hoverStation(id, e.clientX, e.clientY)
    else if (target.closest("[data-core]")) hoverCore(e.clientX, e.clientY)
    else setTip(null)
  }
  const onSvgClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest("[data-station]")?.getAttribute("data-station") as StationId | null
    if (id) pick(id)
  }
  const clock = replay ? () => Math.min(end, Math.max(start, replayAt(replay, Date.now()))) : undefined
  const btn = "pointer-events-auto rounded px-2 py-0.5"
  const title = agent ? `#${agent.number} ${agent.type ?? "agent"}` : (s.name ?? `Session ${s.number}`)
  const colorOf = typeColors(board.crew)

  return (
    // La carte occupe tout le panneau ; réglages en surimpression, informations dans les fenêtres au survol
    <div className="relative h-full min-h-80 overflow-hidden rounded-xl" style={{ background: c.ground, color: c.ash }}>
      {mode === "3d" ? (
        <div className="absolute inset-0" aria-label={`Carte du travail en 3D. ${describeNow(board)}`}>
          <Suspense fallback={<p className="p-4 text-sm">Chargement de la 3D…</p>}>
            {/* Nouvelle scène à l'entrée et à la sortie de la relecture : les animations repartent de l'horloge choisie */}
            <Map3D
              key={replay ? "replay" : "live"}
              board={drawn}
              c={c}
              motion={motion}
              now={at}
              seedKey={agentId ?? s.id}
              attention={!agent && !replay && sessionDisplay(s, now) === "attention"}
              bloom={bloom === "on"}
              clock={clock}
              selected={pinned}
              onStation={hoverStation}
              onPick={pick}
              onCore={hoverCore}
              onAgent={hoverAgent}
            />
          </Suspense>
        </div>
      ) : (
        <div
          className="absolute inset-0 p-2 pt-12"
          role="img"
          aria-label={`Carte du travail. ${describeNow(board)}`}
          onMouseMove={onSvgMove}
          onMouseLeave={() => setTip(null)}
          onClick={onSvgClick}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      <div className="pointer-events-none absolute top-3 left-3 flex max-w-[60%] flex-col gap-1.5 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["2d", "3d"] as const).map((m) => (
            <button key={m} type="button" className={btn} style={choice(mode === m)} onClick={() => setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
          {mode === "3d" && dark && (
            <button
              type="button"
              className={btn}
              style={choice(bloom === "on")}
              onClick={() => setBloom(bloom === "on" ? "off" : "on")}
              title="Halo lumineux sur le soleil, les veines et le disque de Toi (thème sombre ; plus coûteux pour la carte graphique)"
            >
              halo
            </button>
          )}
          <span className="ml-1" style={{ color: c.dim }}>
            usure
          </span>
          <button type="button" className={btn} style={choice(wear === "session")} onClick={() => setWear("session")}>
            {agent ? "agent" : "session"}
          </button>
          <button type="button" className={btn} style={choice(wear === "project")} onClick={() => setWear("project")} title="Appels d'outils du projet sur 7 jours, toutes sessions">
            projet 7 j
          </button>
          {!replay && (
            <button type="button" className={`${btn} ml-1`} style={choice(false)} onClick={() => seek(start, { playing: true, speed: 5 })}>
              ▶ Relecture
            </button>
          )}
        </div>
        {replay && (
          <div className="pointer-events-auto flex w-[min(36rem,90vw)] flex-col gap-1 rounded-md px-2 py-1.5" style={{ background: c.raised, border: `1px solid ${c.line}` }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={btn} style={choice(false)} onClick={() => seek(start)} aria-label="Revenir au début">
                ⇤
              </button>
              <button
                type="button"
                className={btn}
                style={choice(playing)}
                onClick={() => seek(at >= end ? start : at, { playing: !playing })}
                aria-label={playing ? "Pause" : "Lecture"}
              >
                {playing ? "⏸" : "▶"}
              </button>
              {SPEEDS.map((v) => (
                <button key={v} type="button" className={btn} style={choice(replay.speed === v)} onClick={() => seek(at, { speed: v })}>
                  ×{v}
                </button>
              ))}
              <span style={{ color: c.bone }}>{hhmmss(at)}</span>
              <button type="button" className={`${btn} ml-auto`} style={choice(false)} onClick={() => setReplay(null)}>
                Direct
              </button>
            </div>
            <input
              type="range"
              min={start}
              max={end}
              step={100}
              value={at}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Instant rejoué"
              style={{ accentColor: c.accent }}
            />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute top-3 right-3 flex max-w-[38%] flex-col items-end gap-2 font-mono text-xs">
        <div className="max-w-full truncate rounded px-2 py-1" style={{ background: c.raised, border: `1px solid ${c.line}`, color: c.bone }} title={describeNow(board)}>
          {describeNow(board)}
        </div>
        {pinned && (
          <div className="pointer-events-auto flex flex-col items-end gap-1">
            <StationCard board={board} station={pinned} c={c} now={at} counts={usage ? shownCounts : undefined} />
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
              <StationCard board={board} station={tip.id} c={c} now={at} counts={usage ? shownCounts : undefined} />
              <div className="font-mono text-[11px]" style={{ color: c.dim }}>
                {pinned === tip.id ? "clic : détacher" : "clic : épingler"}
              </div>
            </>
          ) : tip.kind === "core" ? (
            <SessionCard board={board} c={c} title={title} />
          ) : (
            <AgentCard board={board} agentId={tip.id} c={c} now={at} color={colorOf(board.crew.find((m) => m.id === tip.id)?.type ?? "agent")} />
          )}
        </div>
      )}
    </div>
  )
}
