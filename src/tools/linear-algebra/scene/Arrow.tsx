/**
 * A vector as an arrow from the origin: cylinder shaft + cone head, plus a
 * DOM label that keeps the site's typography. The arrow is computed from its
 * endpoint (not sheared by the scene matrix) so the head stays a clean cone
 * no matter how distorted space gets.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { Vec3 } from "../lib/mat3";

const UP = new THREE.Vector3(0, 1, 0);

interface ArrowProps {
  to: Vec3;
  color: string;
  label?: string;
  /** italic serif for user vectors, upright for basis hats */
  labelClass?: string;
  thickness?: number;
}

export function Arrow({ to, color, label, labelClass = "italic", thickness = 0.026 }: ArrowProps) {
  const { shaft, head, tip, visible } = useMemo(() => {
    const target = new THREE.Vector3(...to);
    const length = target.length();
    if (length < 1e-6) {
      return { shaft: null, head: null, tip: target, visible: false } as const;
    }
    const dir = target.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const headLength = Math.min(0.22, length * 0.35);
    const shaftLength = length - headLength;
    return {
      visible: true,
      tip: target,
      shaft: {
        position: dir.clone().multiplyScalar(shaftLength / 2),
        quaternion,
        length: shaftLength,
      },
      head: {
        position: dir.clone().multiplyScalar(length - headLength / 2),
        quaternion,
        length: headLength,
      },
    } as const;
  }, [to]);

  if (!visible) return null;

  return (
    <group>
      <mesh position={shaft!.position} quaternion={shaft!.quaternion}>
        <cylinderGeometry args={[thickness, thickness, shaft!.length, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={head!.position} quaternion={head!.quaternion}>
        <coneGeometry args={[thickness * 2.6, head!.length, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {label && (
        <Html position={tip} center style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <span
            className={`select-none font-serif text-lg ${labelClass}`}
            style={{ color, transform: "translate(12px, -12px)", display: "inline-block" }}
          >
            {label}
          </span>
        </Html>
      )}
    </group>
  );
}
