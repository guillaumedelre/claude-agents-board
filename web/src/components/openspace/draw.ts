import type { Sprites } from "@/components/office/assets"
import { drawActor, drawBubble, drawCoffeeMachine, drawDeskState, drawTvScreen } from "@/components/office/draw"
import type { Actor } from "@/components/office/engine"
import { FURNITURE, WALL_H } from "@/components/office/layout"
import { LOUNGE_BOTTOM, LOUNGE_LEFT, type Plan, W } from "./layout"

export type Scene = { actors: Actor[]; plan: Plan; zoom: number }

// Teinte de fond par îlot, pour distinguer les sessions voisines
const TINTS = ["#5ab4ff", "#62d26f", "#f0a020", "#e06aa8", "#a98bff", "#3cc8c0"]

export function drawOpenSpace(canvas: HTMLCanvasElement, sp: Sprites, scene: Scene, tick: number) {
  const { actors, plan, zoom } = scene
  const { height } = plan
  if (canvas.width !== W * zoom || canvas.height !== height * zoom) return
  const ctx = canvas.getContext("2d")!
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, W, height)

  for (let x = 0; x < W; x += 32) for (let y = WALL_H; y < height; y += 32) ctx.drawImage(sp.floor, x, y)
  for (let x = 0; x < W; x += 48) ctx.drawImage(sp.wall, x, 0)
  const f = FURNITURE
  ctx.drawImage(sp.carpet, f.carpet.x, f.carpet.y)
  ctx.drawImage(sp.tv, f.tv.x, f.tv.y)
  if (actors.some((a) => a.mode === "spot" && a.spot?.id === "sofa" && !a.wish?.nap)) drawTvScreen(ctx, f.tv.x, f.tv.y, tick)
  ctx.drawImage(sp.door, 24, 15)
  ctx.drawImage(sp.painting, 80, 12)
  ctx.drawImage(sp.painting, 168, 12)
  ctx.drawImage(sp.bookshelf, f.bookshelf.x, f.bookshelf.y)

  for (const t of plan.tints) {
    const { x, y, w, h } = t.rect
    ctx.fillStyle = TINTS[t.index % TINTS.length]
    ctx.globalAlpha = 0.16
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 0.6
    ctx.fillRect(x, y, w, 1)
    ctx.fillRect(x, y + h - 1, w, 1)
    ctx.fillRect(x, y + 1, 1, h - 2)
    ctx.fillRect(x + w - 1, y + 1, 1, h - 2)
    ctx.globalAlpha = 1
  }
  // Marquage au sol entre deux machines, interrompu devant le coin salon
  ctx.fillStyle = "rgba(20, 20, 30, 0.35)"
  for (const z of plan.zones.slice(1)) {
    const end = z.top < LOUNGE_BOTTOM ? LOUNGE_LEFT : W
    for (let x = 4; x < end - 4; x += 8) ctx.fillRect(x, z.top - 4, 5, 1)
  }

  const byId = new Map(actors.map((a) => [a.id, a]))
  const owner = new Map(plan.slots.map((s) => [`${s.desk.x},${s.desk.y}`, s.id]))
  const someoneAt = (spot: string) => actors.some((a) => a.mode === "spot" && a.spot?.id === spot)

  // Meubles et personnages triés par la ligne de leurs pieds, comme dans le Bureau
  const items: { y: number; draw: () => void }[] = []
  for (const a of actors) items.push({ y: a.y, draw: () => drawActor(ctx, sp, a, tick) })
  for (const d of plan.desks) {
    items.push({
      y: d.y + 30,
      draw: () => {
        ctx.drawImage(sp.table, d.x, d.y)
        ctx.drawImage(sp.monitor, d.x + 12, d.y - 4)
        const id = owner.get(`${d.x},${d.y}`)
        const a = id ? byId.get(id) : undefined
        if (a && a.mode === "seated") drawDeskState(ctx, d.x + 22, d.y + 9, d.x + 36, d.y + 4, a.wish?.activity, tick)
      },
    })
  }
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
}
