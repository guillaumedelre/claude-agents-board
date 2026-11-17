import { type Entry, type MapBoard, type Palette, STATIONS, STATION_NAME, type StationId, describeNow, foldRows, shortModel, topLabels } from "./map"

const ICONS = Object.fromEntries(STATIONS.map((s) => [s.id, s.icon])) as Record<StationId, string>
const secs = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`)

// Fenêtre d'une station : icône, compte, appels en cours, cibles les plus fréquentes, erreurs
export function StationCard({ board, station, c, now }: { board: MapBoard; station: StationId; c: Palette; now: number }) {
  const own = board.entries.filter((e) => e.station === station)
  const running = own.filter((e) => e.status === "run")
  const errors = own.filter((e) => e.status === "err" || e.status === "block")
  const last = own.findLast((e) => e.status !== "run")
  const n = board.counts[station] ?? 0
  const line = (e: Entry) => (
    <div key={e.id} className="max-w-72 truncate">
      {e.label}
      {e.from === "agents" && <span style={{ color: c.dim }}> · sous-agent</span>}
    </div>
  )
  return (
    <div className="flex min-w-48 flex-col gap-1.5 rounded-md px-3 py-2 font-mono text-xs shadow-lg" style={{ background: c.raised, border: `1px solid ${c.line}`, color: c.ash }}>
      <div className="flex items-center gap-2" style={{ color: c.bone }}>
        <svg width="16" height="16" viewBox="-10 -10 20 20" aria-hidden="true">
          <path d={ICONS[station]} fill="none" stroke={running.length ? c.hot : c.bone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-semibold">{STATION_NAME[station]}</span>
        <span style={{ color: c.dim }}>
          {n} appel{n > 1 ? "s" : ""}
        </span>
      </div>
      {running.length > 0 && (
        <div style={{ color: c.hot }}>
          {running.slice(-3).map((e) => (
            <div key={e.id} className="max-w-72 truncate">
              ● {e.label} · {secs(now - e.startedAt)}
            </div>
          ))}
        </div>
      )}
      {!running.length && last && (
        <div>
          <span style={{ color: c.dim }}>dernier : </span>
          {last.label}
        </div>
      )}
      {topLabels(board.entries, station, 3).length > 0 && (
        <div>
          <div style={{ color: c.dim }}>le plus servi</div>
          {topLabels(board.entries, station, 3).map(([l, k]) => (
            <div key={l} className="max-w-72 truncate">
              {k > 1 ? `×${k} ` : ""}
              {l}
            </div>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div style={{ color: c.red }}>
          ✕ {errors.length} échec{errors.length > 1 ? "s" : ""} ou refus
          {line(errors.at(-1)!)}
        </div>
      )}
    </div>
  )
}

const took = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`)

const box = (c: Palette) => ({ background: c.raised, border: `1px solid ${c.line}`, color: c.ash })

// Fenêtre du centre : ce que faisait le fil, l'action en cours puis les dernières lignes
export function SessionCard({ board, c, title, max = 10 }: { board: MapBoard; c: Palette; title: string; max?: number }) {
  const rows = foldRows(board.entries, max)
  return (
    <div className="flex w-96 max-w-[80vw] flex-col gap-1.5 rounded-md px-3 py-2 font-mono text-xs shadow-lg" style={box(c)}>
      <div className="font-semibold" style={{ color: c.bone }}>
        {title}
        {board.model && <span style={{ color: c.dim }}> · {shortModel(board.model)}</span>}
      </div>
      <div style={{ color: c.bone }}>{describeNow(board)}</div>
      {rows.length === 0 ? (
        <div>Rien pour le moment.</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map(({ entry: e, times, tookMs }) => {
            const bad = e.status === "err" || e.status === "block"
            const hot = e.status === "run" || e.mark === "switch"
            const color = bad ? c.red : hot ? (e.station === "memory" ? c.mem : c.accent) : undefined
            return (
              <li key={e.id} className="grid grid-cols-[0.8rem_5.5rem_1fr] items-baseline gap-x-1.5" style={{ color }}>
                <span style={{ color: color ?? c.dim }}>{e.mark === "switch" ? "◆" : e.status === "run" ? "●" : bad ? "✕" : "·"}</span>
                <span>{STATION_NAME[e.station]}</span>
                <span className="min-w-0 truncate">
                  {e.label}
                  {e.from === "agents" && " · sous-agent"}
                  {times > 1 && <span className="ml-1.5">+{times - 1}</span>}
                  <span className="ml-2">{e.status === "run" ? "en cours" : tookMs > 0 ? took(tookMs) : ""}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
