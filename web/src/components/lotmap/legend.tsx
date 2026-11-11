import { PLANETS, type Palette, STATIONS, type StationId } from "./map"

const ICONS = Object.fromEntries(STATIONS.map((s) => [s.id, s.icon])) as Record<StationId, string>
const NAMES = Object.fromEntries(STATIONS.map((s) => [s.id, s.name])) as Record<StationId, string>

// Légende des planètes sous la scène : le survol d'une entrée met ces planètes en évidence
export function Legend({ c, active, onActive }: { c: Palette; active: StationId | null; onActive: (id: StationId | null) => void }) {
  return (
    <div className="pointer-events-auto flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[11px]" onMouseLeave={() => onActive(null)}>
      {PLANETS.map((id) => (
        <button
          key={id}
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5"
          style={{ color: active === id ? c.bone : c.dim, background: active === id ? c.raised : "transparent" }}
          onMouseEnter={() => onActive(id)}
          onFocus={() => onActive(id)}
          onBlur={() => onActive(null)}
        >
          <svg width="12" height="12" viewBox="-10 -10 20 20" aria-hidden="true">
            <path d={ICONS[id]} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {NAMES[id]}
        </button>
      ))}
    </div>
  )
}
