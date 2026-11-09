// Plan de l'open space : porte et coin salon du Bureau, puis une zone par machine avec des îlots de bureaux par session
import { DESK, Grid, type Point, type Rect, W, WALL_H } from "@/components/office/layout"

export { W }

const COL_X = [24, 124, 224]
const COLS = COL_X.length
const ROW_H = 72
const FIRST_ZONE_TOP = WALL_H + 8
const ZONE_HEAD = 68 // du haut de zone à la première rangée : étiquette de la machine puis noms des agents
const ZONE_HEAD_ZOOM1 = 20 // au zoom 1, les étiquettes HTML prennent deux fois plus de place sur le plan
const ZONE_GAP = 14
const MIN_HEIGHT = 230
// Le coin salon occupe la droite jusqu'à cette hauteur : les séparations de zone s'arrêtent avant
export const LOUNGE_BOTTOM = 216
export const LOUNGE_LEFT = 310

export type Pod = { host: string; members: string[] } // members[0] : agent principal
export type Slot = { id: string; desk: Point; home: Point }
export type Zone = { host: string; top: number }
export type Tint = { rect: Rect; index: number } // rang de l'îlot : deux îlots voisins n'ont pas la même couleur
export type Plan = { slots: Slot[]; desks: Point[]; zones: Zone[]; tints: Tint[]; height: number }

// Îlots posés dans l'ordre : un îlot qui tient dans la rangée en cours la complète, sinon il commence une rangée
export function planOf(pods: Pod[], zoom: number): Plan {
  const slots: Slot[] = []
  const desks: Point[] = []
  const zones: Zone[] = []
  const tints: Tint[] = []
  const hosts = [...new Set(pods.map((p) => p.host))].sort((a, b) => a.localeCompare(b))
  let top = FIRST_ZONE_TOP
  let bottom = 0
  for (const host of hosts) {
    zones.push({ host, top })
    const firstY = top + ZONE_HEAD + (zoom === 1 ? ZONE_HEAD_ZOOM1 : 0)
    let seat = 0
    for (const pod of pods.filter((p) => p.host === host)) {
      const col = seat % COLS
      if (col > 0 && pod.members.length > COLS - col) seat += COLS - col
      pod.members.forEach((id, i) => {
        const desk = { x: COL_X[seat % COLS], y: firstY + Math.floor(seat / COLS) * ROW_H }
        slots.push({ id, desk, home: { x: desk.x + 23, y: desk.y + 2 } })
        if (i > 0 && seat % COLS > 0) tints[tints.length - 1].rect.w = desk.x + DESK.w + 8 - tints[tints.length - 1].rect.x
        else tints.push({ index: pods.indexOf(pod), rect: { x: desk.x - 8, y: desk.y - 34, w: DESK.w + 16, h: 68 } })
        seat++
      })
    }
    const rows = Math.ceil(seat / COLS)
    for (let r = 0; r < rows; r++) for (const x of COL_X) desks.push({ x, y: firstY + r * ROW_H })
    bottom = firstY + (rows - 1) * ROW_H + DESK.h
    top = bottom + ZONE_GAP
  }
  return { slots, desks, zones, tints, height: Math.max(MIN_HEIGHT, bottom + 24) }
}

// Mêmes obstacles que le coin salon du Bureau, sans le comptoir
const LOUNGE_BLOCKERS: Rect[] = [
  { x: 320, y: 64, w: 40, h: 14 },
  { x: 392, y: 86, w: 24, h: 18 },
  { x: 343, y: 136, w: 50, h: 24 },
  { x: 342, y: 188, w: 52, h: 20 },
  { x: 396, y: 192, w: 20, h: 12 },
]

// Grille du Bureau dont on remplace les cases praticables : le moteur reste celui du Bureau
export function openGrid(height: number, desks: Point[]) {
  const grid = new Grid(height, 0)
  const rects = [...LOUNGE_BLOCKERS, ...desks.map((d) => ({ x: d.x - 2, y: d.y + 4, w: DESK.w + 4, h: DESK.h }))]
  grid.walkable = grid.walkable.map((_, i) => {
    const cx = (i % grid.cols) * 16 + 8
    const cy = Math.floor(i / grid.cols) * 16 + 8
    if (cy < WALL_H + 6 || cy > height - 6) return false
    return !rects.some((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)
  })
  return grid
}
