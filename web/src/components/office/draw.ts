import type { Sprites } from "./assets"
import type { Activity, Actor, Mark } from "./engine"
import { COUNTER, type Dir, FURNITURE, W, WALL_H, deskPos } from "./layout"

export type Scene = {
  actors: Actor[]
  deskCount: number
  seats: Map<string, number> // agent → bureau
  height: number
  zoom: number
  closed: boolean
}

const DIR_ROW: Record<Dir, number> = { down: 0, right: 1, up: 2, left: 3 }

// Images de 32x32 : 6 par direction (bas, droite, haut, gauche).
// Frappe : images 1 et 4 (un bras puis l'autre), lecture : regard vers la feuille à droite (profil droit).
function frameOf(a: Actor, tick: number) {
  if (a.mode === "walking" || a.mode === "leaving") return DIR_ROW[a.dir] * 6 + (tick % 6)
  if (a.mode === "spot") return DIR_ROW[a.dir] * 6
  const activity = a.wish?.activity ?? "idle"
  if (activity === "typing") return Math.floor(tick / 2) % 2 ? 4 : 1
  if (activity === "reading") return tick % 20 < 9 ? 6 : 0
  return 0
}

const atHome = (a: Actor) => a.mode === "seated"

export function draw(canvas: HTMLCanvasElement, sp: Sprites, scene: Scene, tick: number) {
  const { actors, deskCount, seats, height, zoom, closed } = scene
  if (canvas.width !== W * zoom || canvas.height !== height * zoom) return
  const ctx = canvas.getContext("2d")!
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, W, height)

  for (let x = 0; x < W; x += 32) for (let y = WALL_H; y < height; y += 32) ctx.drawImage(sp.floor, x, y)
  for (let x = 0; x < W; x += 48) ctx.drawImage(sp.wall, x, 0)
  ctx.drawImage(sp.carpet, FURNITURE.carpet.x, FURNITURE.carpet.y)
  ctx.drawImage(sp.tv, FURNITURE.tv.x, FURNITURE.tv.y)
  if (actors.some((a) => a.mode === "spot" && a.spot?.id === "sofa" && !a.wish?.nap)) drawTvScreen(ctx, FURNITURE.tv.x, FURNITURE.tv.y, tick)
  ctx.drawImage(sp.door, 24, 15)
  ctx.drawImage(sp.painting, 80, 12)
  ctx.drawImage(sp.bookshelf, FURNITURE.bookshelf.x, FURNITURE.bookshelf.y)

  const byId = new Map(actors.map((a) => [a.id, a]))
  const owner = (seat: number) => [...seats].find(([, s]) => s === seat)?.[0]
  const someoneAt = (spot: string) => actors.some((a) => a.mode === "spot" && a.spot?.id === spot)

  // Meubles et personnages triés par la ligne de leurs pieds : un personnage derrière un meuble est caché par lui
  const items: { y: number; draw: () => void }[] = []
  for (const a of actors) items.push({ y: a.y, draw: () => drawActor(ctx, sp, a, tick) })

  items.push({
    y: COUNTER.y + COUNTER.h,
    draw: () => {
      ctx.drawImage(sp.counter, COUNTER.x, COUNTER.y)
      const main = byId.get("main")
      if (main && atHome(main)) drawDeskState(ctx, COUNTER.x + 61, COUNTER.y + 17, COUNTER.x + 78, COUNTER.y + 12, main.wish?.activity, tick)
    },
  })
  for (let seat = 0; seat < deskCount; seat++) {
    const d = deskPos(seat)
    items.push({
      y: d.y + 30,
      draw: () => {
        ctx.drawImage(sp.table, d.x, d.y)
        ctx.drawImage(sp.monitor, d.x + 12, d.y - 4)
        const id = owner(seat)
        const a = id ? byId.get(id) : undefined
        if (a && atHome(a)) drawDeskState(ctx, d.x + 22, d.y + 9, d.x + 36, d.y + 4, a.wish?.activity, tick)
      },
    })
  }
  const f = FURNITURE
  items.push({
    y: 76,
    draw: () => {
      ctx.drawImage(sp.cabinet, f.cabinet.x, f.cabinet.y)
      drawCoffeeMachine(ctx, f.cabinet.x + 12, f.cabinet.y - 9, someoneAt("coffee"), tick)
    },
  })
  items.push({ y: 103, draw: () => ctx.drawImage(sp.plant, f.plant.x, f.plant.y) })
  items.push({ y: 164, draw: () => ctx.drawImage(sp.table, f.table.x, f.table.y) })
  items.push({ y: 207, draw: () => ctx.drawImage(sp.sofa, f.sofa.x, f.sofa.y) })
  items.push({ y: 204, draw: () => ctx.drawImage(sp.lamp, f.lamp.x, f.lamp.y) })
  items.sort((a, b) => a.y - b.y)
  for (const it of items) it.draw()

  for (const a of actors) {
    const mark = a.wish?.mark ?? null
    if (mark) drawBubble(ctx, a.x + 15, a.y - 26, mark, tick)
  }

  if (closed) {
    ctx.fillStyle = "rgba(10, 10, 20, 0.45)"
    ctx.fillRect(0, 0, W, height)
  }
}

function drawActor(ctx: CanvasRenderingContext2D, sp: Sprites, a: Actor, tick: number) {
  const frame = frameOf(a, tick)
  const x = Math.round(a.x - 16)
  const y = Math.round(a.y - 30)
  for (const [sheet, row] of [
    [sp.body, a.look.skin],
    [sp.outfits, a.look.outfit],
    [sp.hairs, a.look.hair],
  ] as const) {
    ctx.drawImage(sheet, frame * 32, row * 32, 32, 32, x, y, 32, 32)
  }
}

// Voyant sous l'écran (bleu clignotant en frappe, vert en lecture) et feuille posée pendant la lecture
function drawDeskState(ctx: CanvasRenderingContext2D, ledX: number, ledY: number, paperX: number, paperY: number, activity: Activity | undefined, tick: number) {
  if (!activity || activity === "idle") return
  if (activity === "reading") {
    ctx.fillStyle = "#1c1c24"
    ctx.fillRect(paperX - 1, paperY - 1, 9, 8)
    ctx.fillStyle = "#f4f1e8"
    ctx.fillRect(paperX, paperY, 7, 6)
    ctx.fillStyle = "#9a958a"
    for (const dy of [1, 3, 5]) ctx.fillRect(paperX + 1, paperY + dy, dy === 5 ? 3 : 5, 1)
  }
  if (activity === "typing" && tick % 4 === 3) return
  ctx.fillStyle = activity === "typing" ? "#5ab4ff" : "#62d26f"
  ctx.fillRect(ledX - 1, ledY, 4, 2)
}

// Machine à café dessinée en pixels (absente du pack), avec vapeur quand quelqu'un se sert
function drawCoffeeMachine(ctx: CanvasRenderingContext2D, x: number, y: number, busy: boolean, tick: number) {
  ctx.fillStyle = "#1c1c24"
  ctx.fillRect(x - 1, y - 1, 12, 13)
  ctx.fillStyle = "#4a4a58"
  ctx.fillRect(x, y, 10, 11)
  ctx.fillStyle = "#2a2a34"
  ctx.fillRect(x + 2, y + 4, 6, 5)
  ctx.fillStyle = busy ? "#62d26f" : "#e0463c"
  ctx.fillRect(x + 7, y + 1, 2, 1)
  ctx.fillStyle = "#f4f1e8"
  ctx.fillRect(x + 4, y + 7, 2, 2)
  if (!busy) return
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)"
  const k = tick % 4
  ctx.fillRect(x + 4 + (k % 2), y - 3 - k, 1, 2)
  ctx.fillRect(x + 5 - (k % 2), y - 6 - (k % 3), 1, 2)
}

// Image qui change sur l'écran de la grande TV quand quelqu'un la regarde
function drawTvScreen(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  const colors = ["#5ab4ff", "#62d26f", "#f0a020", "#e06aa8"]
  ctx.fillStyle = colors[Math.floor(tick / 6) % colors.length]
  ctx.globalAlpha = 0.55
  ctx.fillRect(x + 4, y + 4, 40, 18)
  ctx.globalAlpha = 1
}

const MARK_COLORS: Record<Exclude<Mark, null>, string> = { wait: "#f0a020", done: "#3cb05a", error: "#e0463c", sleep: "#7a86a0" }

// Bulle à droite de la tête, pointe vers la gauche : l'étiquette HTML occupe le dessus
function drawBubble(ctx: CanvasRenderingContext2D, cx: number, top: number, mark: Exclude<Mark, null>, tick: number) {
  const w = 13
  const h = 10
  const x = Math.round(cx)
  const y = Math.round(top)
  ctx.fillStyle = "#1c1c24"
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
  ctx.fillRect(x - 3, y + 6, 2, 2)
  ctx.fillRect(x - 4, y + 8, 1, 1)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(x, y, w, h)
  ctx.fillRect(x - 2, y + 6, 2, 1)
  ctx.fillStyle = MARK_COLORS[mark]
  if (mark === "wait") {
    const lit = tick % 6 < 3 ? 3 : 2
    for (let i = 0; i < lit; i++) ctx.fillRect(x + 2 + i * 4, y + 4, 2, 2)
  } else if (mark === "done") {
    for (const [dx, dy] of [[2, 5], [3, 6], [4, 7], [5, 6], [6, 5], [7, 4], [8, 3], [9, 2]]) ctx.fillRect(x + dx, y + dy, 2, 1)
  } else if (mark === "error") {
    ctx.fillRect(x + 6, y + 2, 2, 4)
    ctx.fillRect(x + 6, y + 7, 2, 1)
  } else {
    ctx.fillRect(x + 3, y + 2, 5, 1)
    ctx.fillRect(x + 6, y + 3, 1, 1)
    ctx.fillRect(x + 5, y + 4, 1, 1)
    ctx.fillRect(x + 4, y + 5, 1, 1)
    ctx.fillRect(x + 3, y + 6, 5, 1)
  }
}

