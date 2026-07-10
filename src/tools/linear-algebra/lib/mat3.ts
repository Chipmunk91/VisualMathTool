/**
 * Pure 3×3 matrix math. Matrices are column-major number arrays:
 * [ix, iy, iz,  jx, jy, jz,  kx, ky, kz] — the columns are exactly where
 * the basis vectors î, ĵ, k̂ land, which is the whole story of the tool.
 */
import * as THREE from "three";

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const lerpMat = (a: Mat3, b: Mat3, t: number): Mat3 =>
  a.map((v, i) => v + (b[i] - v) * t) as Mat3;

export const column = (m: Mat3, i: 0 | 1 | 2): Vec3 => [m[3 * i], m[3 * i + 1], m[3 * i + 2]];

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

export const det = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[3] * (m[1] * m[8] - m[2] * m[7]) +
  m[6] * (m[1] * m[5] - m[2] * m[4]);

export const isIdentity = (m: Mat3, eps = 1e-9): boolean =>
  m.every((v, i) => Math.abs(v - IDENTITY[i]) < eps);

/** Row/col (as written on screen) → column-major storage index */
export const entryIndex = (row: number, col: number): number => col * 3 + row;

export type Dim = 2 | 3;

export const matEquals = (a: Mat3, b: Mat3, eps = 1e-9): boolean =>
  a.every((v, i) => Math.abs(v - b[i]) < eps);

/** The untransformed view of the domain: all of R^3, or the xy-plane sitting in place */
export const baseFor = (cols: Dim): Mat3 => (cols === 3 ? [...IDENTITY] as Mat3 : [1, 0, 0, 0, 1, 0, 0, 0, 0]);

/** Identity pattern inside the visible rows×cols block, zeros outside */
export const blockIdentity = (rows: Dim, cols: Dim): Mat3 => {
  const m: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) m[entryIndex(r, c)] = r === c ? 1 : 0;
  return m;
};

/** Inverse via adjugate; null when the matrix is (numerically) singular. */
export function invert(m: Mat3): Mat3 | null {
  const d = det(m);
  if (Math.abs(d) < 1e-10) return null;
  const [a, b, c, e, f, g, h, i, j] = m; // columns: (a,b,c) (e,f,g) (h,i,j)
  const inv: Mat3 = [
    (f * j - g * i) / d, (c * i - b * j) / d, (b * g - c * f) / d,
    (g * h - e * j) / d, (a * j - c * h) / d, (c * e - a * g) / d,
    (e * i - f * h) / d, (b * h - a * i) / d, (a * f - b * e) / d,
  ];
  return inv;
}

/** Inverse of the top-left 2×2 block, acting in the plane; null when singular. */
export function invert2(m: Mat3): Mat3 | null {
  const [a, c] = [m[0], m[1]]; // column 0
  const [b, d] = [m[3], m[4]]; // column 1
  const dd = a * d - b * c;
  if (Math.abs(dd) < 1e-10) return null;
  return [d / dd, -c / dd, 0, -b / dd, a / dd, 0, 0, 0, 0];
}

/** The linear map as a THREE.Matrix4 — the entire transformed world is one matrix. */
export const toMatrix4 = (m: Mat3): THREE.Matrix4 =>
  // Matrix4.set takes row-major arguments
  new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1);
