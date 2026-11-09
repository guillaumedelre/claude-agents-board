export const basename = (p: string | null) => (p ? p.split(/[\\/]/).filter(Boolean).pop() || p : "?")

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return "à l'instant"
  if (s < 60) return `il y a ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.round(h / 24)} j`
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`
}

export const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

export const shortModel = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/\[.*\]$/, "") : null)

export const sessionLabel = (s: { title: string | null; firstPrompt?: string | null }) =>
  s.title || s.firstPrompt?.split("\n")[0] || "Session sans titre"
