// Galaxie : chaque session ouverte est un système solaire qui tourne autour de Toi, un bras par machine
import { useMemo, useRef } from "react"
import { LabelLayer } from "@/components/lotmap/clock"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Line, OrbitControls } from "@react-three/drei"
import { BlackHole, SkyDome, TwinkleStars } from "@/components/lotmap/bodies"
import { Glow } from "@/components/lotmap/glow"
import * as THREE from "three"
import { Label } from "@/components/lotmap/label"
import { Fit } from "@/components/lotmap/fit"
import { useLocalTimes } from "@/components/lotmap/hooks"
import { type Palette, type StationId, buildBoard } from "@/components/lotmap/map"
import { SYSTEM_R, isLight, seedOf, textStyle } from "@/components/lotmap/orbits"
import { SolarSystem } from "@/components/lotmap/solar"
import { basename, sessionLabel } from "@/lib/format"
import { sessionDisplay } from "@/lib/status"
import type { SessionDetail } from "@/lib/types"

// Les systèmes sont réduits dans la galaxie : leur détail se lit au zoom
const SCALE = 0.8
const ARM_START = 10
const ARM_STEP = 10
const ARM_TWIST = 0.55
const GALAXY_PERIOD = 8 * 60_000
const FLY_MS = 900
const TARGET = new THREE.Vector3(0, 0, 0)
// Vue d'ensemble en plongée à 35° au-dessus du plan de la galaxie
const VIEW = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(35)), Math.cos(THREE.MathUtils.degToRad(35)))

type Placed = { s: SessionDetail; at: THREE.Vector3 }

// Nom de la machine au bout de son bras, au-delà de sa dernière session
const armEnd = (arm: Arm) => {
  const n = Math.max(1, arm.systems.length)
  const r = ARM_START + (n - 1) * ARM_STEP + SYSTEM_R * SCALE + 1
  const a = arm.angle + (n - 1) * ARM_TWIST
  return new THREE.Vector3(Math.cos(a) * r, -0.4, Math.sin(a) * r)
}
type Arm = { host: string; angle: number; systems: Placed[] }


// Un bras de spirale par machine, les sessions de la plus ancienne (près de Toi) à la plus récente
function layout(sessions: SessionDetail[]) {
  const hosts = [...new Set(sessions.map((s) => s.host))].sort((a, b) => a.localeCompare(b))
  let outer = ARM_START
  const arms: Arm[] = hosts.map((host, i) => {
    const angle = (i / hosts.length) * 2 * Math.PI
    const own = sessions.filter((s) => s.host === host).sort((x, y) => x.startedAt - y.startedAt)
    return {
      host,
      angle,
      systems: own.map((s, j) => {
        const r = ARM_START + j * ARM_STEP
        outer = Math.max(outer, r)
        const a = angle + j * ARM_TWIST
        return { s, at: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r) }
      }),
    }
  })
  return { arms, radius: outer + SYSTEM_R * SCALE + 2 }
}

// Dernier choix de zoom : un système (id) ou le retour à la vue d'ensemble (id nul), daté pour relancer le vol
export type Focus = { id: string | null; start: number } | null

export type GalaxyProps = {
  sessions: SessionDetail[]
  now: number
  c: Palette
  motion: boolean
  focus: Focus
  onFocus: (id: string | null) => void
  bloom: boolean
  highlight: StationId | null
}

export default function GalaxyScene(props: GalaxyProps) {
  const layer = useRef<HTMLDivElement>(null)
  return (
    <div className="relative h-full w-full">
    <Canvas
      frameloop={props.motion ? "always" : "demand"}
      dpr={[1, 2]}
      camera={{ position: [0, 9, 11], fov: 45, near: 0.1, far: 400 }}
      fallback={<p className="p-4 text-sm">WebGL indisponible.</p>}
      onPointerMissed={() => props.focus?.id && props.onFocus(null)}
    >
      <LabelLayer.Provider value={layer}>
        <Scene {...props} />
      </LabelLayer.Provider>
    </Canvas>
    <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  )
}

function Scene({ sessions, now, c, motion, focus, onFocus, bloom, highlight }: GalaxyProps) {
  const { arms, radius } = useMemo(() => layout(sessions), [sessions])
  const spin = useRef<THREE.Group>(null)
  const systems = useRef(new Map<string, THREE.Group>())
  const home = useRef<THREE.Vector3 | null>(null)
  const zoomed = !!focus?.id
  const waiting = sessions.some((s) => sessionDisplay(s, now) === "attention")
  const light = isLight(c)

  // La galaxie tourne lentement autour de Toi, sauf pendant un zoom
  useFrame((_, delta) => {
    if (spin.current && motion && !zoomed) spin.current.rotation.y += (delta * 1000 * 2 * Math.PI) / GALAXY_PERIOD
  })

  return (
    <>
      <color attach="background" args={[c.ground]} />
      <fog attach="fog" args={[c.ground, radius * 2.2, radius * 5]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 10, 6]} intensity={0.5} />
      <SkyDome radius={300} c={c} light={light} />
      <TwinkleStars count={900} radius={160} color={light ? c.dim : c.ash} size={1.6} />
      <BlackHole radius={0.6} waiting={waiting} c={c} />
      <Label center position={[0, 1.4, 0]} zIndexRange={[12, 0]}>
        <div style={{ ...textStyle(c, waiting ? c.hot : c.bone, 13), letterSpacing: "0.12em" }}>TOI</div>
      </Label>
      <group ref={spin}>
        {arms.map((arm) => (
          <group key={arm.host}>
            <Line
              points={[new THREE.Vector3(Math.cos(arm.angle) * 2, 0, Math.sin(arm.angle) * 2), ...arm.systems.map((p) => p.at)]}
              color={c.line}
              lineWidth={1}
              dashed
              dashSize={0.3}
              gapSize={0.4}
              transparent
              opacity={0.7}
            />
            <Label center position={armEnd(arm)} zIndexRange={[5, 0]}>
              <div style={{ ...textStyle(c, c.dim, 11), letterSpacing: "0.14em", textTransform: "uppercase" }}>{arm.host}</div>
            </Label>
            {arm.systems.map((p) => (
              <group
                key={p.s.id}
                position={p.at}
                scale={SCALE}
                ref={(g) => {
                  if (g) systems.current.set(p.s.id, g)
                  else systems.current.delete(p.s.id)
                }}
              >
                <System s={p.s} at={p.at} now={now} c={c} motion={motion} focused={zoomed && focus?.id === p.s.id} highlight={highlight} onFocus={() => onFocus(p.s.id)} />
              </group>
            ))}
          </group>
        ))}
      </group>
      <OrbitControls makeDefault enableDamping minDistance={2} maxDistance={radius * 6} />
      <Fit radius={radius * 0.72} target={TARGET} view={VIEW} enabled={!zoomed} />
      {/* Sur fond clair, le halo délaverait tout : réservé au thème sombre */}
      {bloom && !light && <Glow />}
      {focus && (
        <Fly
          key={focus.start}
          id={focus.id}
          start={focus.start}
          systemAt={(id) => systems.current.get(id)?.getWorldPosition(new THREE.Vector3())}
          takeHome={(save) => {
            const h = home.current
            home.current = save ? (h ?? save) : null
            return h
          }}
        />
      )}
    </>
  )
}

function System({ s, at, now, c, motion, focused, highlight, onFocus }: { s: SessionDetail; at: THREE.Vector3; now: number; c: Palette; motion: boolean; focused: boolean; highlight: StationId | null; onFocus: () => void }) {
  const localize = useLocalTimes()
  const raw = buildBoard(s, null)
  const board = { ...raw, entries: localize(raw.entries, now) }
  board.switchedAt = board.entries.findLast((e) => e.mark === "switch")?.startedAt
  // Toi est le centre de la galaxie : dans le repère du système, à l'opposé de sa position
  const toi = useMemo(() => at.clone().negate().divideScalar(SCALE), [at])
  return (
    <SolarSystem
      board={board}
      c={c}
      motion={motion}
      now={now}
      phase={seedOf(s.id)}
      toi={toi}
      detailed={focused}
      title={`${sessionLabel(s)} · ${basename(s.cwd)}`}
      attention={sessionDisplay(s, now) === "attention"}
      onSun={focused ? undefined : onFocus}
      bodyScale={focused ? 1 : 2}
      highlight={highlight}
      cardInScene
    />
  )
}

// Vol de caméra vers un système (positions lues à la première image), ou retour au point de départ
// takeHome(position) retient le point de départ s'il n'y en a pas ; takeHome(null) le rend et l'oublie
function Fly({
  id,
  start,
  systemAt,
  takeHome,
}: {
  id: string | null
  start: number
  systemAt: (id: string) => THREE.Vector3 | undefined
  takeHome: (save: THREE.Vector3 | null) => THREE.Vector3 | null
}) {
  const { camera, controls } = useThree()
  const path = useRef<{ from: THREE.Vector3; fromTarget: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    if (!path.current) {
      const fromTarget = ctl?.target.clone() ?? new THREE.Vector3()
      const target = id ? systemAt(id) : undefined
      const back = id ? null : takeHome(null)
      if (target) {
        takeHome(camera.position.clone())
        path.current = { from: camera.position.clone(), fromTarget, to: target.clone().add(new THREE.Vector3(0, 6.5, 4.5)), target }
      } else if (back) {
        path.current = { from: camera.position.clone(), fromTarget, to: back, target: TARGET.clone() }
      } else {
        done.current = true
        return
      }
    }
    const p = path.current
    const f = Math.min(1, (performance.now() - start) / FLY_MS)
    const e = f * f * (3 - 2 * f)
    camera.position.lerpVectors(p.from, p.to, e)
    if (ctl) {
      ctl.target.lerpVectors(p.fromTarget, p.target, e)
      ctl.update()
    } else camera.lookAt(p.target)
    if (f >= 1) done.current = true
  })
  return null
}
