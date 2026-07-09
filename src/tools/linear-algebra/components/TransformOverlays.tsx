import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { useMatrixStore, isIdentityMatrix } from "../lib/stores/useMatrixStore";
import { calculateEigen, interpolateWithIdentity } from "../lib/math";
import { BASIS_COLORS } from "../lib/colors";

/**
 * Shared helpers for visualizing M(t) = (1-t)·I + t·A.
 * Since (1-t)v + t·Av = M(t)v, we can animate any point by lerping it
 * with its fully-transformed image.
 */

// Embed a 2D or 3D point in 3D space
const embed = (p: number[]): THREE.Vector3 =>
  new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

// Multiply matrix by point (using the first `cols` components as input)
const applyMatrix = (values: number[][], p: number[]): number[] =>
  values.map((row) => row.reduce((sum, v, j) => sum + v * (p[j] ?? 0), 0));

// The animated image of a point: lerp(p, A·p, t)
const mapPoint = (values: number[][], p: number[], t: number): THREE.Vector3 =>
  embed(p).lerp(embed(applyMatrix(values, p)), t);

const det = (m: number[][]): number => {
  if (m.length === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
};

// Reusable arrow mesh from the origin to `tip`
const Arrow = ({ tip, color, opacity, label }: {
  tip: THREE.Vector3;
  color: string;
  opacity: number;
  label?: string;
}) => {
  const { camera } = useThree();
  const length = tip.length();
  if (length < 1e-6) return null;

  const direction = tip.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction
  );
  const mid = tip.clone().multiplyScalar(0.5);

  return (
    <group>
      <mesh position={mid} quaternion={quaternion} scale={[0.04, length, 0.04]}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={tip} quaternion={quaternion}>
        <coneGeometry args={[0.12, 0.35, 12]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {label && (
        <Text
          position={tip.clone().add(direction.clone().multiplyScalar(0.55))}
          fontSize={0.35}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.04}
          outlineColor="#222222"
          quaternion={camera.quaternion}
        >
          {label}
        </Text>
      )}
    </group>
  );
};

const BASIS_LABELS = ["î′", "ĵ′", "k̂′"];

/**
 * Where the basis vectors land: T(e_j) is literally column j of the matrix.
 * Animated with the transformation progress t.
 */
export const TransformedBasis = () => {
  const { matrix, animationT } = useMatrixStore();
  const values = matrix.values;
  const cols = values[0]?.length ?? 0;

  if (isIdentityMatrix(values)) return null;

  const arrows = [];
  for (let j = 0; j < cols; j++) {
    const basis = [0, 0, 0].map((_, k) => (k === j ? 1 : 0)).slice(0, cols);
    const tip = mapPoint(values, basis, animationT);
    // Skip columns that don't move their basis vector (e.g. k̂ under a Z-rotation)
    if (tip.distanceTo(embed(basis)) < 0.01) continue;
    arrows.push(
      <Arrow key={j} tip={tip} color={BASIS_COLORS[j]} opacity={0.9} label={BASIS_LABELS[j]} />
    );
  }

  return <>{arrows}</>;
};

// Corner indices of the unit cube: bit 0 → x, bit 1 → y, bit 2 → z
const CUBE_CORNERS = Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
const CUBE_FACES = [
  [0, 1, 3, 2], [4, 6, 7, 5], // z = 0, z = 1
  [0, 4, 5, 1], [2, 3, 7, 6], // y = 0, y = 1
  [0, 2, 6, 4], [1, 5, 7, 3], // x = 0, x = 1
];
const CUBE_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const SQUARE_CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const SQUARE_FACES = [[0, 1, 3, 2]];
const SQUARE_EDGES = [[0, 1], [1, 3], [3, 2], [2, 0]];

/**
 * The unit cube (or unit square for 2×2) carried through M(t).
 * Its volume is |det M(t)| — the determinant made visible. Orientation
 * flips (negative determinant) switch the color to orange.
 */
export const DeterminantVolume = () => {
  const { matrix, animationT } = useMatrixStore();
  const { camera } = useThree();
  const values = matrix.values;
  const [rows, cols] = matrix.dimension.split("x").map(Number);
  const isSquare = rows === cols;
  const is2D = cols === 2;

  const corners = useMemo(() => {
    if (!isSquare) return [];
    const base = is2D ? SQUARE_CORNERS : CUBE_CORNERS;
    return base.map((c) => mapPoint(values, c, animationT));
  }, [values, animationT, isSquare, is2D]);

  const { faceGeometry, edgeGeometry } = useMemo(() => {
    if (corners.length === 0) return { faceGeometry: null, edgeGeometry: null };

    const faces = is2D ? SQUARE_FACES : CUBE_FACES;
    const edges = is2D ? SQUARE_EDGES : CUBE_EDGES;

    const positions = new Float32Array(corners.flatMap((c) => [c.x, c.y, c.z]));
    const indices = faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);

    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    faceGeometry.setIndex(indices);
    faceGeometry.computeVertexNormals();

    const edgePositions = new Float32Array(
      edges.flatMap(([a, b]) => [
        corners[a].x, corners[a].y, corners[a].z,
        corners[b].x, corners[b].y, corners[b].z,
      ])
    );
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));

    return { faceGeometry, edgeGeometry };
  }, [corners, is2D]);

  useEffect(() => {
    return () => {
      faceGeometry?.dispose();
      edgeGeometry?.dispose();
    };
  }, [faceGeometry, edgeGeometry]);

  if (!isSquare || !faceGeometry || !edgeGeometry) return null;

  // Determinant of the interpolated matrix M(t)
  const d = det(interpolateWithIdentity(values, animationT));
  const color = d < 0 ? "#F97316" : "#3B82F6";

  // Label near the image of the far corner of the cube/square
  const farCorner = mapPoint(values, is2D ? [1, 1] : [1, 1, 1], animationT);
  const labelText = is2D
    ? `det = ${d.toFixed(2)}  (area ×${Math.abs(d).toFixed(2)})`
    : `det = ${d.toFixed(2)}  (volume ×${Math.abs(d).toFixed(2)})`;

  return (
    <group>
      <mesh geometry={faceGeometry}>
        <meshStandardMaterial color={color} transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial color={color} transparent opacity={0.9} />
      </lineSegments>
      <Text
        position={farCorner.clone().add(new THREE.Vector3(0, 0, 0.5))}
        fontSize={0.32}
        color={color}
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.04}
        outlineColor="#222222"
        quaternion={camera.quaternion}
      >
        {labelText}
      </Text>
      {d < 0 && (
        <Text
          position={farCorner.clone().add(new THREE.Vector3(0, 0, 1.0))}
          fontSize={0.24}
          color={color}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.03}
          outlineColor="#222222"
          quaternion={camera.quaternion}
        >
          orientation flipped
        </Text>
      )}
    </group>
  );
};

/**
 * The image of the XY-plane grid under M(t). Because the map is linear,
 * grid lines stay lines — only their endpoints need transforming.
 */
export const TransformedGrid = () => {
  const { matrix, animationT } = useMatrixStore();
  const values = matrix.values;
  const [rows, cols] = matrix.dimension.split("x").map(Number);
  const isSquare = rows === cols;

  const geometry = useMemo(() => {
    if (!isSquare) return null;
    const half = 5;
    const points: number[] = [];
    for (let k = -half; k <= half; k++) {
      // Lines parallel to the X-axis and to the Y-axis, in the input XY-plane
      const segments = [
        [[-half, k], [half, k]],
        [[k, -half], [k, half]],
      ];
      for (const [from, to] of segments) {
        const a = mapPoint(values, cols === 2 ? from : [...from, 0], animationT);
        const b = mapPoint(values, cols === 2 ? to : [...to, 0], animationT);
        points.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points), 3));
    return geometry;
  }, [values, animationT, isSquare, cols]);

  useEffect(() => {
    return () => geometry?.dispose();
  }, [geometry]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#14B8A6" transparent opacity={0.55} />
    </lineSegments>
  );
};

const EIGEN_COLORS = ["#F59E0B", "#D946EF", "#06B6D4"];

/**
 * Real eigenvectors drawn as axes through the origin: the directions the
 * matrix only stretches (by λ), never rotates. Not animated — these are
 * a property of the full matrix A.
 */
export const EigenvectorAxes = () => {
  const { matrix } = useMatrixStore();
  const { camera } = useThree();
  const [rows, cols] = matrix.dimension.split("x").map(Number);
  const isSquare = rows === cols;

  const eigen = useMemo(
    () => (isSquare ? calculateEigen(matrix) : null),
    [matrix, isSquare]
  );

  if (!eigen || eigen.realEigenpairs.length === 0) return null;

  const axisLength = 6;

  return (
    <>
      {eigen.realEigenpairs.map((pair, idx) => {
        const direction = embed(pair.vector).normalize();
        const from = direction.clone().multiplyScalar(-axisLength);
        const to = direction.clone().multiplyScalar(axisLength);
        const color = EIGEN_COLORS[idx % EIGEN_COLORS.length];
        const positions = new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]);
        return (
          <group key={idx}>
            <lineSegments>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={color} transparent opacity={0.8} />
            </lineSegments>
            <Text
              position={direction.clone().multiplyScalar(axisLength + 0.5)}
              fontSize={0.32}
              color={color}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.04}
              outlineColor="#222222"
              quaternion={camera.quaternion}
            >
              {`λ = ${pair.value.toFixed(2)}`}
            </Text>
          </group>
        );
      })}
    </>
  );
};
