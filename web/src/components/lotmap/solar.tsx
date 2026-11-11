// Système solaire d'une session : Claude au centre, les stations en planètes sur des orbites lentes,
// les sous-agents en lunes de la planète Agents. Reprend les codes de la carte 2D (rayons usés, lueurs,
// aiguilles, trajet, impulsions, anneaux du centre). Toi est hors du système : la galaxie le place au centre.
import { useContext, useMemo, useRef, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { Billboard, Line } from "@react-three/drei"
import * as THREE from "three"
import { Label } from "./label"
import { ClockContext, shaderSeconds } from "./clock"
import { AgentRing, PlanetBody, SunBody } from "./bodies"
import { StationCard } from "./card"
import { Gauge } from "./gauge"
import { SUN_R, isLight, orbit, planetAt, textStyle } from "./orbits"
import { FLOW_FRAGMENT, FLOW_VERTEX, setPlanet } from "./shaders"
import { typeColors } from "./colors"
import {
  ALARM_MS,
  type CrewMember,
  DONE_MS,
  type Entry,
  GLOW_MS,
  type MapBoard,
  PLANETS,
  type Palette,
  PULSE_MS,
  RIPPLE_MS,
  STATIONS,
  STATION_NAME,
  type StationId,
  SWITCH_MS,
  routeOf,
  shortModel,
} from "./map"

const TRAVEL_MS = PULSE_MS + RIPPLE_MS
const ICONS = Object.fromEntries(STATIONS.map((s) => [s.id, s.icon])) as Record<StationId, string>

const MOON_R = 0.7
function moonAt(k: number, n: number, t: number, phase: number, out = new THREE.Vector3()) {
  planetAt("agents", t, phase, out)
  const a = (k / Math.max(1, n)) * 2 * Math.PI + t / 4000
  return out.add(new THREE.Vector3(Math.cos(a) * MOON_R, 0.12 * Math.sin(a * 2), Math.sin(a) * MOON_R))
}

const isBad = (e: Entry) => e.status === "err" || e.status === "block"
const tone = (e: Entry, c: Palette) => (isBad(e) ? c.red : e.station === "memory" ? c.mem : c.accent)
const wornOf = (board: MapBoard, id: StationId) => Math.min(1, Math.log2(1 + (board.counts[id] ?? 0)) / 7)
const planetR = (board: MapBoard, id: StationId) => 0.16 + 0.14 * wornOf(board, id)

type Life = { born: number; gone?: number }

// Heures d'arrivée et de départ des sous-agents sur l'horloge de la scène, pour les faire naître et s'éteindre
function useLives() {
  const lives = useRef<Map<string, Life> | null>(null)
  return (crew: CrewMember[], now: number) => {
    const first = lives.current === null
    const map = (lives.current ??= new Map())
    for (const m of crew) {
      const life = map.get(m.id)
      if (!life) map.set(m.id, { born: first ? -Infinity : now, gone: m.status === "running" ? undefined : first ? -Infinity : now })
      else if (m.status !== "running" && life.gone === undefined) life.gone = now
    }
    return map
  }
}

export type SolarProps = {
  board: MapBoard
  c: Palette
  motion: boolean
  now: number
  phase: number
  // Position de Toi dans le repère du système : prompts et demandes passent par là
  toi: THREE.Vector3
  detailed: boolean
  title?: string
  attention?: boolean
  selected?: StationId | null
  onStation?: (id: StationId | null, x?: number, y?: number) => void
  onPick?: (id: StationId) => void
  onSun?: () => void
  // Grossit soleil et planètes quand le système est vu de loin (galaxie)
  bodyScale?: number
  // Planètes mises en évidence par la légende
  highlight?: StationId | null
  // Fenêtre de survol dessinée dans la scène (galaxie) plutôt que par la page
  cardInScene?: boolean
  // Survol du soleil et des lunes (vue de session) : la page affiche la fenêtre correspondante
  onCore?: (x: number | null, y?: number) => void
  onAgent?: (id: string | null, x?: number, y?: number) => void
}

export function SolarSystem(props: SolarProps) {
  const { board, c, now, phase, detailed } = props
  const recent = board.entries.slice(-60)
  const map = useLives()(board.crew, now)
  const moons = board.crew.filter((m) => {
    const gone = map.get(m.id)?.gone
    return gone === undefined || now - gone < 2000
  })
  const moonIndex = new Map(moons.map((m, k) => [m.id, k]))
  const colorOf = typeColors(board.crew)
  return (
    <group>
      <Orbits c={c} />
      <Links {...props} />
      <Trail entries={recent} c={c} phase={phase} toi={props.toi} withToi={detailed} />
      {PLANETS.map((id) => (
        <Planet key={id} {...props} id={id as Exclude<StationId, "you">} entries={recent} />
      ))}
      <Sun {...props} />
      {moons.map((m) => (
        <Moon key={m.id} m={m} k={moonIndex.get(m.id)!} n={moons.length} life={map.get(m.id)!} color={colorOf(m.type)} c={c} phase={phase} detailed={detailed} onAgent={props.onAgent} />
      ))}
      {props.motion && <Pulses entries={recent} c={c} phase={phase} toi={props.toi} moonIndex={moonIndex} moons={moons.length} />}
      <ToiLink {...props} />
    </group>
  )
}

// Orbites en pointillés, comme les contours de la carte 2D
const ORBIT_POINTS = Array.from({ length: 97 }, (_, i) => [Math.cos((i / 96) * 2 * Math.PI), Math.sin((i / 96) * 2 * Math.PI)] as const)

function Orbits({ c }: { c: Palette }) {
  return (
    <>
      {PLANETS.map((id) => {
        const r = orbit(id)
        return <Line key={id} points={ORBIT_POINTS.map(([x, z]) => new THREE.Vector3(x * r, 0, z * r))} color={c.line} lineWidth={0.8} dashed dashSize={0.08} gapSize={0.14} transparent opacity={0.55} />
      })}
    </>
  )
}

// Liaisons soleil-planète en faisceaux de particules qui avancent du soleil vers la planète.
// L'usure règle la densité et l'épaisseur, l'activité la vitesse et l'éclat.
const FLOW_MIN = 14
// Dans la vue de session, le soleil est plus gros : sa surface (et sa pluie de caractères) se lit
const sunScale = (detailed: boolean, bodyScale: number) => (detailed && bodyScale === 1 ? 2.2 : bodyScale)
const FLOW_MAX = 90

function Links(props: SolarProps) {
  return (
    <>
      {PLANETS.map((id) => (
        <FlowLink key={id} {...props} id={id} />
      ))}
    </>
  )
}

function FlowLink({ id, board, c, phase, detailed, bodyScale = 1 }: SolarProps & { id: StationId }) {
  const clock = useContext(ClockContext)
  const points = useRef<THREE.Points>(null)
  const progress = useRef(0)
  const worn = wornOf(board, id)
  const light = isLight(c)
  const count = Math.round(FLOW_MIN + (FLOW_MAX - FLOW_MIN) * worn)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    let x = 4242 + count * 7 + PLANETS.indexOf(id) * 131
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647
    const along: number[] = []
    const angle: number[] = []
    const spread: number[] = []
    for (let i = 0; i < count; i++) {
      along.push(i / count + rnd() / count)
      angle.push(rnd() * Math.PI * 2)
      spread.push(Math.sqrt(rnd()))
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute("along", new THREE.Float32BufferAttribute(along, 1))
    g.setAttribute("angle", new THREE.Float32BufferAttribute(angle, 1))
    g.setAttribute("spread", new THREE.Float32BufferAttribute(spread, 1))
    return g
  }, [count, id])
  const uniforms = useMemo(
    () => ({
      from: { value: new THREE.Vector3() },
      to: { value: new THREE.Vector3() },
      time: { value: 0 },
      speed: { value: 1 },
      radius: { value: 0.012 + 0.05 * worn },
      size: { value: 0.55 },
      color: { value: new THREE.Color() },
      intensity: { value: 0.3 },
      light: { value: light ? 1 : 0 },
      density: { value: Math.min(1, Math.sqrt(FLOW_MIN / count) * 1.2) },
    }),
    [worn, light, count],
  )
  const own = board.entries.filter((e) => e.station === id)
  const running = own.some((e) => e.status === "run")
  const main = id === "memory" ? c.mem : c.accent
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    const pts = points.current
    if (!pts) return
    const t = clock()
    const latest = own.at(-1)
    const since = latest ? t - (latest.endedAt ?? latest.startedAt) : Infinity
    const activity = running ? 1 : Math.max(0, 1 - since / (GLOW_MS * 2))
    // Progression cumulée : changer de vitesse ne fait pas sauter les grains
    progress.current += Math.min(delta, 0.1) * (0.04 + 0.4 * activity)
    planetAt(id, t, phase, p)
    const dir = p.clone().normalize()
    const u = (pts.material as THREE.ShaderMaterial).uniforms
    u.from.value.copy(dir).multiplyScalar(SUN_R * sunScale(detailed, bodyScale) * 1.2)
    u.to.value.copy(p).addScaledVector(dir, -planetR(board, id) * bodyScale)
    u.time.value = progress.current
    // Vu de loin (galaxie), les faisceaux restent discrets
    u.intensity.value = ((worn > 0 ? 0.35 : 0.15) + 0.9 * activity) * (detailed ? 1 : 0.5)
    u.color.value.set(activity > 0.6 ? c.hot : worn > 0 || activity > 0 ? main : c.dim)
  })
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        args={[
          {
            uniforms,
            vertexShader: FLOW_VERTEX,
            fragmentShader: FLOW_FRAGMENT,
            transparent: true,
            depthWrite: false,
            blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
          },
        ]}
      />
    </points>
  )
}

// Dernières planètes visitées par le fil principal, reliées par des arcs qui suivent les orbites.
// Un seul jeu de segments ; le plus ancien arc est le plus proche du fond, le plus récent le plus clair.
const LEGS = 6
const LEG_POINTS = 16
const TRAIL_VERTS = LEGS * LEG_POINTS * 2

function Trail({ entries, c, phase, toi, withToi }: { entries: Entry[]; c: Palette; phase: number; toi: THREE.Vector3; withToi: boolean }) {
  const clock = useContext(ClockContext)
  // Dans la galaxie, Toi est loin : les allers-retours vers lui traverseraient tout l'univers
  const stops = withToi ? routeOf(entries) : routeOf(entries.filter((e) => e.station !== "you"))
  const segs = useRef<THREE.LineSegments>(null)
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  const ground = useMemo(() => new THREE.Color(c.ground), [c.ground])
  const bone = useMemo(() => new THREE.Color(c.bone), [c.bone])
  useFrame(() => {
    const g = segs.current?.geometry
    if (!g) return
    const pos = g.getAttribute("position") as THREE.BufferAttribute
    const col = g.getAttribute("color") as THREE.BufferAttribute
    const t = clock()
    const legs = stops.length - 1
    let v = 0
    for (let k = 0; k < legs && k < LEGS; k++) {
      const from = stops[k]
      const to = stops[k + 1]
      if (from.station === "you") a.copy(toi)
      else planetAt(from.station, t, phase, a)
      if (to.station === "you") b.copy(toi)
      else planetAt(to.station, t, phase, b)
      const mid = a.clone().add(b).multiplyScalar(0.275)
      mid.y = 0.25
      const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(LEG_POINTS)
      const shade = ground.clone().lerp(bone, 0.15 + (0.55 * (k + 1)) / legs)
      for (let i = 0; i < LEG_POINTS; i++) {
        for (const p of [pts[i], pts[i + 1]]) {
          pos.setXYZ(v, p.x, p.y, p.z)
          col.setXYZ(v, shade.r, shade.g, shade.b)
          v++
        }
      }
    }
    g.setDrawRange(0, v)
    pos.needsUpdate = true
    col.needsUpdate = true
  })
  return (
    <lineSegments ref={segs} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(TRAIL_VERTS * 3), 3]} />
        <bufferAttribute attach="attributes-color" args={[new Float32Array(TRAIL_VERTS * 3), 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  )
}

// Vitesse de rotation propre des planètes (tours par seconde, en radians)
const SPIN: Record<StationId, number> = { model: 0.5, memory: 0.18, files: 0.25, shell: 0.3, web: 0.4, browser: 0.22, skills: 0.35, hooks: 0.2, agents: 0.3, you: 0 }
// Badges d'icône : visibles quand la caméra s'approche (distance en unités de la scène, avec hystérésis)
const NEAR_IN = 14
const NEAR_OUT = 16
const FADE_IN = { animation: "lotmap-fade 300ms ease-out" }

function Planet({
  id,
  board,
  entries,
  c,
  now,
  phase,
  detailed,
  selected,
  highlight,
  onStation,
  onPick,
  bodyScale = 1,
  cardInScene,
}: SolarProps & { id: Exclude<StationId, "you">; entries: Entry[] }) {
  const clock = useContext(ClockContext)
  const { camera } = useThree()
  const group = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshBasicMaterial>(null)
  const body = useRef<THREE.Mesh>(null)
  const pulse = useRef<THREE.Mesh>(null)
  const inner = useRef<THREE.Mesh>(null)
  const outer = useRef<THREE.Mesh>(null)
  const nearRef = useRef(false)
  const sunAt = useMemo(() => new THREE.Vector3(), [])
  const here = useMemo(() => new THREE.Vector3(), [])
  const own = entries.filter((e) => e.station === id)
  const running = own.filter((e) => e.status === "run")
  const main = id === "memory" ? c.mem : c.accent
  const r = planetR(board, id)
  const count = board.counts[id] ?? 0
  const faults = board.faults[id] ?? 0
  const [hover, setHover] = useState(false)
  const [near, setNear] = useState(false)
  const light = isLight(c)

  useFrame(() => {
    const t = clock()
    const g = group.current
    if (g) planetAt(id, t, phase, g.position)
    const latest = own.at(-1)
    const since = latest ? t - (latest.endedAt ?? latest.startedAt) : Infinity
    const alarm = own.filter(isBad).pop()
    const alarmAge = alarm ? t - (alarm.endedAt ?? alarm.startedAt) : Infinity
    const isAlarm = alarmAge < ALARM_MS
    const lit = running.length > 0 ? 1 : Math.max(0, 1 - since / GLOW_MS)
    const heat = isAlarm ? 1 - alarmAge / ALARM_MS : lit
    if (glow.current) {
      glow.current.color.set(isAlarm ? c.red : main)
      glow.current.opacity = 0.22 * heat
    }
    if (body.current && g?.parent) {
      setPlanet(body.current, { time: shaderSeconds(t), heat: lit, alarm: isAlarm ? 1 - alarmAge / ALARM_MS : 0, worn: wornOf(board, id), sun: g.parent.getWorldPosition(sunAt) })
      body.current.rotation.y = shaderSeconds(t) * SPIN[id]
    }
    if (pulse.current) {
      const f = (t % 1400) / 1400
      pulse.current.visible = running.length > 0
      pulse.current.scale.setScalar(1 + f * 1.4)
      ;(pulse.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - f)
    }
    // Jauges comme en 2D : l'intérieure se remplit en une minute et recommence, l'extérieure une fois en dix
    if (running.length > 0) {
      const elapsed = Math.max(0, t - Math.min(...running.map((e) => e.startedAt)))
      if (inner.current) (inner.current.material as THREE.ShaderMaterial).uniforms.progress.value = (elapsed % 60_000) / 60_000
      if (outer.current) (outer.current.material as THREE.ShaderMaterial).uniforms.progress.value = Math.min(1, elapsed / 600_000)
    }
    if (g && !detailed) {
      const d = g.getWorldPosition(here).distanceTo(camera.position)
      const next = nearRef.current ? d < NEAR_OUT : d < NEAR_IN
      if (next !== nearRef.current) {
        nearRef.current = next
        setNear(next)
      }
    }
  })

  const glyph = running.length > 0 ? c.hot : faults > 0 ? c.red : id === "memory" && count > 0 ? c.mem : c.ash
  const marked = selected === id || highlight === id
  return (
    <group ref={group}>
      <group scale={bodyScale}>
        <Billboard>
          <mesh>
            <circleGeometry args={[r + 0.22, 32]} />
            <meshBasicMaterial ref={glow} transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh ref={pulse} visible={false}>
            <ringGeometry args={[r + 0.02, r + 0.045, 40]} />
            <meshBasicMaterial color={main} transparent depthWrite={false} />
          </mesh>
          {(marked || hover) && (
            <mesh>
              <ringGeometry args={[r + 0.22, r + 0.24, 40]} />
              <meshBasicMaterial color={c.bone} transparent opacity={marked ? 1 : 0.5} />
            </mesh>
          )}
          {running.length > 0 && (
            <>
              <Gauge ref={inner} radius={r + 0.085} width={0.032} color={c.hot} />
              <Gauge ref={outer} radius={r + 0.16} width={0.018} color={c.hot} />
            </>
          )}
        </Billboard>
        <PlanetBody
          ref={body}
          id={id}
          radius={r}
          light={light}
          onPointerMove={(e) => {
            if (!detailed) return
            e.stopPropagation()
            setHover(true)
            onStation?.(id, e.nativeEvent.clientX, e.nativeEvent.clientY)
            document.body.style.cursor = "pointer"
          }}
          onPointerOut={() => {
            if (!detailed) return
            setHover(false)
            onStation?.(null)
            document.body.style.cursor = ""
          }}
          onClick={(e) => {
            if (!detailed) return
            e.stopPropagation()
            onPick?.(id)
          }}
        />
        {/* Taille réelle constante : agrandi avec la planète, l'anneau écraserait le système vu de loin */}
        {id === "agents" && <AgentRing inner={r * 1.5} outer={Math.max(r * 1.8, (MOON_R + 0.12) / bodyScale)} color={light ? "#8b7a5c" : "#d9c7a0"} />}
        {(detailed || near) && (
          <Label center position={[0, r + 0.3, 0]} zIndexRange={[10, 0]}>
            <div
              className="flex size-5 items-center justify-center rounded-full"
              style={{ ...FADE_IN, background: c.raised, border: `1px solid ${marked ? c.bone : c.line}`, pointerEvents: "none" }}
            >
              <svg width="12" height="12" viewBox="-10 -10 20 20" aria-hidden="true">
                <path d={ICONS[id]} fill="none" stroke={glyph} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </Label>
        )}
        {detailed && (
          <Label center position={[0, -r - 0.2, 0]} zIndexRange={[10, 0]}>
            <div style={{ ...textStyle(c, running.length > 0 || hover ? c.bone : c.ash, 11), textAlign: "center", lineHeight: 1.2 }}>
              {STATION_NAME[id]}
              {(count > 0 || running.length > 1 || faults > 0) && (
                <div style={{ fontSize: 9.5, color: c.dim }}>
                  {count > 0 && (id === "memory" && board.pushed > 0 ? `${count - board.pushed} ↓${board.pushed}` : count)}
                  {running.length > 1 && <span style={{ color: c.hot }}> ×{running.length}</span>}
                  {faults > 0 && <span style={{ color: c.red }}> ●{faults}</span>}
                </div>
              )}
            </div>
          </Label>
        )}
        {cardInScene && hover && (
          <Label position={[r + 0.3, 0, 0]} style={{ transform: "translate(12px, -50%)" }} zIndexRange={[30, 0]}>
            <div style={{ pointerEvents: "none" }}>
              <StationCard board={board} station={id} c={c} now={now} />
            </div>
          </Label>
        )}
      </group>
    </group>
  )
}

function Sun({ board, c, motion, detailed, title, attention, onSun, onCore, bodyScale = 1 }: SolarProps) {
  const scale = sunScale(detailed, bodyScale)
  const clock = useContext(ClockContext)
  const done = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const running = board.entries.some((e) => e.status === "run")
  const lastDone = board.entries.findLast((e) => e.mark === "done")
  const [hover, setHover] = useState(false)
  useFrame(() => {
    const t = clock()
    // La réponse quitte le soleil en un large anneau
    if (done.current) {
      const age = lastDone ? t - lastDone.startedAt : Infinity
      done.current.visible = motion && age >= 0 && age < DONE_MS
      if (done.current.visible) {
        const f = age / DONE_MS
        done.current.scale.setScalar(1 + f * 2)
        ;(done.current.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - f)
      }
    }
    // Un changement de modèle fait sonner le soleil quelques secondes
    if (ring.current) {
      const age = board.switchedAt === undefined ? Infinity : t - board.switchedAt
      ring.current.visible = motion && age >= 0 && age < SWITCH_MS
      if (ring.current.visible) {
        const f = (age % 1600) / 1600
        ring.current.scale.setScalar(1 + f)
        ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - f)
      }
    }
  })
  const model = shortModel(board.model)
  return (
    <group
      scale={scale}
      onPointerOver={(e) => {
        if (!onSun) return
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = "pointer"
      }}
      onPointerMove={(e) => {
        if (!onCore) return
        e.stopPropagation()
        onCore(e.nativeEvent.clientX, e.nativeEvent.clientY)
      }}
      onPointerOut={() => {
        onCore?.(null)
        if (!onSun) return
        setHover(false)
        document.body.style.cursor = ""
      }}
      onClick={(e) => {
        if (!onSun) return
        e.stopPropagation()
        document.body.style.cursor = ""
        onSun()
      }}
    >
      {onSun && (
        // Zone de clic plus large que le soleil, invisible
        <mesh>
          <sphereGeometry args={[SUN_R * 2.6, 16, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <group scale={hover ? 1.12 : 1}>
        <SunBody radius={SUN_R} activity={running ? 1 : 0.15} attention={!!attention} brightness={detailed ? 1 : 0.32} c={c} />
      </group>
      <Billboard>
        <mesh ref={done} visible={false}>
          <ringGeometry args={[SUN_R + 0.02, SUN_R + 0.06, 64]} />
          <meshBasicMaterial color={c.bone} transparent depthWrite={false} />
        </mesh>
        <mesh ref={ring} visible={false}>
          <ringGeometry args={[SUN_R + 0.08, SUN_R + 0.11, 64]} />
          <meshBasicMaterial color={c.bone} transparent depthWrite={false} />
        </mesh>
      </Billboard>
      <Label center position={[0, SUN_R * 1.6 + 0.25, 0]} zIndexRange={[12, 0]}>
        <div
          style={{
            ...textStyle(c, c.bone, detailed ? 13 : 11),
            textAlign: "center",
            lineHeight: 1.2,
            letterSpacing: detailed ? "0.12em" : 0,
            ...(onSun && { pointerEvents: "auto", cursor: "pointer" }),
          }}
          onClick={onSun}
        >
          {title ?? board.core}
          {(detailed || hover) && model && <div style={{ fontSize: 9.5, letterSpacing: 0, color: c.ash }}>{model}</div>}
        </div>
      </Label>
    </group>
  )
}

// Traînée des lunes : leurs dernières positions sur l'orbite, du plus vif au fond
const TRAIL_STEPS = 14
const TRAIL_MS = 110

function Moon({
  m,
  k,
  n,
  life,
  color,
  c,
  phase,
  detailed,
  onAgent,
}: {
  m: CrewMember
  k: number
  n: number
  life: Life
  color: string
  c: Palette
  phase: number
  detailed: boolean
  onAgent?: SolarProps["onAgent"]
}) {
  const clock = useContext(ClockContext)
  const group = useRef<THREE.Group>(null)
  const trail = useRef<THREE.LineSegments>(null)
  const head = useMemo(() => new THREE.Color(color), [color])
  const tail = useMemo(() => new THREE.Color(c.ground), [c.ground])
  const p = useMemo(() => new THREE.Vector3(), [])
  const size = 0.06 * (1 + (m.tokens ? Math.min(1.2, Math.log10(1 + m.tokens / 1000) / 2) : 0))
  useFrame(() => {
    const t = clock()
    const g = group.current
    if (!g) return
    moonAt(k, n, t, phase, g.position)
    // Naissance en grandissant, fin en s'éteignant
    const grow = life.born === -Infinity ? 1 : Math.min(1, Math.max(0, (t - life.born) / 600))
    const fade = life.gone === undefined || life.gone === -Infinity ? 1 : Math.max(0, 1 - (t - life.gone) / 1400)
    const s = Math.max(0.001, grow * (life.gone === -Infinity ? 0.001 : fade))
    g.scale.setScalar(s)
    const geo = trail.current?.geometry
    if (!geo) return
    const pos = geo.getAttribute("position") as THREE.BufferAttribute
    const col = geo.getAttribute("color") as THREE.BufferAttribute
    let v = 0
    for (let i = 0; i < TRAIL_STEPS; i++) {
      for (const j of [i, i + 1]) {
        moonAt(k, n, t - j * TRAIL_MS, phase, p)
        pos.setXYZ(v, p.x, p.y, p.z)
        const shade = head.clone().lerp(tail, Math.min(1, j / TRAIL_STEPS + (1 - s)))
        col.setXYZ(v, shade.r, shade.g, shade.b)
        v++
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
  })
  return (
    <>
      <lineSegments ref={trail} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(TRAIL_STEPS * 2 * 3), 3]} />
          <bufferAttribute attach="attributes-color" args={[new Float32Array(TRAIL_STEPS * 2 * 3), 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>
      <group ref={group}>
        <mesh
          onPointerMove={(e) => {
            if (!onAgent) return
            e.stopPropagation()
            onAgent(m.id, e.nativeEvent.clientX, e.nativeEvent.clientY)
            document.body.style.cursor = "pointer"
          }}
          onPointerOut={() => {
            if (!onAgent) return
            onAgent(null)
            document.body.style.cursor = ""
          }}
        >
          <sphereGeometry args={[size * (onAgent ? 1.6 : 1), 18, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={m.status === "running" ? 0.7 : 0.15} roughness={0.3} />
        </mesh>
        {detailed && (
          <Label center position={[0, -size - 0.12, 0]} zIndexRange={[9, 0]}>
            <div style={{ ...textStyle(c, c.ash, 9.5), textAlign: "center" }}>
              <span style={{ color }}>#{m.number}</span>
            </div>
          </Label>
        )}
      </group>
    </>
  )
}

// Impulsions : du soleil (ou d'une lune) vers la planète, retour à la fin, entrée creuse pour un signal reçu
const POOL = 24

function Pulses({ entries, c, phase, toi, moonIndex, moons }: { entries: Entry[]; c: Palette; phase: number; toi: THREE.Vector3; moonIndex: Map<string, number>; moons: number }) {
  const clock = useContext(ClockContext)
  const meshes = useRef<(THREE.Mesh | null)[]>([])
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  const flights = useMemo(() => {
    const out: { e: Entry; at: number; back: boolean; color: string; size: number; hollow: boolean }[] = []
    for (const e of entries) {
      if (e.from === "agents" && e.station === "agents") continue
      out.push({ e, at: e.startedAt, back: e.from === "inbound", color: e.status === "block" ? c.red : e.from === "inbound" ? tone(e, c) : e.station === "memory" ? c.memHot : c.hot, size: 0.05, hollow: e.from === "inbound" })
      if (e.endedAt !== undefined && e.from !== "inbound" && e.mark === undefined) out.push({ e, at: e.endedAt, back: true, color: e.status === "ok" ? c.ash : c.red, size: 0.035, hollow: false })
    }
    return out
  }, [entries, c])
  useFrame(() => {
    const t = clock()
    const live = flights.filter((f) => t - f.at >= 0 && t - f.at < TRAVEL_MS).slice(-POOL)
    meshes.current.forEach((m, i) => {
      if (!m) return
      const f = live[i]
      m.visible = !!f
      if (!f) return
      // Départ : le soleil, ou la lune du sous-agent ; arrivée : la planète, ou Toi
      const k = f.e.agentId !== undefined ? moonIndex.get(f.e.agentId) : undefined
      if (f.e.from === "agents") {
        if (k !== undefined) moonAt(k, moons, t, phase, a)
        else planetAt("agents", t, phase, a)
      } else a.set(0, 0, 0)
      if (f.e.station === "you") b.copy(toi)
      else planetAt(f.e.station, t, phase, b)
      const p = Math.min(1, (t - f.at) / PULSE_MS)
      if (f.back) m.position.lerpVectors(b, a, p)
      else m.position.lerpVectors(a, b, p)
      m.scale.setScalar(f.size)
      const mat = m.material as THREE.MeshBasicMaterial
      mat.color.set(f.color)
      mat.wireframe = f.hollow
      mat.opacity = p < 1 ? 1 : Math.max(0, 1 - (t - f.at - PULSE_MS) / RIPPLE_MS)
    })
  })
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)} visible={false}>
          <sphereGeometry args={[1, 10, 6]} />
          <meshBasicMaterial transparent />
        </mesh>
      ))}
    </>
  )
}

// Lien vers Toi : un fil discret, qui bat en ambre quand la session t'attend
function ToiLink({ c, toi, attention, motion }: SolarProps) {
  const clock = useContext(ClockContext)
  const mat = useRef<THREE.LineBasicMaterial>(null)
  const points = useMemo(() => new Float32Array([...toi.clone().setLength(SUN_R + 0.05).toArray(), ...toi.toArray()]), [toi])
  useFrame(() => {
    const m = mat.current
    if (!m) return
    if (!attention) {
      m.color.set(c.line)
      m.opacity = 0.35
      return
    }
    const w = motion ? (Math.sin(((clock() % 1100) / 1100) * 2 * Math.PI) + 1) / 2 : 1
    m.color.set(c.hot)
    m.opacity = 0.35 + 0.6 * w
  })
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial ref={mat} transparent />
    </lineSegments>
  )
}
