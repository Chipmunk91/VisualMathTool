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

const COLSPACE = "#0284c7"; // sky-600
const NULLSPACE = "#71717a"; // zinc-500

const perpBasis = (n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] => {
  const helper = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(n, helper).normalize();
  const w = new THREE.Vector3().crossVectors(n, u).normalize();
  return [u, w];
};

/** A subspace drawn as a quiet translucent disc (plane) with a label */
export function SubspacePlane({
  normal,
  color,
  label,
}: {
  normal: Vec3;
  color?: string;
  label: string;
}) {
  const tint = color ?? COLSPACE;
  const { quaternion, labelPos } = useMemo(() => {
    const n = new THREE.Vector3(...normal).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const [u] = perpBasis(n);
    return { quaternion: q, labelPos: u.multiplyScalar(4.6) };
  }, [normal]);
  return (
    <group>
      <mesh quaternion={quaternion}>
        <circleGeometry args={[5.2, 48]} />
        <meshBasicMaterial color={tint} transparent opacity={0.05} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Html position={labelPos} center style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
        <span className="select-none whitespace-nowrap text-[10px]" style={{ color: tint }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/** A subspace drawn as a quiet dashed line with a label */
export function SubspaceLine({
  dir,
  color,
  label,
}: {
  dir: Vec3;
  color?: string;
  label: string;
}) {
  const tint = color ?? NULLSPACE;
  const L = 5;
  return (
    <group>
      <Line
        points={[
          [-dir[0] * L, -dir[1] * L, -dir[2] * L],
          [dir[0] * L, dir[1] * L, dir[2] * L],
        ]}
        color={tint}
        transparent
        opacity={0.45}
        dashed
        dashSize={0.1}
        gapSize={0.14}
        lineWidth={1}
      />
      <Html
        position={[dir[0] * (L + 0.5), dir[1] * (L + 0.5), dir[2] * (L + 0.5)]}
        center
        style={{ pointerEvents: "none" }}
        zIndexRange={[10, 0]}
      >
        <span className="select-none whitespace-nowrap text-[10px]" style={{ color: tint }}>
          {label}
        </span>
      </Html>
    </group>
  );
}

/** The parallelogram spanned by two (displayed) vectors — their span made visible */
export function SpanParallelogram({ a, b }: { a: Vec3; b: Vec3 }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = [
      0, 0, 0, a[0], a[1], a[2], a[0] + b[0], a[1] + b[1], a[2] + b[2],
      0, 0, 0, a[0] + b[0], a[1] + b[1], a[2] + b[2], b[0], b[1], b[2],
    ];
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, [a, b]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
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
  color = COLOR.vector,
}: {
  tip: Vec3;
  onDrag: (p: Vec3) => void;
  /** fixed drag plane normal (e.g. z for a 2D domain); camera-facing when omitted */
  planeNormal?: Vec3;
  color?: string;
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
      <meshBasicMaterial color={color} transparent opacity={hovered || dragging ? 0.95 : 0.35} />
    </mesh>
  );
}
