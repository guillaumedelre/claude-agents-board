import { LOOKS, looksByType } from "@/components/office/assets"
import type { Agent } from "@/lib/types"

// Rang du type dans les looks du Bureau, pour qu'un type garde la même place d'une vue à l'autre
const TYPE_COLORS = ["#5fb3d9", "#c45aa0", "#8f7fd1", "#6cc28a", "#d9c25f", "#d9785f", "#5fd9c8", "#b0b8c4"]

export function typeColors(agents: Pick<Agent, "type" | "startedAt">[]) {
  const looks = looksByType(agents)
  return (type: string | null) => TYPE_COLORS[Math.max(0, LOOKS.indexOf(looks.get(type ?? "agent")!))]
}
