import { useEffect, useMemo, useRef, useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go } from "@/hooks/use-board"
import { agentLabel, duration } from "@/lib/format"
import { LABELS, agentDisplay, sessionDisplay } from "@/lib/status"
import type { Agent, LastTool, SessionDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { LOOKS, MAIN_LOOK, looksByType, useSprites } from "./assets"
import { draw } from "./draw"
import { type Activity, type Actor, Engine, type Mark, type Wish } from "./engine"
import { COLS, Grid, MAIN_HOME, W, sceneHeight, seatHome } from "./layout"

const FRAME_MS = 150
const MAIN_BUBBLE_MS = 2500
const SUB_STAY_MS = 1500
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "ToolSearch", "NotebookRead", "LS"])

const activityOf = (tool: LastTool | null | undefined, working: boolean): Activity =>
  !working ? "idle" : tool && READ_TOOLS.has(tool.tool) ? "reading" : "typing"

const LABELS_KEY = "agents.officeLabels"
type LabelMode = "always" | "hover"

function readLabelMode(): LabelMode {
  try {
    return localStorage.getItem(LABELS_KEY) === "hover" ? "hover" : "always"
  } catch {
    return "always"
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

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

// Bureaux attribués à l'arrivée et gardés jusqu'au départ ; un sous-agent s'installe au plus près de son parent
function useSeats(present: Agent[]) {
  const seats = useRef(new Map<string, number>())
  return useMemo(() => {
    const ids = new Set(present.map((a) => a.id))
    for (const id of [...seats.current.keys()]) if (!ids.has(id)) seats.current.delete(id)
    for (const a of [...present].sort((x, y) => x.startedAt - y.startedAt)) {
      if (seats.current.has(a.id)) continue
      const taken = new Set(seats.current.values())
      const near = a.parentId != null ? seats.current.get(a.parentId) : undefined
      const limit = Math.max(...taken, -1) + COLS + 1
      let best = 0
      let bestD = Infinity
      for (let seat = 0; seat <= limit; seat++) {
        if (taken.has(seat)) continue
        const d =
          near == null ? seat : Math.abs(Math.floor(seat / COLS) - Math.floor(near / COLS)) + Math.abs((seat % COLS) - (near % COLS))
        if (d < bestD) {
          bestD = d
          best = seat
        }
      }
      seats.current.set(a.id, best)
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
    () => agents.filter((a) => a.status === "running" || (a.endedAt != null && now - a.endedAt < SUB_STAY_MS)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.agents, Math.floor(now / 500)],
  )
  const seats = useSeats(present)
  const looks = useMemo(() => looksByType(Object.values(s.agents)), [s.agents])
  const deskCount = Math.max(COLS, Math.ceil((Math.max(-1, ...seats.values()) + 1) / COLS) * COLS)
  const height = sceneHeight(deskCount)
  const zoom = Math.max(1, Math.min(3, Math.floor(width / W)))
  const [labelMode, setLabelMode] = useState(readLabelMode)
  const [hover, setHover] = useState<string | null>(null)
  const pickLabelMode = (v: string) => {
    if (v !== "always" && v !== "hover") return
    setLabelMode(v)
    try {
      localStorage.setItem(LABELS_KEY, v)
    } catch {
      /* préférence non retenue */
    }
  }
  // Permission demandée par un sous-agent présent : la bulle va sur lui, sinon sur l'agent principal
  const waiting = display === "attention" && s.attentionAgent && present.some((a) => a.id === s.attentionAgent) ? s.attentionAgent : "main"

  const wishes: Wish[] = []
  if (!closed) {
    const mainMark: Mark =
      display === "attention"
        ? waiting === "main"
          ? "wait"
          : null
        : display === "stale"
          ? "sleep"
          : display === "error"
            ? "error"
            : turnEndAt && now - turnEndAt < MAIN_BUBBLE_MS
              ? "done"
              : null
    wishes.push({
      id: "main",
      home: MAIN_HOME,
      look: MAIN_LOOK,
      activity: activityOf(s.lastTool, display === "running"),
      mark: mainMark,
      atDesk: display === "running" || display === "attention" || display === "error",
      nap: display === "stale",
      idleSince: s.lastSeen,
    })
    for (const a of present) {
      const seat = seats.get(a.id)
      if (seat == null) continue
      const shown = agentDisplay(a, now)
      wishes.push({
        id: a.id,
        home: seatHome(seat),
        look: looks.get(a.type ?? "agent") ?? LOOKS[0],
        activity: activityOf(a.lastTool, shown === "running"),
        mark: waiting === a.id ? "wait" : shown === "done" ? "done" : shown === "stopped" ? "error" : shown === "stale" ? "sleep" : null,
        atDesk: true,
        nap: false,
        idleSince: a.lastSeen,
      })
    }
  }

  // Le moteur vit hors de React ; la boucle de dessin lit toujours la dernière scène
  const engine = useRef<Engine | null>(null)
  engine.current ??= new Engine(new Grid(height, deskCount), reducedMotion())
  const selectedId = agentId && agentId !== "main" ? agentId : null
  const outlined = [hover, selectedId].filter((id): id is string => id != null)
  const scene = useRef({ deskCount, height, zoom, closed, seats, outlined })
  scene.current = { deskCount, height, zoom, closed, seats, outlined }
  const wishKey = JSON.stringify(wishes)
  useEffect(() => {
    const e = engine.current!
    e.grid = new Grid(height, deskCount)
    e.sync(JSON.parse(wishKey), Date.now())
  }, [wishKey, height, deskCount])

  // Positions des étiquettes et zones cliquables mises à jour par la boucle, sans rendu React
  const overlays = useRef(new Map<string, HTMLElement[]>())
  const [cast, setCast] = useState("")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!sprites || !canvas) return
    let raf = 0
    let last = performance.now()
    let lastTick = -1
    const still = reducedMotion()
    const loop = (t: number) => {
      const e = engine.current!
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      const moving = e.update(dt, Date.now())
      const tick = still ? 0 : Math.floor(t / FRAME_MS)
      if (moving || tick !== lastTick) {
        lastTick = tick
        const actors = [...e.actors.values()]
        draw(canvas, sprites, { ...scene.current, actors }, tick)
        const z = scene.current.zoom
        for (const a of actors) {
          for (const el of overlays.current.get(a.id) ?? []) {
            el.style.left = `${Math.round((a.x + Number(el.dataset.dx)) * z)}px`
            el.style.top = `${Math.round((a.y + Number(el.dataset.dy)) * z)}px`
          }
        }
        const key = actors.map((a) => `${a.id}:${a.mode}:${a.goal}:${a.spot?.id ?? ""}`).join("|")
        setCast((prev) => (prev === key ? prev : key))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [sprites])

  const byId = new Map(agents.map((a) => [a.id, a]))
  // Lu dans les souhaits du rendu courant : le moteur ne les reçoit qu'après
  const wishById = new Map(wishes.map((w) => [w.id, w]))
  const alert = new Set(wishes.filter((w) => w.mark === "wait" || w.mark === "error").map((w) => w.id))
  const actors = cast ? [...(engine.current?.actors.values() ?? [])] : []
  const bind = (id: string) => (el: HTMLElement | null) => {
    const list = (overlays.current.get(id) ?? []).filter((x) => x.isConnected)
    if (el && !list.includes(el)) list.push(el)
    overlays.current.set(id, list)
  }

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
          {closed && actors.length === 0 && (
            <p className="absolute inset-x-0 top-1/3 text-center text-sm font-medium text-white drop-shadow">Session fermée, le bureau est vide</p>
          )}
          {actors.map((a) => (
            <Person
              key={a.id}
              actor={a}
              agent={a.id === "main" ? undefined : byId.get(a.id)}
              session={s}
              zoom={zoom}
              selected={a.id === selectedId}
              showLabel={labelMode === "always" || hover === a.id || a.id === selectedId || alert.has(a.id)}
              onHover={(on) => setHover((h) => (on ? a.id : h === a.id ? null : h))}
              now={now}
              wish={wishById.get(a.id) ?? a.wish}
              bind={bind(a.id)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2">
          Étiquettes :
          <ToggleGroup type="single" variant="outline" size="sm" value={labelMode} onValueChange={pickLabelMode}>
            <ToggleGroupItem value="always" className="h-6 text-[11px]">
              toujours
            </ToggleGroupItem>
            <ToggleGroupItem value="hover" className="h-6 text-[11px]">
              au survol
            </ToggleGroupItem>
          </ToggleGroup>
        </span>
        <span>
          Sprites :{" "}
          <a className="underline underline-offset-2" href="https://jik-a-4.itch.io/metrocity" target="_blank" rel="noreferrer">
            MetroCity
          </a>{" "}
          par JIK-A-4
        </span>
      </div>
    </div>
  )
}

// Ce que fait le personnage, quand il ne travaille pas : remplace la ligne de l'outil
function doing(a: Actor, w: Wish | null): string | null {
  if (a.mode === "leaving") return "Repart"
  if (w?.mark === "wait") return "Permission demandée"
  if (w?.nap && a.mode === "spot") return "Sieste"
  if (a.goal === "spot" && a.spot) return a.mode === "spot" ? a.spot.label : `${a.spot.label}…`
  if (a.mode === "walking" && a.goal === "home") return w?.activity !== "idle" ? null : "Retourne au bureau"
  if (w?.activity === "idle") return "Au repos"
  return null
}

function Person({
  actor: a,
  agent,
  session: s,
  zoom,
  selected,
  showLabel,
  onHover,
  now,
  wish,
  bind,
}: {
  actor: Actor
  agent: Agent | undefined
  session: SessionDetail
  zoom: number
  selected: boolean
  showLabel: boolean
  onHover: (on: boolean) => void
  now: number
  wish: Wish | null
  bind: (el: HTMLElement | null) => void
}) {
  const main = a.id === "main"
  const name = main ? "Agent principal" : `#${agent?.number ?? "?"} ${agent?.type ?? "agent"}`
  const tool = main ? s.lastTool : agent?.lastTool
  const working = wish != null && wish.activity !== "idle"
  const status = main ? LABELS[sessionDisplay(s, now)] : agent ? LABELS[agentDisplay(agent, now)] : ""
  const note = doing(a, wish)
  const place = (dx: number, dy: number) => ({ left: Math.round((a.x + dx) * zoom), top: Math.round((a.y + dy) * zoom) })
  return (
    <>
      <div
        ref={bind}
        data-dx={0}
        data-dy={-27}
        className={cn(
          "pointer-events-none absolute flex max-w-40 -translate-x-1/2 -translate-y-full flex-col items-center gap-0.5",
          !showLabel && "invisible",
        )}
        style={place(0, -27)}
      >
        <span className="rounded border bg-background/90 px-1 text-[10px] leading-4 font-medium whitespace-nowrap shadow-sm">{name}</span>
        {working && tool && !note ? (
          <span className="max-w-full truncate rounded bg-foreground/80 px-1 font-mono text-[9px] leading-3.5 text-background">
            {tool.tool}
            {tool.summary ? ` · ${tool.summary}` : ""}
          </span>
        ) : (
          note && <span className="max-w-full truncate rounded bg-background/80 px-1 text-[9px] leading-3.5 text-muted-foreground italic">{note}</span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={bind}
            data-dx={-18}
            data-dy={-34}
            type="button"
            aria-label={`${name}, ${note ?? status}${working && tool ? `, ${tool.tool}` : ""}`}
            aria-current={selected || undefined}
            onClick={() => go(s.id, main ? null : a.id)}
            onPointerEnter={() => onHover(true)}
            onPointerLeave={() => onHover(false)}
            onFocus={() => onHover(true)}
            onBlur={() => onHover(false)}
            className="absolute h-0 w-0 rounded-md outline-none"
            style={{ ...place(-18, -34), width: 36 * zoom, height: 38 * zoom }}
          />
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex max-w-64 flex-col gap-0.5">
            <span className="font-semibold">{name}</span>
            {!main && agent && <span className="opacity-80">{agentLabel(agent)}</span>}
            <span className="opacity-80">{note ?? status}</span>
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
