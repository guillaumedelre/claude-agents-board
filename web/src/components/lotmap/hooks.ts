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
// ou la latence du rechargement ferait rater les animations d'une seconde.
// La première fois qu'un groupe (une session sur l'arbre) apporte des entrées, elles gardent leurs heures :
// sinon tout l'historique repartirait en impulsions au chargement de la page.
export function useLocalTimes() {
  const seen = useRef(new Map<string, { start: number; end?: number }>())
  const groups = useRef(new Set<string>())
  return (entries: Entry[], now: number, groupOf: (e: Entry) => string = () => ""): Entry[] => {
    const map = seen.current
    const fresh = new Set(entries.map(groupOf).filter((g) => !groups.current.has(g)))
    for (const g of fresh) groups.current.add(g)
    return entries.map((e) => {
      let t = map.get(e.id)
      if (!t) {
        const initial = fresh.has(groupOf(e))
        // Déjà terminée à sa première apparition : on garde sa durée, l'impulsion de retour part maintenant
        t = initial || e.endedAt === undefined ? { start: initial ? e.startedAt : now, end: initial ? e.endedAt : undefined } : { start: now - (e.endedAt - e.startedAt), end: now }
        map.set(e.id, t)
      } else if (t.end === undefined && e.endedAt !== undefined) {
        t.end = Math.max(now, t.start)
      }
      return { ...e, startedAt: t.start, endedAt: e.endedAt === undefined ? undefined : (t.end ?? e.endedAt) }
    })
  }
}
