import { useEffect, useMemo, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go } from "@/hooks/use-board"
import { agentLabel, duration } from "@/lib/format"
import { LABELS, agentDisplay, sessionDisplay } from "@/lib/status"
import type { Agent, LastTool, SessionDetail } from "@/lib/types"
import { cn } from "@/lib/utils"

// Scène en pixels logiques (tuiles de 32 px), agrandie d'un facteur entier
const W = 320
const WALL_H = 64
const COUNTER = { x: 99, y: 76, w: 122, h: 45 }
const DESK = { w: 46, h: 30 }
const COLS = 3
const ROW_H = 72
const FIRST_ROW_Y = 172
const DESK_X = [30, 137, 244]

const FRAME_MS = 150
const BUBBLE_MS = 2500
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "ToolSearch", "NotebookRead", "LS"])

// Veste orange et coiffure 0 réservées à l'agent principal ; la tenue 2 du pack est presque vide
const MAIN_LOOK = { skin: 0, outfit: 3, hair: 0 }
const LOOKS: Look[] = [
  { skin: 1, outfit: 4, hair: 3 },
  { skin: 3, outfit: 1, hair: 1 },
  { skin: 4, outfit: 5, hair: 6 },
  { skin: 0, outfit: 0, hair: 2 },
  { skin: 5, outfit: 4, hair: 7 },
  { skin: 2, outfit: 5, hair: 4 },
  { skin: 4, outfit: 1, hair: 5 },
  { skin: 1, outfit: 0, hair: 6 },
]
const FIXED_LOOKS: Record<string, number> = { Explore: 0, "general-purpose": 1, Plan: 2 }

const SPRITES = ["body", "outfits", "hairs", "counter", "monitor", "table", "bookshelf", "plant", "door", "painting", "wall", "floor"] as const
type Sprites = Record<(typeof SPRITES)[number], HTMLImageElement>

type Look = { skin: number; outfit: number; hair: number }
type Activity = "typing" | "reading" | "idle"
type Mark = "wait" | "done" | "error" | "sleep" | null
type Person = { id: string | null; seat: number | null; x: number; y: number; look: Look; activity: Activity; mark: Mark }

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

// Un type garde la même apparence ; deux types d'une même session ne partagent pas un look tant qu'il en reste
function looksByType(agents: Agent[]) {
  const looks = new Map<string, Look>()
  const used = new Set<number>()
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    const type = a.type ?? "agent"
    if (looks.has(type)) continue
    const free = LOOKS.length - Object.keys(FIXED_LOOKS).length
    let i = FIXED_LOOKS[type] ?? LOOKS.length - free + (hash(type) % free)
    for (let n = 0; n < LOOKS.length && used.has(i); n++) i = (i + 1) % LOOKS.length
    used.add(i)
    looks.set(type, LOOKS[i])
  }
  return looks
}

const activityOf = (tool: LastTool | null | undefined, working: boolean): Activity =>
  !working ? "idle" : tool && READ_TOOLS.has(tool.tool) ? "reading" : "typing"

const deskPos = (seat: number) => ({ x: DESK_X[seat % COLS], y: FIRST_ROW_Y + Math.floor(seat / COLS) * ROW_H })

function useSprites() {
  const [sprites, setSprites] = useState<Sprites | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all(
      SPRITES.map(
        (name) =>
          new Promise<[string, HTMLImageElement]>((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve([name, img])
            img.onerror = reject
            img.src = `/office/${name}.png`
          }),
      ),
    )
      .then((list) => alive && setSprites(Object.fromEntries(list) as Sprites))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return sprites
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Bureaux attribués à l'arrivée, gardés tant que l'agent est là, puis libérés
function useSeats(present: Agent[]) {
  const seats = useRef(new Map<string, number>())
  return useMemo(() => {
    const ids = new Set(present.map((a) => a.id))
    for (const id of [...seats.current.keys()]) if (!ids.has(id)) seats.current.delete(id)
    for (const a of [...present].sort((x, y) => x.startedAt - y.startedAt)) {
      if (seats.current.has(a.id)) continue
      const taken = new Set(seats.current.values())
      let seat = 0
      while (taken.has(seat)) seat++
      seats.current.set(a.id, seat)
    }
    return new Map(seats.current)
  }, [present])
}

// Coche de fin de tour : l'agent principal vient de passer d'« en cours » à « au repos »
function useTurnEnd(status: string) {
  const prev = useRef(status)
  const [at, setAt] = useState<number | null>(null)
  useEffect(() => {
    if (prev.current === "running" && status === "idle") setAt(Date.now())
    prev.current = status
  }, [status])
  return at
}

export function Office({ session: s, agentId, now }: { session: SessionDetail; agentId: string | null; now: number }) {
  const sprites = useSprites()
  const { ref: boxRef, width } = useWidth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const display = sessionDisplay(s, now)
  const closed = display === "ended"
  const turnEndAt = useTurnEnd(s.status)

  const agents = Object.values(s.agents)
  const present = useMemo(
    () => agents.filter((a) => a.status === "running" || (a.endedAt != null && now - a.endedAt < BUBBLE_MS)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.agents, Math.floor(now / 1000)],
  )
  const seats = useSeats(present)
  const looks = useMemo(() => looksByType(Object.values(s.agents)), [s.agents])
  const deskCount = Math.max(COLS, Math.ceil((Math.max(-1, ...seats.values()) + 1) / COLS) * COLS)
  const height = FIRST_ROW_Y + (deskCount / COLS) * ROW_H - 18
  const zoom = Math.max(1, Math.min(3, Math.floor(width / W)))

  const mainMark: Mark =
    display === "attention" ? "wait" : display === "stale" ? "sleep" : display === "error" ? "error" : turnEndAt && now - turnEndAt < BUBBLE_MS ? "done" : null
  const people: Person[] = []
  if (!closed) {
    people.push({
      id: null,
      seat: null,
      x: COUNTER.x + 45,
      y: COUNTER.y - 22,
      look: MAIN_LOOK,
      activity: activityOf(s.lastTool, display === "running"),
      mark: mainMark,
    })
  }
  for (const a of present) {
    const seat = seats.get(a.id)
    if (seat == null) continue
    const d = deskPos(seat)
    const shown = agentDisplay(a, now)
    people.push({
      id: a.id,
      seat,
      x: d.x + 7,
      y: d.y - 28,
      look: looks.get(a.type ?? "agent") ?? LOOKS[0],
      activity: activityOf(a.lastTool, shown === "running"),
      mark: shown === "done" ? "done" : shown === "stopped" ? "error" : shown === "stale" ? "sleep" : null,
    })
  }

  // La boucle de dessin lit toujours la dernière scène sans redémarrer
  const scene = useRef({ people, deskCount, height, zoom, closed })
  scene.current = { people, deskCount, height, zoom, closed }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!sprites || !canvas) return
    let raf = 0
    let last = -1
    const still = reducedMotion()
    const loop = (t: number) => {
      const tick = still ? 0 : Math.floor(t / FRAME_MS)
      if (tick !== last) {
        last = tick
        draw(canvas, sprites, scene.current, tick)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sprites])

  const byId = new Map(agents.map((a) => [a.id, a]))
  return (
    <div className="flex flex-col gap-2">
      <div ref={boxRef} className="w-full">
        <div className="relative mx-auto" style={{ width: W * zoom, height: height * zoom }}>
          <canvas
            ref={canvasRef}
            width={W * zoom}
            height={height * zoom}
            className="block rounded-lg border [image-rendering:pixelated]"
            aria-hidden="true"
          />
          {!sprites && <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Chargement du bureau…</p>}
          {closed && (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm font-medium text-white drop-shadow">Session fermée, le bureau est vide</p>
          )}
          {people.map((p) => (
            <Seat
              key={p.id ?? "main"}
              person={p}
              agent={p.id ? byId.get(p.id) : undefined}
              session={s}
              zoom={zoom}
              selected={p.id !== null && p.id === agentId}
              now={now}
            />
          ))}
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        Sprites :{" "}
        <a className="underline underline-offset-2" href="https://jik-a-4.itch.io/metrocity" target="_blank" rel="noreferrer">
          MetroCity
        </a>{" "}
        par JIK-A-4
      </p>
    </div>
  )
}

function Seat({
  person: p,
  agent,
  session: s,
  zoom,
  selected,
  now,
}: {
  person: Person
  agent: Agent | undefined
  session: SessionDetail
  zoom: number
  selected: boolean
  now: number
}) {
  const main = p.id === null
  const name = main ? "Agent principal" : `#${agent?.number ?? "?"} ${agent?.type ?? "agent"}`
  const tool = main ? s.lastTool : agent?.lastTool
  const working = p.activity !== "idle"
  const status = main ? LABELS[sessionDisplay(s, now)] : agent ? LABELS[agentDisplay(agent, now)] : ""
  const box = main
    ? { x: COUNTER.x, y: COUNTER.y - 22, w: COUNTER.w, h: COUNTER.h + 22 }
    : { x: p.x - 7, y: p.y, w: DESK.w, h: DESK.h + 28 }
  return (
    <>
      <div
        className="pointer-events-none absolute flex max-w-40 -translate-x-1/2 -translate-y-full flex-col items-center gap-0.5"
        style={{ left: (p.x + 16) * zoom, top: (p.y + 2) * zoom }}
      >
        <span className="rounded border bg-background/90 px-1 text-[10px] leading-4 font-medium whitespace-nowrap shadow-sm">{name}</span>
        {working && tool && (
          <span className="max-w-full truncate rounded bg-foreground/80 px-1 font-mono text-[9px] leading-3.5 text-background">
            {tool.tool}
            {tool.summary ? ` · ${tool.summary}` : ""}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${name}, ${status}${working && tool ? `, ${tool.tool}` : ""}`}
            onClick={() => go(s.id, main ? null : p.id)}
            className={cn(
              "absolute rounded-md outline-none hover:bg-white/10 hover:ring-2 hover:ring-white/50 focus-visible:ring-2 focus-visible:ring-ring",
              selected && "ring-2 ring-ring",
            )}
            style={{ left: box.x * zoom, top: box.y * zoom, width: box.w * zoom, height: box.h * zoom }}
          />
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex max-w-64 flex-col gap-0.5">
            <span className="font-semibold">{name}</span>
            {!main && agent && <span className="opacity-80">{agentLabel(agent)}</span>}
            <span className="opacity-80">{status}</span>
            {tool && (
              <span className="truncate font-mono opacity-80">
                {tool.tool}
                {tool.summary ? ` · ${tool.summary}` : ""}
              </span>
            )}
            {!main && agent && <span className="opacity-80">{duration((agent.endedAt ?? now) - agent.startedAt)}</span>}
          </div>
        </TooltipContent>
      </Tooltip>
    </>
  )
}

type Scene = { people: Person[]; deskCount: number; height: number; zoom: number; closed: boolean }

function draw(canvas: HTMLCanvasElement, sp: Sprites, scene: Scene, tick: number) {
  const { people, deskCount, height, zoom, closed } = scene
  if (canvas.width !== W * zoom || canvas.height !== height * zoom) return
  const ctx = canvas.getContext("2d")!
  ctx.setTransform(zoom, 0, 0, zoom, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, W, height)

  for (let x = 0; x < W; x += 32) for (let y = WALL_H; y < height; y += 32) ctx.drawImage(sp.floor, x, y)
  for (let x = 0; x < W; x += 48) ctx.drawImage(sp.wall, x, 0)
  ctx.drawImage(sp.door, 24, 15)
  ctx.drawImage(sp.painting, 80, 12)
  ctx.drawImage(sp.bookshelf, 250, 21)
  ctx.drawImage(sp.plant, 292, 40)

  const main = people.find((p) => p.id === null)
  if (main) drawPerson(ctx, sp, main, tick)
  ctx.drawImage(sp.counter, COUNTER.x, COUNTER.y)
  if (main) {
    drawLed(ctx, COUNTER.x + 61, COUNTER.y + 17, main.activity, tick)
    if (main.activity === "reading") drawPaper(ctx, COUNTER.x + 78, COUNTER.y + 12)
  }

  const bySeat = new Map(people.filter((p) => p.seat !== null).map((p) => [p.seat, p]))
  for (let seat = 0; seat < deskCount; seat++) {
    const d = deskPos(seat)
    const p = bySeat.get(seat)
    if (p) drawPerson(ctx, sp, p, tick)
    ctx.drawImage(sp.table, d.x, d.y)
    ctx.drawImage(sp.monitor, d.x + 12, d.y - 4)
    if (p) {
      drawLed(ctx, d.x + 22, d.y + 9, p.activity, tick)
      if (p.activity === "reading") drawPaper(ctx, d.x + 36, d.y + 4)
    }
  }

  for (const p of people) if (p.mark) drawBubble(ctx, p.x + 31, p.y + 4, p.mark, tick)

  if (closed) {
    ctx.fillStyle = "rgba(10, 10, 20, 0.45)"
    ctx.fillRect(0, 0, W, height)
  }
}

// Frappe : images 1 et 4 de la marche (un bras puis l'autre en avant), sans enchaîner le cycle complet qui ressemble à une course.
// Lecture : regard tourné vers la feuille posée à droite (image 6, profil droit) une partie du temps.
function frameOf(activity: Activity, tick: number) {
  if (activity === "typing") return Math.floor(tick / 2) % 2 ? 4 : 1
  if (activity === "reading") return tick % 20 < 9 ? 6 : 0
  return 0
}

function drawPerson(ctx: CanvasRenderingContext2D, sp: Sprites, p: Person, tick: number) {
  const frame = frameOf(p.activity, tick)
  for (const [sheet, row] of [
    [sp.body, p.look.skin],
    [sp.outfits, p.look.outfit],
    [sp.hairs, p.look.hair],
  ] as const) {
    ctx.drawImage(sheet, frame * 32, row * 32, 32, 32, p.x, p.y, 32, 32)
  }
}

// Voyant sous l'écran : bleu clignotant en frappe, vert fixe en lecture, éteint au repos
function drawLed(ctx: CanvasRenderingContext2D, x: number, y: number, activity: Activity, tick: number) {
  if (activity === "idle" || (activity === "typing" && tick % 4 === 3)) return
  ctx.fillStyle = activity === "typing" ? "#5ab4ff" : "#62d26f"
  ctx.fillRect(x - 1, y, 4, 2)
}

// Feuille posée à droite de l'écran pendant la lecture
function drawPaper(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#1c1c24"
  ctx.fillRect(x - 1, y - 1, 9, 8)
  ctx.fillStyle = "#f4f1e8"
  ctx.fillRect(x, y, 7, 6)
  ctx.fillStyle = "#9a958a"
  for (const dy of [1, 3, 5]) ctx.fillRect(x + 1, y + dy, dy === 5 ? 3 : 5, 1)
}

const MARK_COLORS: Record<Exclude<Mark, null>, string> = { wait: "#f0a020", done: "#3cb05a", error: "#e0463c", sleep: "#7a86a0" }

function drawBubble(ctx: CanvasRenderingContext2D, cx: number, top: number, mark: Exclude<Mark, null>, tick: number) {
  const w = 13
  const h = 10
  // Bulle à droite de la tête, pointe vers la gauche : l'étiquette HTML occupe le dessus
  const x = Math.round(cx - w / 2)
  const y = top
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
    ctx.fillRect(cx - 1, y + 2, 2, 4)
    ctx.fillRect(cx - 1, y + 7, 2, 1)
  } else {
    ctx.fillRect(x + 3, y + 2, 5, 1)
    ctx.fillRect(x + 6, y + 3, 1, 1)
    ctx.fillRect(x + 5, y + 4, 1, 1)
    ctx.fillRect(x + 4, y + 5, 1, 1)
    ctx.fillRect(x + 3, y + 6, 5, 1)
  }
}
