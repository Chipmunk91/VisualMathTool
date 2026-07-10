/**
 * A journey is a sequence of stage matrices played left to right; the global
 * scrub T runs from 0 to stages.length. Composition, inverse playback, and
 * the SVD story are all the same machine with different stage lists.
 */
import {
  baseFor,
  invert,
  invert2,
  lerpMat,
  matMul,
  IDENTITY,
  type Dim,
  type Mat3,
} from "./mat3";
import { svd } from "./svd";

export type JourneyKind = "single" | "compose" | "inverse" | "svd";

export interface Stage {
  label: string;
  m: Mat3;
}

/** The stage list for the current journey; falls back to single when a
 *  derived journey (inverse, svd) cannot be computed. */
export function stagesFor(
  journey: JourneyKind,
  matrix: Mat3,
  matrixB: Mat3,
  rows: Dim,
  cols: Dim
): Stage[] {
  const single: Stage[] = [{ label: "A", m: matrix }];
  if (journey === "compose" && rows === cols) {
    return [
      { label: "A", m: matrix },
      { label: "B", m: matrixB },
    ];
  }
  if (journey === "inverse" && rows === cols) {
    const inv = rows === 3 ? invert(matrix) : invert2(matrix);
    if (inv) return [{ label: "A", m: matrix }, { label: "A⁻¹", m: inv }];
  }
  if (journey === "svd" && rows === cols) {
    const result = svd(matrix, rows);
    if (result) {
      return [
        { label: "rotate (Vᵀ)", m: result.Vt },
        { label: "stretch (Σ)", m: result.S },
        { label: "rotate (U)", m: result.U },
      ];
    }
  }
  return single;
}

/** The full end-to-end matrix of a journey (all stages applied) */
export const journeyProduct = (stages: Stage[]): Mat3 =>
  stages.reduce<Mat3>((acc, s) => matMul(s.m, acc), [...IDENTITY] as Mat3);

/**
 * The matrix the scene shows at global progress T: completed stages composed,
 * the current stage interpolated. The first stage interpolates from the
 * dimension-aware base (all of R³, or the plane sitting in place).
 */
export function effectiveAt(stages: Stage[], T: number, cols: Dim): Mat3 {
  const base = baseFor(cols);
  if (stages.length === 0) return base;
  const Tc = Math.min(stages.length, Math.max(0, T));
  const k = Math.min(stages.length - 1, Math.floor(Tc));
  const t = Tc - k;
  let done: Mat3 = [...IDENTITY] as Mat3;
  for (let i = 0; i < k; i++) done = matMul(stages[i].m, done);
  const from = k === 0 ? base : ([...IDENTITY] as Mat3);
  const current = lerpMat(from, stages[k].m, t);
  const composed = matMul(current, done);
  // a 2D domain admits nothing along z — keep the padding exact
  return cols === 2 ? matMul(composed, base) : composed;
}
