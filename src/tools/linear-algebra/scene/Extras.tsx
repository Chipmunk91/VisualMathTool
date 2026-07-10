/**
 * Open-world scene reveals: the determinant cube, the eigen-axes, and the
 * draggable tip handle. Each earns its place — none exist at identity.
 */
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Html, Line, useCursor } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import type { Vec3 } from "../lib/mat3";
import type { EigenAxis } from "../lib/eigen";
import { COLOR } from "./palette";

const CUBE = "#0d9488"; // teal-600
const EIGEN = "#8b5cf6"; // violet-500

/** The unit cube carried through the map — its volume IS |det A| */
export function UnitCube({ matrix }: { matrix: THREE.Matrix4 }) {
  const { box, edges } = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0.5, 0.5, 0.5); // the cube spanned by î, ĵ, k̂
    return { box: g, edges: new THREE.EdgesGeometry(g) };
  }, []);
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh geometry={box}>
        <meshBasicMaterial color={CUBE} transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={CUBE} transparent opacity={0.45} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/** The unit square spanned by î and ĵ — the 2D domain's area witness */
export function UnitSquare({ matrix }: { matrix: THREE.Matrix4 }) {
  const { face, edges } = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0.5, 0.5, 0);
    return { face: g, edges: new THREE.EdgesGeometry(g) };
  }, []);
  return (
    <group matrixAutoUpdate={false} matrix={matrix}>
      <mesh geometry={face}>
        <meshBasicMaterial color={CUBE} transparent opacity={0.08} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={CUBE} transparent opacity={0.45} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

const fmtVal = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return String(Number.isInteger(r) ? r : r).replace("-", "−");
};

/** An invariant direction of A, drawn as a quiet dashed line with its λ */
export function EigenAxisLine({ axis }: { axis: EigenAxis }) {
  const L = 4.5;
  const a: Vec3 = [-axis.dir[0] * L, -axis.dir[1] * L, -axis.dir[2] * L];
  const b: Vec3 = [axis.dir[0] * L, axis.dir[1] * L, axis.dir[2] * L];
  const labelPos: Vec3 = [axis.dir[0] * (L + 0.4), axis.dir[1] * (L + 0.4), axis.dir[2] * (L + 0.4)];
  return (
    <group>
      <Line points={[a, b]} color={EIGEN} transparent opacity={0.5} dashed dashSize={0.16} gapSize={0.12} lineWidth={1} />
      <Html position={labelPos} center style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
        <span className="select-none whitespace-nowrap font-serif text-xs" style={{ color: EIGEN }}>
          λ = {fmtVal(axis.value)}
        </span>
      </Html>
    </group>
  );
}

/**
 * The grab knob at a vector's tip. Dragging moves the tip in the plane
 * facing the camera; the caller converts the displayed tip back to the
 * model-space vector.
 */
export function TipHandle({
  tip,
  onDrag,
  planeNormal,
}: {
  tip: Vec3;
  onDrag: (p: Vec3) => void;
  /** fixed drag plane normal (e.g. z for a 2D domain); camera-facing when omitted */
  planeNormal?: Vec3;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const plane = useRef(new THREE.Plane());
  const hit = useRef(new THREE.Vector3());
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const camera = useThree((s) => s.camera);
  useCursor(hovered || dragging, dragging ? "grabbing" : "grab");

  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    if (controls) controls.enabled = false;
    const normal = planeNormal
      ? new THREE.Vector3(...planeNormal)
      : camera.getWorldDirection(new THREE.Vector3()).negate();
    plane.current.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...tip));
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    if (e.ray.intersectPlane(plane.current, hit.current)) {
      onDrag([hit.current.x, hit.current.y, hit.current.z]);
    }
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    setDragging(false);
    if (controls) controls.enabled = true;
  };

  return (
    <mesh
      position={tip}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      <sphereGeometry args={[0.17, 16, 16]} />
      <meshBasicMaterial
        color={COLOR.vector}
        transparent
        opacity={hovered || dragging ? 0.95 : 0.35}
      />
    </mesh>
  );
}
