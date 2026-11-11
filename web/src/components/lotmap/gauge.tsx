import { type Ref, useMemo } from "react"
import * as THREE from "three"

// Jauge circulaire de la carte 2D (aiguilles d'un appel en cours) : un arc qui se remplit depuis le haut, dans le sens
// horaire, jusqu'à `progress` (0 à 1). Tracée par le fragment shader pour rester nette à toutes les distances.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform float progress;
uniform float inner;
uniform vec3 color;
uniform float opacity;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float aa = fwidth(r);
  float ring = smoothstep(inner - aa, inner, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
  // Angle depuis le haut, dans le sens horaire, ramené à 0..1
  float f = atan(p.x, p.y) / TAU;
  f = f < 0.0 ? f + 1.0 : f;
  float edge = aa / (TAU * max(r, 0.001));
  float fill = progress >= 1.0 ? 1.0 : 1.0 - smoothstep(progress - edge, progress, f);
  float alpha = ring * fill * opacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
`

// La progression se règle à chaque image par la référence : material.uniforms.progress.value
export function Gauge({ ref, radius, width, color, opacity = 1 }: { ref?: Ref<THREE.Mesh>; radius: number; width: number; color: string; opacity?: number }) {
  const uniforms = useMemo(
    () => ({
      progress: { value: 0 },
      inner: { value: (radius - width) / radius },
      color: { value: new THREE.Color(color) },
      opacity: { value: opacity },
    }),
    [radius, width, color, opacity],
  )
  return (
    <mesh ref={ref}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <shaderMaterial args={[{ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }]} />
    </mesh>
  )
}
