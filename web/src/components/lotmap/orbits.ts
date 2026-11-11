// Géométrie des systèmes solaires : orbites, positions des planètes, styles d'étiquettes
import * as THREE from "three"
import { PLANETS, type Palette, type StationId } from "./map"

export const SUN_R = 0.42
const ORBIT_0 = 1.6
const ORBIT_GAP = 0.6
export const SYSTEM_R = ORBIT_0 + ORBIT_GAP * (PLANETS.length - 1) + 0.6
const BASE_PERIOD = 60_000
const FONT = "ui-monospace, SF Mono, Menlo, monospace"

export const orbit = (id: StationId) => ORBIT_0 + ORBIT_GAP * PLANETS.indexOf(id)
// Kepler adouci : les planètes lointaines tournent moins vite
const period = (r: number) => BASE_PERIOD * (r / ORBIT_0) ** 1.5

export function planetAt(id: StationId, t: number, phase: number, out = new THREE.Vector3()) {
  const i = PLANETS.indexOf(id)
  const r = orbit(id)
  const a = phase + i * 2.399 + (2 * Math.PI * t) / period(r)
  return out.set(r * Math.cos(a), 0, r * Math.sin(a))
}

export const textStyle = (c: Palette, color: string, size = 12) =>
  ({ fontFamily: FONT, fontSize: size, color, whiteSpace: "nowrap", pointerEvents: "none", textShadow: `0 0 4px ${c.ground}, 0 0 2px ${c.ground}` }) as const

export const seedOf = (id: string) => ([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 6283) / 1000

// Thème clair : le fond de la palette est clair
export const isLight = (c: Palette) => new THREE.Color(c.ground).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5
