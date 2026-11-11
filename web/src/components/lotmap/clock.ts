import { type RefObject, createContext } from "react"

// Horloge des scènes 3D : l'heure réelle en direct, l'heure rejouée en relecture
export const ClockContext = createContext<() => number>(() => Date.now())

// Calque HTML posé sur la toile, où les étiquettes 3D sont rendues (au lieu du conteneur interne de React Three Fiber)
export const LabelLayer = createContext<RefObject<HTMLDivElement | null> | null>(null)

// Secondes depuis minuit pour les shaders : en flottant 32 bits, l'heure depuis 1970 (~1,8 milliard de secondes)
// n'a plus de décimales, et le bruit comme les hachages deviennent quasi constants
export const shaderSeconds = (ms: number) => (((ms % 86_400_000) + 86_400_000) % 86_400_000) / 1000
