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

/** The linear map as a THREE.Matrix4 — the entire transformed world is one matrix. */
export const toMatrix4 = (m: Mat3): THREE.Matrix4 =>
  // Matrix4.set takes row-major arguments
  new THREE.Matrix4().set(m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1);
