import { useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

// Préférence partagée par le Bureau et l'open space
const LABELS_KEY = "agents.officeLabels"
export type LabelMode = "always" | "hover"

function readLabelMode(): LabelMode {
  try {
    return localStorage.getItem(LABELS_KEY) === "hover" ? "hover" : "always"
  } catch {
    return "always"
  }
}

export function useLabelMode() {
  const [mode, setMode] = useState(readLabelMode)
  const pick = (v: string) => {
    if (v !== "always" && v !== "hover") return
    setMode(v)
    try {
      localStorage.setItem(LABELS_KEY, v)
    } catch {
      /* préférence non retenue */
    }
  }
  return { mode, pick }
}

export function LabelModeToggle({ mode, onChange }: { mode: LabelMode; onChange: (v: string) => void }) {
  return (
    <span className="flex items-center gap-2">
      Étiquettes :
      <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={onChange}>
        <ToggleGroupItem value="always" className="h-6 text-[11px]">
          toujours
        </ToggleGroupItem>
        <ToggleGroupItem value="hover" className="h-6 text-[11px]">
          au survol
        </ToggleGroupItem>
      </ToggleGroup>
    </span>
  )
}
