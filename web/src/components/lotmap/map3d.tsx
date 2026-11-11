// Carte du travail en 3D : la session en système solaire, Toi posé devant en petit trou noir
import { useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { BlackHole, SkyDome, TwinkleStars } from "./bodies"
import { ClockContext, LabelLayer } from "./clock"
import { Fit } from "./fit"
import { Glow } from "./glow"
import { Label } from "./label"
import { Legend } from "./legend"
import { type MapBoard, type Palette, type StationId } from "./map"
import { SYSTEM_R, isLight, seedOf, textStyle } from "./orbits"
import { SolarSystem } from "./solar"

const TARGET = new THREE.Vector3(0, 0, 1.2)
const VIEW = new THREE.Vector3(0, 10, 4.5)
const TOI = new THREE.Vector3(0, 0, SYSTEM_R + 0.9)

export type Map3DProps = {
  board: MapBoard
  c: Palette
  motion: boolean
  now: number
  clock?: () => number
  seedKey: string
  attention?: boolean
  bloom?: boolean
  selected?: StationId | null
  onStation?: (id: StationId | null, x?: number, y?: number) => void
  onPick?: (id: StationId) => void
  onCore?: (x: number | null, y?: number) => void
  onAgent?: (id: string | null, x?: number, y?: number) => void
}

export default function Map3D(props: Map3DProps) {
  const { c } = props
  const layer = useRef<HTMLDivElement>(null)
  const [highlight, setHighlight] = useState<StationId | null>(null)
  const light = isLight(c)
  return (
    <div className="relative h-full w-full">
      <Canvas
        frameloop={props.motion ? "always" : "demand"}
        dpr={[1, 2]}
        camera={{ position: [0, 6, 7], fov: 45, near: 0.1, far: 200 }}
        fallback={<p className="p-4 text-sm">WebGL indisponible : utilise la carte 2D.</p>}
      >
        <LabelLayer.Provider value={layer}>
          <ClockContext.Provider value={props.clock ?? (() => Date.now())}>
            <color attach="background" args={[c.ground]} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 8, 5]} intensity={0.5} />
            <SkyDome radius={150} c={c} light={light} />
            <TwinkleStars count={500} radius={60} color={light ? "#c9c2b4" : c.ash} />
            <SolarSystem
              board={props.board}
              c={c}
              motion={props.motion}
              now={props.now}
              phase={seedOf(props.seedKey)}
              toi={TOI}
              detailed
              attention={props.attention}
              selected={props.selected}
              highlight={highlight}
              onStation={props.onStation}
              onPick={props.onPick}
              onCore={props.onCore}
              onAgent={props.onAgent}
            />
            <group position={TOI}>
              <BlackHole radius={0.13} waiting={!!props.attention} c={c} />
              <Label center position={[0, -0.42, 0]} zIndexRange={[10, 0]}>
                <div style={{ ...textStyle(c, props.attention ? c.hot : c.ash, 11), textAlign: "center" }}>
                  Toi
                  {(props.board.counts.you ?? 0) > 0 && <div style={{ fontSize: 9.5, color: c.dim }}>{props.board.counts.you}</div>}
                </div>
              </Label>
            </group>
            <OrbitControls makeDefault enableDamping minDistance={3} maxDistance={40} />
            <Fit radius={(SYSTEM_R + 0.9) * 0.78} target={TARGET} view={VIEW} />
            {/* Sur fond clair, le halo délaverait tout : réservé au thème sombre */}
            {props.bloom && !light && <Glow />}
          </ClockContext.Provider>
        </LabelLayer.Provider>
      </Canvas>
      <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center px-2">
        <Legend c={c} active={highlight} onActive={setHighlight} />
      </div>
    </div>
  )
}
