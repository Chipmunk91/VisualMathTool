/**
 * The fixed reference frame: hairline x/y/z axes with quiet DOM labels.
 * These never transform — they are the ruler the transformation is read against.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { COLOR } from "./palette";
import { GRID_EXTENT } from "./Grid";

const EXTENT = GRID_EXTENT + 0.6;

export function Axes() {
  const geometry = useMemo(() => {
    const positions = [
      -EXTENT, 0, 0, EXTENT, 0, 0,
      0, -EXTENT, 0, 0, EXTENT, 0,
      0, 0, -EXTENT, 0, 0, EXTENT,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return g;
  }, []);

  const labels: { pos: [number, number, number]; text: string }[] = [
    { pos: [EXTENT + 0.3, 0, 0], text: "x" },
    { pos: [0, EXTENT + 0.3, 0], text: "y" },
    { pos: [0, 0, EXTENT + 0.3], text: "z" },
  ];

  return (
    <group>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={COLOR.axis} transparent opacity={0.5} depthWrite={false} />
      </lineSegments>
      {labels.map((l) => (
        <Html key={l.text} position={l.pos} center style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <span className="select-none font-serif text-sm italic text-muted-foreground">{l.text}</span>
        </Html>
      ))}
    </group>
  );
}
