import { useEffect, useMemo, useRef, useState } from "react"
import { type Look, LOOKS, MAIN_LOOK, looksByType, useSprites } from "@/components/office/assets"
import { type Activity, type Actor, Engine, type Mark, type Wish } from "@/components/office/engine"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { go, useNow } from "@/hooks/use-board"
import { agentLabel, basename, duration, sessionLabel } from "@/lib/format"
import { LABELS, agentDisplay, sessionDisplay } from "@/lib/status"
import type { Agent, LastTool, SessionSummary } from "@/lib/types"
import { drawOpenSpace } from "./draw"
import { type Plan, type Pod, W, openGrid, planOf } from "./layout"

const FRAME_MS = 150
const MAIN_BUBBLE_MS = 2500
const SUB_STAY_MS = 1500
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch", "ToolSearch", "NotebookRead", "LS"])
const SKINS = 6
const HAIRS = 8

const activityOf = (tool: LastTool | null | undefined, working: boolean): Activity =>
  !working ? "idle" : tool && READ_TOOLS.has(tool.tool) ? "reading" : "typing"

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

// Veste orange pour tous les agents principaux ; peau et coiffure tirées de l'identifiant, sans doublon tant qu'il en reste
function mainLooks(sessions: SessionSummary[]) {
  const looks = new Map<string, Look>()
  const used = new Set<number>()
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    let i = hash(s.id) % (SKINS * HAIRS)
    for (let n = 0; n < SKINS * HAIRS && used.has(i); n++) i = (i + 1) % (SKINS * HAIRS)
    used.add(i)
    looks.set(s.id, { ...MAIN_LOOK, skin: i % SKINS, hair: Math.floor(i / SKINS) })
  }
  return looks
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

// Coche de fin de tour par session : passage d'« en cours » à « au repos »
function useTurnEnds(sessions: SessionSummary[]) {
  const prev = useRef(new Map<string, string>())
  const ends = useRef(new Map<string, number>())
  for (const s of sessions) {
    if (prev.current.get(s.id) === "running" && s.status === "idle") ends.current.set(s.id, Date.now())
    prev.current.set(s.id, s.status)
  }
  return ends.current
}

type Who = { session: SessionSummary; agent?: Agent }

// Une session ouverte par îlot ; tous les agents principaux de l'accueil dans une seule pièce
export function OpenSpace({ sessions }: { sessions: SessionSummary[] }) {
  const now = useNow(1000)
  const sprites = useSprites()
  const { ref: boxRef, width } = useWidth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const turnEnds = useTurnEnds(sessions)
  const zoom = Math.max(1, Math.min(3, Math.floor(width / W)))

  const { plan, wishes, who } = useMemo(() => {
    const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
    const mains = mainLooks(ordered)
    const who = new Map<string, Who>()
    const pods: Pod[] = []
    const subs = new Map<string, Agent[]>()
    for (const s of ordered) {
      const present = s.agents
        .filter((a) => a.status === "running" || (a.endedAt != null && now - a.endedAt < SUB_STAY_MS))
        .sort((a, b) => a.startedAt - b.startedAt)
      subs.set(s.id, present)
      who.set(s.id, { session: s })
      for (const a of present) who.set(`${s.id}/${a.id}`, { session: s, agent: a })
      pods.push({ host: s.host, members: [s.id, ...present.map((a) => `${s.id}/${a.id}`)] })
    }
    const plan = planOf(pods, zoom)
    const homes = new Map(plan.slots.map((slot) => [slot.id, slot.home]))
    const wishes: Wish[] = []
    for (const s of ordered) {
      const display = sessionDisplay(s, now)
      const endAt = turnEnds.get(s.id)
      const mark: Mark =
        display === "attention"
          ? "wait"
          : display === "stale"
            ? "sleep"
            : display === "error"
              ? "error"
              : endAt && now - endAt < MAIN_BUBBLE_MS
                ? "done"
                : null
      wishes.push({
        id: s.id,
        home: homes.get(s.id)!,
        look: mains.get(s.id)!,
        activity: activityOf(s.lastTool, display === "running"),
        mark,
        atDesk: display === "running" || display === "attention" || display === "error",
        nap: display === "stale",
        idleSince: s.lastSeen,
      })
      const looks = looksByType(s.agents)
      for (const a of subs.get(s.id)!) {
        const shown = agentDisplay(a, now)
        wishes.push({
          id: `${s.id}/${a.id}`,
          home: homes.get(`${s.id}/${a.id}`)!,
          look: looks.get(a.type ?? "agent") ?? LOOKS[0],
          activity: activityOf(a.lastTool, shown === "running"),
          mark: shown === "done" ? "done" : shown === "stopped" ? "error" : shown === "stale" ? "sleep" : null,
          atDesk: true,
          nap: false,
          idleSince: a.lastSeen,
        })
      }
    }
    return { plan, wishes, who }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, now, zoom])

  // Le moteur du Bureau vit hors de React ; la boucle de dessin lit toujours la dernière scène
  const engine = useRef<Engine | null>(null)
  engine.current ??= new Engine(openGrid(plan.height, plan.desks), reducedMotion())
  const scene = useRef<{ plan: Plan; zoom: number }>({ plan, zoom })
  scene.current = { plan, zoom }
  const wishKey = JSON.stringify(wishes)
  const gridKey = JSON.stringify([plan.height, plan.desks])
  useEffect(() => {
    engine.current!.grid = openGrid(plan.height, plan.desks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKey])
  const syncedZoom = useRef(0)
  useEffect(() => {
    // Largeur encore inconnue : on attend le vrai zoom pour placer tout le monde
    if (!width) return
    const e = engine.current!
    e.sync(JSON.parse(wishKey), Date.now())
    const rezoom = syncedZoom.current !== zoom
    syncedZoom.current = zoom
    // Un îlot qui se réorganise : la personne assise rejoint son nouveau bureau à pied (sur place après un changement de zoom)
    for (const a of e.actors.values()) {
      const home = a.wish?.home
      if (!home || a.goal !== "home") continue
      const end = a.path.at(-1) ?? a
      if (end.x === home.x && end.y === home.y) continue
      if (e.still || rezoom) {
        a.x = home.x
        a.y = home.y
        a.path = []
        a.mode = "seated"
        a.dir = "down"
      } else {
        a.path = e.grid.path({ x: a.x, y: a.y }, home)
        a.mode = "walking"
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wishKey, gridKey, width > 0])

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
      const frame = still ? 0 : Math.floor(t / FRAME_MS)
      if (moving || frame !== lastTick) {
        lastTick = frame
        const actors = [...e.actors.values()]
        drawOpenSpace(canvas, sprites, { ...scene.current, actors }, frame)
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

  // Les partants gardent leurs dernières données connues le temps de rejoindre la porte
  const known = useRef(new Map<string, Who>())
  for (const [id, w] of who) known.current.set(id, w)
  const actors = cast ? [...(engine.current?.actors.values() ?? [])] : []
  for (const id of [...known.current.keys()]) if (!who.has(id) && !engine.current?.actors.has(id)) known.current.delete(id)
  const bind = (id: string) => (el: HTMLElement | null) => {
    const list = (overlays.current.get(id) ?? []).filter((x) => x.isConnected)
    if (el && !list.includes(el)) list.push(el)
    overlays.current.set(id, list)
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={boxRef} className="w-full">
        <div className="relative mx-auto" style={{ width: W * zoom, height: plan.height * zoom }}>
          <canvas
            ref={canvasRef}
            width={W * zoom}
            height={plan.height * zoom}
            className="block rounded-lg border [image-rendering:pixelated]"
            aria-hidden="true"
          />
          {!sprites && <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Chargement de l'open space…</p>}
          {sprites && sessions.length === 0 && actors.length === 0 && (
            <p className="absolute inset-x-0 top-1/2 text-center text-sm font-medium text-white drop-shadow">Aucune session ouverte</p>
          )}
          {plan.zones.map((z) => (
            <span
              key={z.host}
              className="pointer-events-none absolute rounded bg-foreground/75 px-1.5 font-mono text-[10px] leading-4 text-background"
              style={{ left: 6 * zoom, top: (z.top + 2) * zoom }}
            >
              {z.host}
            </span>
          ))}
          {actors.map((a) => {
            const w = known.current.get(a.id)
            return w ? <Person key={a.id} actor={a} who={w} zoom={zoom} now={now} bind={bind(a.id)} /> : null
          })}
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

// Ce que fait le personnage quand il ne travaille pas : remplace la ligne de l'outil
function doing(a: Actor): string | null {
  const w = a.wish
  if (a.mode === "leaving") return "Repart"
  if (w?.mark === "wait") return "Permission demandée"
  if (w?.nap && a.mode === "spot") return "Sieste"
  if (a.goal === "spot" && a.spot) return a.mode === "spot" ? a.spot.label : `${a.spot.label}…`
  if (a.mode === "walking" && a.goal === "home") return w?.activity !== "idle" ? null : "Retourne au bureau"
  if (w?.activity === "idle") return "Au repos"
  return null
}

function Person({ actor: a, who, zoom, now, bind }: { actor: Actor; who: Who; zoom: number; now: number; bind: (el: HTMLElement | null) => void }) {
  const { session: s, agent } = who
  const main = !agent
  const name = main ? `${sessionLabel(s)} · ${basename(s.cwd)}` : `#${agent.number} ${agent.type ?? "agent"}`
  const tool = main ? s.lastTool : agent.lastTool
  const working = a.wish != null && a.wish.activity !== "idle"
  const status = main ? LABELS[sessionDisplay(s, now)] : LABELS[agentDisplay(agent, now)]
  const note = doing(a)
  const place = (dx: number, dy: number) => ({ left: Math.round((a.x + dx) * zoom), top: Math.round((a.y + dy) * zoom) })
  return (
    <>
      <div
        ref={bind}
        data-dx={0}
        data-dy={-27}
        className="pointer-events-none absolute flex max-w-40 -translate-x-1/2 -translate-y-full flex-col items-center gap-0.5"
        style={place(0, -27)}
      >
        <span className="max-w-full truncate rounded border bg-background/90 px-1 text-[10px] leading-4 font-medium whitespace-nowrap shadow-sm">
          {name}
        </span>
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
            onClick={() => go(s.id, agent ? agent.id : null)}
            className="absolute h-0 w-0 rounded-md outline-none hover:bg-white/10 hover:ring-2 hover:ring-white/50 focus-visible:ring-2 focus-visible:ring-ring"
            style={{ ...place(-18, -34), width: 36 * zoom, height: 38 * zoom }}
          />
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex max-w-64 flex-col gap-0.5">
            <span className="font-semibold">{name}</span>
            <span className="opacity-80">{agent ? agentLabel(agent) : `${s.host} · ${s.cwd ?? "?"}`}</span>
            <span className="opacity-80">{note ?? status}</span>
            {tool && (
              <span className="truncate font-mono opacity-80">
                {tool.tool}
                {tool.summary ? ` · ${tool.summary}` : ""}
              </span>
            )}
            {agent && <span className="opacity-80">{duration((agent.endedAt ?? now) - agent.startedAt)}</span>}
          </div>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
