import { useEffect, useState } from "react"
import type { Board, SessionDetail } from "@/lib/types"

export function useBoard() {
  const [board, setBoard] = useState<Board | null>(null)
  const [online, setOnline] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const res = await fetch("/api/sessions")
        if (res.ok && alive) setBoard(await res.json())
      } catch {
        if (alive) setOnline(false)
      }
    }
    // Une rafale de hooks (un outil par seconde et par agent) ne déclenche qu'un rechargement
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(load, 300)
    }
    load()
    const es = new EventSource("/api/stream")
    es.addEventListener("hello", () => {
      setOnline(true)
      schedule()
    })
    es.addEventListener("change", schedule)
    es.onerror = () => setOnline(false)
    return () => {
      alive = false
      clearTimeout(timer)
      es.close()
    }
  }, [])

  return { board, online }
}

// Recharge le détail quand le résumé de la session indique une activité nouvelle
export function useSession(id: string | null, stamp: number | undefined) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true
    fetch(`/api/sessions/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!alive) return
        if (res.status === 404) setMissing(true)
        else if (res.ok) {
          setMissing(false)
          setDetail(await res.json())
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id, stamp])

  return { detail: detail && detail.id === id ? detail : null, missing }
}

export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function useHashRoute() {
  const parse = () => {
    const [sessionId = null, agentId = null] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean)
    return { sessionId, agentId }
  }
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])
  return route
}

export const go = (sessionId?: string | null, agentId?: string | null) => {
  window.location.hash = sessionId ? `/${sessionId}${agentId ? `/${agentId}` : ""}` : "/"
}
