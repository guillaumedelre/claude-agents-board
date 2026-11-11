import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { reducedMotion, useDark } from "@/components/lotmap/hooks"
import { Legend } from "@/components/lotmap/legend"
import { type StationId, paletteOf } from "@/components/lotmap/map"
import { go } from "@/hooks/use-board"
import { basename, sessionLabel } from "@/lib/format"
import type { SessionDetail, SessionSummary } from "@/lib/types"
import type { Focus } from "./scene"

const GalaxyScene = lazy(() => import("./scene"))
const REFRESH_MS = 1000

// Ouvre la session sur sa carte en 3D
function open(id: string) {
  try {
    localStorage.setItem("agents.detailView", "map")
    localStorage.setItem("agents.mapMode", "3d")
  } catch {
    // stockage indisponible : la session s'ouvre sur sa vue habituelle
  }
  go(id)
}

// Derniers événements des sessions ouvertes, rechargés au plus une fois par seconde quand le tableau change
function useGalaxy(sessions: SessionSummary[]) {
  const [details, setDetails] = useState<SessionDetail[]>([])
  const last = useRef(0)
  const key = sessions.map((s) => `${s.id}:${s.lastSeen}:${s.status}`).join()
  useEffect(() => {
    let alive = true
    const timer = setTimeout(
      () => {
        last.current = Date.now()
        fetch("/api/galaxy")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => alive && d && setDetails(d.sessions ?? []))
          .catch(() => {})
      },
      Math.max(0, REFRESH_MS - (Date.now() - last.current)),
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key])
  const ids = new Set(sessions.map((s) => s.id))
  return details.filter((d) => ids.has(d.id))
}

const BLOOM_KEY = "agents.bloom"

function readBloom() {
  try {
    return localStorage.getItem(BLOOM_KEY) === "on"
  } catch {
    return false
  }
}

export function Galaxy({ sessions, now, className }: { sessions: SessionSummary[]; now: number; className?: string }) {
  const dark = useDark()
  const c = paletteOf(dark)
  const [bloom, setBloom] = useState(readBloom)
  const [highlight, setHighlight] = useState<StationId | null>(null)
  const toggleBloom = () => {
    setBloom(!bloom)
    try {
      localStorage.setItem(BLOOM_KEY, bloom ? "off" : "on")
    } catch {
      // stockage indisponible : le choix vaut pour la page
    }
  }
  const details = useGalaxy(sessions)
  const [focus, setFocus] = useState<Focus>(null)
  const onFocus = (id: string | null) => setFocus({ id, start: performance.now() })
  const focused = focus?.id ? sessions.find((s) => s.id === focus.id) : undefined

  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      setFocus({ id: null, start: performance.now() })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [focused])

  if (sessions.length === 0) return <p className="py-2 text-sm text-muted-foreground">Aucune session ouverte.</p>
  const btn = { color: c.bone, background: c.raised, border: `1px solid ${c.line}` }
  return (
    <div className={`relative overflow-hidden rounded-lg ${className ?? "h-[520px]"}`} style={{ background: c.ground }}>
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Chargement de la galaxie…</p>}>
        {details.length > 0 && <GalaxyScene sessions={details} now={now} c={c} motion={!reducedMotion()} focus={focus} onFocus={onFocus} bloom={bloom} highlight={highlight} />}
      </Suspense>
      {dark && (
        <button
          type="button"
          className="absolute top-3 left-3 rounded px-2 py-1 font-mono text-xs"
          style={bloom ? { ...btn, background: c.accent, color: c.ground, borderColor: c.accent } : btn}
          onClick={toggleBloom}
          title="Halo lumineux sur les soleils, les veines et le disque de Toi (plus coûteux pour la carte graphique)"
        >
          halo
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2">
        <Legend c={c} active={highlight} onActive={setHighlight} />
      </div>
      {focused && (
        <div className="absolute top-3 right-3 flex flex-wrap items-center justify-end gap-2 font-mono text-xs">
          <span style={{ color: c.bone }}>
            {sessionLabel(focused)} · {basename(focused.cwd)}
          </span>
          <button type="button" className="rounded px-2 py-1" style={{ ...btn, background: c.accent, color: c.ground, borderColor: c.accent }} onClick={() => open(focused.id)}>
            Ouvrir la session
          </button>
          <button type="button" className="rounded px-2 py-1" style={btn} onClick={() => setFocus({ id: null, start: performance.now() })}>
            Vue d'ensemble
          </button>
        </div>
      )}
    </div>
  )
}
