/**
 * Column space and null space, extracted geometrically. Only rank-deficient
 * shapes produce something to draw — a full-rank square map's image is
 * everything and its null space is a point.
 */
import type { Dim, Mat3, Vec3 } from "./mat3";

const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const EPS = 1e-8;

export interface Subspace {
  kind: "all" | "plane" | "line" | "point";
  /** unit normal for a plane */
  normal?: Vec3;
  /** unit direction for a line */
  dir?: Vec3;
}

const columnsOf = (m: Mat3, cols: Dim): Vec3[] =>
  Array.from({ length: cols }, (_, i) => [m[3 * i], m[3 * i + 1], m[3 * i + 2]] as Vec3);

const rowsOf = (m: Mat3, rows: Dim, cols: Dim): Vec3[] =>
  Array.from(
    { length: rows },
    (_, r) => [m[r], m[3 + r], cols === 3 ? m[6 + r] : 0] as Vec3
  );

export function rankOf(m: Mat3, rows: Dim, cols: Dim): number {
  const cs = columnsOf(m, cols);
  // volume test (only possible when both dims are 3)
  if (rows === 3 && cols === 3) {
    const vol = cs[0][0] * (cs[1][1] * cs[2][2] - cs[1][2] * cs[2][1])
      - cs[1][0] * (cs[0][1] * cs[2][2] - cs[0][2] * cs[2][1])
      + cs[2][0] * (cs[0][1] * cs[1][2] - cs[0][2] * cs[1][1]);
    if (Math.abs(vol) > EPS) return 3;
  }
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) if (norm(cross(cs[i], cs[j])) > EPS) return 2;
  return cs.some((c) => norm(c) > EPS) ? 1 : 0;
}

/** Where the map can land (a subspace of the output space) */
export function columnSpace(m: Mat3, rows: Dim, cols: Dim): Subspace {
  const rank = rankOf(m, rows, cols);
  if (rank >= rows) return { kind: "all" };
  if (rank === 2) {
    const cs = columnsOf(m, cols);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) {
        const n = cross(cs[i], cs[j]);
        const len = norm(n);
        if (len > EPS) return { kind: "plane", normal: scale(n, 1 / len) };
      }
  }
  if (rank === 1) {
    const c = columnsOf(m, cols).reduce((a, b) => (norm(a) >= norm(b) ? a : b));
    return { kind: "line", dir: scale(c, 1 / norm(c)) };
  }
  return { kind: "point" };
}

/** What the map crushes to zero (a subspace of the input space) */
export function nullSpace(m: Mat3, rows: Dim, cols: Dim): Subspace {
  const rank = rankOf(m, rows, cols);
  const nullDim = cols - rank;
  if (nullDim <= 0) return { kind: "point" };
  const rs = rowsOf(m, rows, cols).filter((r) => norm(r) > EPS);
  if (nullDim === 1) {
    if (cols === 3) {
      // perpendicular to the row space (a plane of rows)
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) {
          const n = cross(rs[i], rs[j]);
          const len = norm(n);
          if (len > EPS) return { kind: "line", dir: scale(n, 1 / len) };
        }
      return { kind: "point" };
    }
    // 2D domain: perpendicular (in-plane) to the single row direction
    const r = rs[0];
    const d: Vec3 = [-r[1], r[0], 0];
    const len = norm(d);
    return len > EPS ? { kind: "line", dir: scale(d, 1 / len) } : { kind: "point" };
  }
  if (nullDim === 2 && cols === 3 && rs.length > 0) {
    // everything perpendicular to the one surviving row direction
    const r = rs[0];
    return { kind: "plane", normal: scale(r, 1 / norm(r)) };
  }
  return { kind: "all" }; // the zero map
}
