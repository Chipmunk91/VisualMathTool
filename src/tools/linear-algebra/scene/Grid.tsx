/**
 * The ground grid (xz-plane), built once as a single LineSegments geometry.
 * The transformed copy doesn't rebuild anything: the linear map IS its
 * Object3D matrix, applied on the GPU.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { COLOR } from "./palette";

export const GRID_EXTENT = 6;

type Plane = "xz" | "xy";

function useGridGeometry(plane: Plane) {
  return useMemo(() => {
    const positions: number[] = [];
    for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
      if (plane === "xz") {
        positions.push(i, 0, -GRID_EXTENT, i, 0, GRID_EXTENT);
        positions.push(-GRID_EXTENT, 0, i, GRID_EXTENT, 0, i);
      } else {
        positions.push(i, -GRID_EXTENT, 0, i, GRID_EXTENT, 0);
        positions.push(-GRID_EXTENT, i, 0, GRID_EXTENT, i, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [plane]);
}

export function Grid({
  matrix,
  opacity = 0.32,
  plane = "xz",
}: {
  matrix?: THREE.Matrix4;
  opacity?: number;
  plane?: Plane;
}) {
  const geometry = useGridGeometry(plane);
  return (
    <lineSegments
      geometry={geometry}
      matrixAutoUpdate={false}
      matrix={matrix ?? new THREE.Matrix4()}
    >
      <lineBasicMaterial color={COLOR.grid} transparent opacity={opacity} depthWrite={false} />
    </lineSegments>
  );
}
