import { useEffect, useRef } from "react"
import { useThree } from "@react-three/fiber"
import * as THREE from "three"

// Cadre la scène selon la taille du panneau, tant que la vue n'a pas été déplacée à la main
export function Fit({ radius, target, view, enabled = true }: { radius: number; target: THREE.Vector3; view: THREE.Vector3; enabled?: boolean }) {
  const { camera, size, controls } = useThree()
  const touched = useRef(false)
  useEffect(() => {
    const c = controls as unknown as THREE.EventDispatcher<{ start: object }> | null
    if (!c) return
    const onStart = () => void (touched.current = true)
    c.addEventListener("start", onStart)
    return () => c.removeEventListener("start", onStart)
  }, [controls])
  useEffect(() => {
    if (!enabled || touched.current || !(camera instanceof THREE.PerspectiveCamera)) return
    const v = THREE.MathUtils.degToRad(camera.fov)
    const h = 2 * Math.atan(Math.tan(v / 2) * (size.width / Math.max(1, size.height)))
    const d = radius / Math.sin(Math.min(v, h) / 2)
    camera.position.copy(target).addScaledVector(view.clone().normalize(), d)
    camera.lookAt(target)
    ;(controls as unknown as { target?: THREE.Vector3; update?: () => void } | null)?.target?.copy(target)
    ;(controls as unknown as { update?: () => void } | null)?.update?.()
  }, [camera, size, radius, controls, target, view, enabled])
  return null
}
