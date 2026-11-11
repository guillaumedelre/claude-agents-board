import { type ComponentProps, type RefObject, useContext } from "react"
import { Html } from "@react-three/drei"
import { LabelLayer } from "./clock"

// Étiquette HTML attachée à un objet 3D, rendue dans le calque de la scène
export function Label(props: ComponentProps<typeof Html>) {
  const layer = useContext(LabelLayer)
  // Html attend un RefObject<HTMLElement> ; le calque est monté avant les étiquettes
  return <Html {...props} portal={(layer as RefObject<HTMLElement> | null) ?? undefined} />
}
