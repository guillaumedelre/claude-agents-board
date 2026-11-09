// Plan de la pièce en pixels logiques. Une position de personnage désigne ses pieds.

export type Point = { x: number; y: number }
export type Dir = "down" | "right" | "up" | "left"
export type Rect = { x: number; y: number; w: number; h: number }

export const W = 416
export const WALL_H = 64
export const COUNTER = { x: 99, y: 76, w: 122, h: 45 }
export const DESK = { w: 46, h: 30 }
export const COLS = 3
export const ROW_H = 72
export const FIRST_ROW_Y = 172
const DESK_X = [30, 137, 244]
const MIN_HEIGHT = 230

export const DOOR: Point = { x: 41, y: 74 }
export const MAIN_HOME: Point = { x: COUNTER.x + 61, y: COUNTER.y + 8 }

export const deskPos = (seat: number): Point => ({ x: DESK_X[seat % COLS], y: FIRST_ROW_Y + Math.floor(seat / COLS) * ROW_H })
export const seatHome = (seat: number): Point => {
  const d = deskPos(seat)
  return { x: d.x + 23, y: d.y + 2 }
}
export const sceneHeight = (deskCount: number) => Math.max(MIN_HEIGHT, FIRST_ROW_Y + (deskCount / COLS) * ROW_H - 18)

// Coin pause : chaque activité a un point d'arrivée, une orientation et un libellé
export type SpotId = "coffee" | "sofa" | "books" | "plant"
export type Spot = { id: SpotId; at: Point; dir: Dir; label: string }
export const SPOTS: Spot[] = [
  { id: "coffee", at: { x: 341, y: 86 }, dir: "up", label: "Pause café" },
  { id: "sofa", at: { x: 368, y: 195 }, dir: "up", label: "Devant la TV" },
  { id: "books", at: { x: 268, y: 74 }, dir: "up", label: "À la bibliothèque" },
  { id: "plant", at: { x: 404, y: 112 }, dir: "up", label: "Arrose la plante" },
]
export const NAP_SPOT = SPOTS[1]

// Coin salon (pack maison) : meuble à café et grande TV au mur, table basse sur un tapis, canapé vu de dos, lampadaire
export const FURNITURE = {
  cabinet: { x: 324, y: 42 },
  tv: { x: 362, y: 24 },
  plant: { x: 394, y: 60 },
  carpet: { x: 336, y: 128 },
  table: { x: 345, y: 134 },
  sofa: { x: 344, y: 186 },
  lamp: { x: 398, y: 172 },
  bookshelf: { x: 250, y: 21 },
}

// Zones où les pieds ne passent pas (le haut des meubles et le mur restent traversables visuellement)
function blockers(deskCount: number): Rect[] {
  const rects: Rect[] = [
    { x: COUNTER.x, y: COUNTER.y + 10, w: COUNTER.w, h: COUNTER.h - 10 },
    { x: 320, y: 64, w: 40, h: 14 },
    { x: 392, y: 86, w: 24, h: 18 },
    { x: 343, y: 136, w: 50, h: 24 },
    { x: 342, y: 188, w: 52, h: 20 },
    { x: 396, y: 192, w: 20, h: 12 },
  ]
  for (let seat = 0; seat < deskCount; seat++) {
    const d = deskPos(seat)
    rects.push({ x: d.x - 2, y: d.y + 4, w: DESK.w + 4, h: DESK.h })
  }
  return rects
}

// Grille de 16 px pour les trajets ; parcours en largeur, 4 directions
const CELL = 16

export class Grid {
  cols: number
  rows: number
  walkable: boolean[]

  constructor(height: number, deskCount: number) {
    this.cols = W / CELL
    this.rows = Math.ceil(height / CELL)
    const rects = blockers(deskCount)
    this.walkable = Array.from({ length: this.cols * this.rows }, (_, i) => {
      const cx = (i % this.cols) * CELL + CELL / 2
      const cy = Math.floor(i / this.cols) * CELL + CELL / 2
      if (cy < WALL_H + 6 || cy > height - 6) return false
      return !rects.some((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h)
    })
  }

  private center(i: number): Point {
    return { x: (i % this.cols) * CELL + CELL / 2, y: Math.floor(i / this.cols) * CELL + CELL / 2 }
  }

  private nearest(p: Point) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.walkable.length; i++) {
      if (!this.walkable[i]) continue
      const c = this.center(i)
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  // Points à suivre de `from` à `to` : centres de cases, puis le point exact (bureau, canapé…)
  path(from: Point, to: Point): Point[] {
    const start = this.nearest(from)
    const goal = this.nearest(to)
    if (start < 0 || goal < 0) return [to]
    const prev = new Int32Array(this.walkable.length).fill(-2)
    prev[start] = -1
    const queue = [start]
    while (queue.length) {
      const i = queue.shift()!
      if (i === goal) break
      const x = i % this.cols
      for (const n of [i - this.cols, i + this.cols, x > 0 ? i - 1 : -1, x < this.cols - 1 ? i + 1 : -1]) {
        if (n < 0 || n >= this.walkable.length || !this.walkable[n] || prev[n] !== -2) continue
        prev[n] = i
        queue.push(n)
      }
    }
    if (prev[goal] === -2) return [to]
    const cells: Point[] = []
    for (let i = goal; i !== -1; i = prev[i]) cells.unshift(this.center(i))
    return [...cells, to]
  }
}
