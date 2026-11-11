import { useEffect, useRef, useState } from "react"
import type { Entry } from "./map"

export const useDark = () => {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const el = document.documentElement
    const mo = new MutationObserver(() => setDark(el.classList.contains("dark")))
    mo.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => mo.disconnect()
  }, [])
  return dark
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

// Horodatages du serveur remplacés par l'heure locale de réception : un décalage d'horloge
// ou la latence du rechargement ferait rater les animations d'une seconde
export function useLocalTimes() {
  const seen = useRef<Map<string, { start: number; end?: number }> | null>(null)
  return (entries: Entry[], now: number): Entry[] => {
    const first = seen.current === null
    const map = (seen.current ??= new Map())
    return entries.map((e) => {
      let t = map.get(e.id)
      if (!t) {
        // Déjà terminée à sa première apparition : on garde sa durée, l'impulsion de retour part maintenant
        t = first || e.endedAt === undefined ? { start: first ? e.startedAt : now, end: first ? e.endedAt : undefined } : { start: now - (e.endedAt - e.startedAt), end: now }
        map.set(e.id, t)
      } else if (t.end === undefined && e.endedAt !== undefined) {
        t.end = Math.max(now, t.start)
      }
      return { ...e, startedAt: t.start, endedAt: e.endedAt === undefined ? undefined : (t.end ?? e.endedAt) }
    })
  }
}
