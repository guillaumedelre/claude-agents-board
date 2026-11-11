import { Bloom, EffectComposer } from "@react-three/postprocessing"

// Halo lumineux : seules les couleurs au-delà de 1 (soleil, veines, fissures, disque de Toi) brillent
export function Glow() {
  return (
    <EffectComposer>
      <Bloom mipmapBlur luminanceThreshold={1} intensity={0.4} radius={0.4} />
    </EffectComposer>
  )
}
