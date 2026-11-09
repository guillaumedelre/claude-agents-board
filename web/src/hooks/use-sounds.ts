import { useEffect, useRef, useState } from "react"
import type { SessionSummary } from "@/lib/types"

const SOUNDS_KEY = "agents.sounds"
const VOLUME = 0.12

let audio: AudioContext | null = null

// Créé ou relancé au clic sur le bouton : le navigateur bloque le son sans geste de l'utilisateur
function context() {
  audio ??= new AudioContext()
  if (audio.state === "suspended") audio.resume().catch(() => {})
  return audio
}

function chime(notes: number[], wave: OscillatorType) {
  const ctx = context()
  const start = ctx.currentTime + 0.02
  notes.forEach((freq, i) => {
    const t = start + i * 0.13
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = wave
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(VOLUME, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  })
}

// Fin de tour : deux notes montantes ; permission : deux notes répétées plus vives
const playDone = () => chime([659, 880], "sine")
const playAttention = () => chime([988, 988], "triangle")

function readEnabled() {
  try {
    return localStorage.getItem(SOUNDS_KEY) === "1"
  } catch {
    return false
  }
}

// Joue un son aux transitions vues après le chargement, pour toutes les sessions
export function useSounds(sessions: SessionSummary[] | undefined) {
  const [enabled, setEnabledState] = useState(readEnabled)
  const prev = useRef<Map<string, { status: string; attention: boolean }> | null>(null)

  useEffect(() => {
    if (!sessions) return
    const next = new Map(sessions.map((s) => [s.id, { status: s.status, attention: !!s.attention }]))
    const before = prev.current
    prev.current = next
    if (!before || !enabled) return
    let done = false
    let attention = false
    for (const [id, now] of next) {
      const old = before.get(id)
      if (!old) continue
      if (old.status === "running" && now.status === "idle") done = true
      if (!old.attention && now.attention) attention = true
    }
    if (attention) playAttention()
    else if (done) playDone()
  }, [sessions, enabled])

  // Sons activés depuis une visite précédente : le premier geste débloque l'audio
  useEffect(() => {
    if (!enabled) return
    const unlock = () => context()
    window.addEventListener("pointerdown", unlock, { once: true })
    window.addEventListener("keydown", unlock, { once: true })
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
    }
  }, [enabled])

  const setEnabled = (on: boolean) => {
    setEnabledState(on)
    if (on) context()
    try {
      localStorage.setItem(SOUNDS_KEY, on ? "1" : "0")
    } catch {
      /* préférence non retenue */
    }
  }

  return { enabled, setEnabled }
}
