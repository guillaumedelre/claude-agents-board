import { useEffect, useState } from "react"
import type { Agent } from "@/lib/types"

const NAMES = [
  "body", "outfits", "hairs", "counter", "monitor", "table", "bookshelf", "plant", "door", "painting", "wall", "floor",
  "cabinet", "tv", "sofa", "carpet", "lamp",
] as const
export type Sprites = Record<(typeof NAMES)[number], HTMLImageElement>

export function useSprites() {
  const [sprites, setSprites] = useState<Sprites | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all(
      NAMES.map(
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

export type Look = { skin: number; outfit: number; hair: number }

// Veste orange et coiffure 0 réservées à l'agent principal ; la tenue 2 du pack est presque vide
export const MAIN_LOOK: Look = { skin: 0, outfit: 3, hair: 0 }
export const LOOKS: Look[] = [
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

function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

// Un type garde la même apparence ; deux types d'une même session ne partagent pas un look tant qu'il en reste
export function looksByType(agents: Pick<Agent, "type" | "startedAt">[]) {
  const looks = new Map<string, Look>()
  const used = new Set<number>()
  const free = LOOKS.length - Object.keys(FIXED_LOOKS).length
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    const type = a.type ?? "agent"
    if (looks.has(type)) continue
    let i = FIXED_LOOKS[type] ?? LOOKS.length - free + (hash(type) % free)
    for (let n = 0; n < LOOKS.length && used.has(i); n++) i = (i + 1) % LOOKS.length
    used.add(i)
    looks.set(type, LOOKS[i])
  }
  return looks
}
