import type { Look } from "./assets"
import { DOOR, type Dir, type Grid, NAP_SPOT, type Point, SPOTS, type Spot } from "./layout"

export type Activity = "typing" | "reading" | "idle"
export type Mark = "wait" | "done" | "error" | "sleep" | null

// Ce que les données demandent pour un personnage à l'instant présent
export type Wish = {
  id: string
  home: Point
  look: Look
  activity: Activity
  mark: Mark
  atDesk: boolean // travail, permission ou erreur : il doit être à son bureau
  nap: boolean // session sans nouvelles : sieste sur le canapé
  idleSince: number
}

export type Mode = "seated" | "walking" | "spot" | "leaving"

export type Actor = {
  id: string
  look: Look
  x: number
  y: number
  dir: Dir
  mode: Mode
  path: Point[]
  goal: "home" | "spot" | "door"
  spot: Spot | null
  until: number
  nextBreak: number
  walkTime: number
  wish: Wish | null
}

const SPEED = 48 // px/s, soit 3 tuiles de 16 px par seconde
const BREAK_AFTER_MS = 30e3
const STAY_MS = [15e3, 40e3]
const FIRST_BREAK_MS = [2e3, 6e3]
const DESK_PAUSE_MS = [5e3, 15e3]
const CHAIN_CHANCE = 0.75

const between = ([min, max]: number[]) => min + Math.random() * (max - min)

export class Engine {
  actors = new Map<string, Actor>()
  grid: Grid
  still: boolean
  private started = false

  constructor(grid: Grid, still: boolean) {
    this.grid = grid
    this.still = still
  }

  // Met les personnages en phase avec les données ; les nouveaux entrent par la porte, sauf au premier affichage
  sync(wishes: Wish[], now: number) {
    const ids = new Set(wishes.map((w) => w.id))
    for (const w of wishes) {
      const a = this.actors.get(w.id)
      if (a) {
        a.wish = w
        a.look = w.look
        continue
      }
      const enter = this.started && !this.still
      const from = enter ? DOOR : w.home
      this.actors.set(w.id, {
        id: w.id,
        look: w.look,
        x: from.x,
        y: from.y,
        dir: "down",
        mode: enter ? "walking" : "seated",
        path: enter ? this.grid.path(DOOR, w.home) : [],
        goal: "home",
        spot: null,
        until: 0,
        nextBreak: now + between(FIRST_BREAK_MS),
        walkTime: 0,
        wish: w,
      })
    }
    for (const a of this.actors.values()) {
      if (ids.has(a.id) || a.goal === "door") continue
      a.wish = null
      this.go(a, "door", DOOR)
    }
    this.started = true
  }

  private go(a: Actor, goal: Actor["goal"], to: Point, spot: Spot | null = null) {
    a.goal = goal
    a.spot = spot
    if (this.still) {
      a.x = to.x
      a.y = to.y
      a.path = []
      this.arrive(a)
      return
    }
    a.path = this.grid.path({ x: a.x, y: a.y }, to)
    a.mode = goal === "door" ? "leaving" : "walking"
  }

  private arrive(a: Actor) {
    if (a.goal === "door") {
      this.actors.delete(a.id)
      return
    }
    if (a.goal === "home") {
      a.mode = "seated"
      a.dir = "down"
      return
    }
    a.mode = "spot"
    a.dir = a.spot!.dir
    a.until = Date.now() + between(STAY_MS)
  }

  private freeSpot(a: Actor) {
    const taken = new Set([...this.actors.values()].filter((o) => o !== a && o.spot).map((o) => o.spot!.id))
    const options = SPOTS.filter((s) => !taken.has(s.id) && s.id !== a.spot?.id)
    return options.length ? options[Math.floor(Math.random() * options.length)] : null
  }

  // Décisions puis déplacement ; renvoie vrai tant que quelqu'un marche (dessin à chaque image)
  update(dt: number, now: number) {
    let moving = false
    for (const a of [...this.actors.values()]) {
      const w = a.wish
      if (w) this.decide(a, w, now)
      if (a.path.length) {
        moving = true
        this.step(a, dt)
      }
    }
    return moving
  }

  private decide(a: Actor, w: Wish, now: number) {
    const home = w.home
    if (w.atDesk || this.still) {
      if (a.goal !== "home") this.go(a, "home", home)
      return
    }
    if (w.nap) {
      if (a.spot?.id !== NAP_SPOT.id) this.go(a, "spot", NAP_SPOT.at, NAP_SPOT)
      return
    }
    if (a.mode === "seated" && now - w.idleSince > BREAK_AFTER_MS && now >= a.nextBreak) {
      const spot = this.freeSpot(a)
      if (spot) this.go(a, "spot", spot.at, spot)
      else a.nextBreak = now + between(DESK_PAUSE_MS)
      return
    }
    if (a.mode === "spot" && now >= a.until) {
      const next = Math.random() < CHAIN_CHANCE ? this.freeSpot(a) : null
      if (next) this.go(a, "spot", next.at, next)
      else {
        a.nextBreak = now + between(DESK_PAUSE_MS)
        this.go(a, "home", home)
      }
    }
  }

  private step(a: Actor, dt: number) {
    let budget = SPEED * dt
    a.walkTime += dt
    while (budget > 0 && a.path.length) {
      const t = a.path[0]
      const dx = t.x - a.x
      const dy = t.y - a.y
      const dist = Math.hypot(dx, dy)
      if (dist > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up"
      if (dist <= budget) {
        a.x = t.x
        a.y = t.y
        budget -= dist
        a.path.shift()
      } else {
        a.x += (dx / dist) * budget
        a.y += (dy / dist) * budget
        budget = 0
      }
    }
    if (!a.path.length) this.arrive(a)
  }
}
