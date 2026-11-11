// Astres en shaders : planètes par station, soleil et couronne, trou noir de Toi, anneau d'Agents, étoiles, nébuleuses
import { type Ref, useContext, useMemo, useRef } from "react"
import { type ThreeEvent, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { ClockContext, shaderSeconds } from "./clock"
import { isLight } from "./orbits"
import { type Palette, STATIONS, type StationId } from "./map"
import {
  CORONA_FRAGMENT,
  DISK_FRAGMENT,
  DISK_VERTEX,
  KIND,
  PLANET_FRAGMENT,
  RING_FRAGMENT,
  SPHERE_VERTEX,
  STAR_FRAGMENT,
  SKY_FRAGMENT,
  SKY_VERTEX,
  STAR_VERTEX,
  SUN_FRAGMENT,
  SUN_VERTEX,
  iconTexture,
} from "./shaders"

const ICONS = Object.fromEntries(STATIONS.map((s) => [s.id, s.icon])) as Record<StationId, string>

// Couleurs de surface par station : fond, détail, atmosphère (la couleur d'état vient de la palette)
const LOOKS: Record<Exclude<StationId, "you">, [string, string, string]> = {
  model: ["#3a2418", "#ffb36b", "#f0a868"],
  memory: ["#5fbfb1", "#e8fbff", "#62c7ba"],
  files: ["#8a7a68", "#c9b79c", "#d9c7a8"],
  shell: ["#1d2a22", "#5be08c", "#5be08c"],
  web: ["#c9a26b", "#e8d3b0", "#f0c595"],
  browser: ["#1f4f7a", "#79b8ff", "#6aa8ff"],
  skills: ["#5a42a0", "#c9b6ff", "#a68cff"],
  hooks: ["#7d838c", "#d7dde5", "#b8c2cc"],
  agents: ["#d9cfb8", "#b49e7e", "#e8c79a"],
}

export function PlanetBody({
  id,
  radius,
  light,
  ref,
  onPointerMove,
  onPointerOut,
  onClick,
}: {
  id: Exclude<StationId, "you">
  radius: number
  light: boolean
  ref?: Ref<THREE.Mesh>
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const [base, accent, atmosphere] = LOOKS[id]
  const uniforms = useMemo(
    () => ({
      kind: { value: KIND[id] },
      time: { value: 0 },
      heat: { value: 0 },
      alarm: { value: 0 },
      worn: { value: 0 },
      // Thème clair : fond de planète éclairci d'un tiers, sinon les planètes sombres (Terminal, Hooks) se perdent
      base: { value: new THREE.Color(base).lerp(new THREE.Color("#ffffff"), light ? 0.35 : 0) },
      accent: { value: new THREE.Color(accent) },
      atmosphere: { value: new THREE.Color(atmosphere) },
      sun: { value: new THREE.Vector3() },
      icon: { value: iconTexture(ICONS[id]) },
      iconColor: { value: new THREE.Color(light ? "#1f2228" : "#f5efe4") },
      ground: { value: light ? 1 : 0 },
    }),
    [id, base, accent, atmosphere, light],
  )
  return (
    <mesh ref={ref} onPointerMove={onPointerMove} onPointerOut={onPointerOut} onClick={onClick}>
      <sphereGeometry args={[radius, 48, 24]} />
      <shaderMaterial args={[{ uniforms, vertexShader: SPHERE_VERTEX, fragmentShader: PLANET_FRAGMENT }]} />
    </mesh>
  )
}

// Anneau de la planète Agents, dans le plan des orbites : ses lunes gravitent dedans
export function AgentRing({ inner, outer, color }: { inner: number; outer: number; color: string }) {
  const uniforms = useMemo(() => ({ inner: { value: inner }, outer: { value: outer }, color: { value: new THREE.Color(color) } }), [inner, outer, color])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[outer * 2, outer * 2]} />
      <shaderMaterial args={[{ uniforms, vertexShader: DISK_VERTEX, fragmentShader: RING_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }]} />
    </mesh>
  )
}

// Soleil : granulation animée, plus vive quand Claude travaille, ambre quand la session t'attend ; couronne à jets
// brightness < 1 pour un système vu de loin : sinon le halo transforme chaque soleil en tache
export function SunBody({ radius, activity, attention, brightness = 1, c }: { radius: number; activity: number; attention: boolean; brightness?: number; c: Palette }) {
  const clock = useContext(ClockContext)
  const sun = useRef<THREE.Mesh>(null)
  const corona = useRef<THREE.Mesh>(null)
  const sunUniforms = useMemo(
    () => ({
      time: { value: 0 },
      activity: { value: 0 },
      attention: { value: 0 },
      brightness: { value: 1 },
      bumps: { value: radius * 0.12 },
      light: { value: isLight(c) ? 1 : 0 },
      amber: { value: new THREE.Color("#ffb347") },
    }),
    [radius, c],
  )
  // Couronne violette, accordée au soleil indigo
  const coronaColor = isLight(c) ? "#6b5bd6" : "#8f7bff"
  const coronaUniforms = useMemo(() => ({ time: { value: 0 }, activity: { value: 0 }, brightness: { value: 1 }, color: { value: new THREE.Color(coronaColor) } }), [coronaColor])
  useFrame(() => {
    const t = shaderSeconds(clock())
    for (const m of [sun.current, corona.current]) {
      if (!m) continue
      const u = (m.material as THREE.ShaderMaterial).uniforms
      u.time.value = t
      u.activity.value = activity
      u.brightness.value = brightness
      if (u.attention) u.attention.value = attention ? 1 : 0
    }
  })
  return (
    <>
      <mesh ref={sun}>
        <sphereGeometry args={[radius, 96, 48]} />
        <shaderMaterial args={[{ uniforms: sunUniforms, vertexShader: SUN_VERTEX, fragmentShader: SUN_FRAGMENT }]} />
      </mesh>
      <mesh ref={corona}>
        <sphereGeometry args={[radius * 1.55, 48, 24]} />
        <shaderMaterial
          args={[{ uniforms: coronaUniforms, vertexShader: SPHERE_VERTEX, fragmentShader: CORONA_FRAGMENT, transparent: true, depthWrite: false, blending: isLight(c) ? THREE.NormalBlending : THREE.AdditiveBlending }]}
        />
      </mesh>
    </>
  )
}

// Toi : un trou noir doux, avec un disque d'accrétion qui tourne et s'allume en ambre quand une session t'attend
export function BlackHole({ radius, waiting, c }: { radius: number; waiting: boolean; c: Palette }) {
  const clock = useContext(ClockContext)
  const disk = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const diskUniforms = useMemo(
    () => ({ time: { value: 0 }, inner: { value: radius * 1.15 }, outer: { value: radius * 4 }, color: { value: new THREE.Color(c.accent) }, boost: { value: 0 } }),
    [radius, c.accent],
  )
  const ringUniforms = useMemo(() => ({ time: { value: 0 }, activity: { value: 0.4 }, brightness: { value: 1 }, color: { value: new THREE.Color(c.bone) } }), [c.bone])
  useFrame(() => {
    const t = shaderSeconds(clock())
    if (disk.current) {
      const u = (disk.current.material as THREE.ShaderMaterial).uniforms
      u.time.value = t
      u.boost.value = waiting ? 0.6 + 0.4 * Math.sin(t * 5.5) : 0
      u.color.value.set(waiting ? c.hot : c.accent)
    }
    if (ring.current) (ring.current.material as THREE.ShaderMaterial).uniforms.time.value = t
  })
  return (
    <>
      {/* Thème clair : le trou se fond dans le fond de l'espace plutôt qu'une tache noire */}
      <mesh>
        <sphereGeometry args={[radius, 40, 20]} />
        <meshBasicMaterial color={isLight(c) ? c.ground : "#000000"} />
      </mesh>
      <mesh ref={ring}>
        <sphereGeometry args={[radius * 1.12, 40, 20]} />
        <shaderMaterial
          args={[{ uniforms: ringUniforms, vertexShader: SPHERE_VERTEX, fragmentShader: CORONA_FRAGMENT, transparent: true, depthWrite: false, blending: isLight(c) ? THREE.NormalBlending : THREE.AdditiveBlending }]}
        />
      </mesh>
      <mesh ref={disk} rotation={[-Math.PI / 2 + 0.25, 0, 0]}>
        <planeGeometry args={[radius * 8, radius * 8]} />
        <shaderMaterial
          args={[
            {
              uniforms: diskUniforms,
              vertexShader: DISK_VERTEX,
              fragmentShader: DISK_FRAGMENT,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide,
              // Sur fond clair, un mélange additif disparaît : mélange normal
              blending: isLight(c) ? THREE.NormalBlending : THREE.AdditiveBlending,
            },
          ]}
        />
      </mesh>
    </>
  )
}

// Ciel : étoiles réparties sur une coquille, qui scintillent chacune à son rythme
export function TwinkleStars({ count, radius, color, size = 1.2 }: { count: number; radius: number; color: string; size?: number }) {
  const clock = useContext(ClockContext)
  const points = useRef<THREE.Points>(null)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const phase: number[] = []
    let x = 12345
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1
      const t = rnd() * 2 * Math.PI
      const r = radius * (1 + rnd() * 0.4)
      const q = Math.sqrt(1 - u * u)
      pos.push(r * q * Math.cos(t), r * u, r * q * Math.sin(t))
      phase.push(rnd())
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1))
    return g
  }, [count, radius])
  const uniforms = useMemo(() => ({ time: { value: 0 }, size: { value: size }, color: { value: new THREE.Color(color) } }), [size, color])
  useFrame(() => {
    if (points.current) (points.current.material as THREE.ShaderMaterial).uniforms.time.value = shaderSeconds(clock())
  })
  return (
    <points ref={points} geometry={geometry}>
      <shaderMaterial args={[{ uniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT, transparent: true, depthWrite: false }]} />
    </points>
  )
}

// Fond de l'espace : nébuleuse et étoiles en shader, sur une sphère qui entoure la scène
export function SkyDome({ radius, c, light }: { radius: number; c: Palette; light: boolean }) {
  const clock = useContext(ClockContext)
  const sky = useRef<THREE.Mesh>(null)
  const uniforms = useMemo(
    () => ({
      time: { value: 0 },
      ground: { value: new THREE.Color(c.ground) },
      tintA: { value: new THREE.Color(light ? "#d8cfbd" : "#2b4482") },
      tintB: { value: new THREE.Color(light ? "#e3d2e0" : "#6a2f85") },
      tintC: { value: new THREE.Color(light ? "#c8ddd9" : "#2f8592") },
      starColor: { value: new THREE.Color(light ? "#6b7280" : "#e8eef7") },
      strength: { value: light ? 0.55 : 1 },
    }),
    [c.ground, light],
  )
  useFrame(() => {
    if (sky.current) (sky.current.material as THREE.ShaderMaterial).uniforms.time.value = shaderSeconds(clock())
  })
  return (
    <mesh ref={sky} renderOrder={-1}>
      <sphereGeometry args={[radius, 64, 32]} />
      <shaderMaterial args={[{ uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false }]} />
    </mesh>
  )
}
