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

export const clock = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

export const tokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",")} M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k` : String(n)

// Coût estimé en dollars, au format français
export const usd = (n: number) => (n > 0 && n < 0.01 ? "< 0,01 $" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`)

export const totalTokens = (u: { input: number; output: number; cacheRead: number; cacheCreation: number }) => u.input + u.output + u.cacheRead + u.cacheCreation

// Fenêtre de contexte : 200 k pour les modèles 3.x à 4.6 sans suffixe [1m], 1 M ensuite (catalogue de Claude Code 2.1)
export const contextWindow = (model: string | null, used: number) =>
  used <= 200_000 && model && !model.includes("[1m]") && /^claude-3|-4(-[0-6])?(-\d{8})?$/.test(model) ? 200_000 : 1_000_000

export const shortModel = (m: string | null) => (m ? m.replace(/^claude-/, "").replace(/\[.*\]$/, "") : null)

// Nom stable : celui donné à la main, sinon le numéro attribué à l'arrivée de la session
export const sessionLabel = (s: { name: string | null; number: number }) => s.name || `Session ${s.number}`

export const agentLabel = (a: { id: string; type: string | null; description: string | null }) =>
  a.description || `Tâche inconnue · ${a.id.slice(0, 4)}`
