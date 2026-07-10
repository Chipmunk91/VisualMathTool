/**
 * The tool's single store. Everything in the scene derives from the matrix A,
 * its dimensions (rows = output space, cols = input space), and the scrub t —
 * the space you see is always lerp(base, A, t) applied to untouched model space.
 *
 * A is stored as a padded 3×3: entries outside the visible rows×cols block are
 * zero, which makes the padded matrix literally the map R³ → R³ that the
 * scene renders (a 2×3 kills z on the way out; a 3×2 has nothing along z
 * coming in).
 */
import { create } from "zustand";
import { blockIdentity, entryIndex, type Dim, type Mat3, type Vec3 } from "./lib/mat3";

export interface UserVector {
  id: string;
  v: Vec3;
  label: string;
}

interface LinAlgState {
  /** The transformation, exactly as typed (padded to 3×3 with zeros) */
  matrix: Mat3;
  /** Output-space dimension (number of rows as written) */
  rows: Dim;
  /** Input-space dimension (number of columns as written) — vectors live here */
  cols: Dim;
  /** 0 = the untransformed domain, 1 = the full transformation */
  t: number;
  vectors: UserVector[];

  setEntry: (row: number, col: number, value: number) => void;
  setMatrix: (m: Mat3) => void;
  setDims: (rows: Dim, cols: Dim) => void;
  transpose: () => void;
  setT: (t: number) => void;
  setVector: (id: string, v: Vec3) => void;
  reset: () => void;
}

const clampVectors = (vectors: UserVector[], cols: Dim): UserVector[] =>
  cols === 2 ? vectors.map((u) => ({ ...u, v: [u.v[0], u.v[1], 0] as Vec3 })) : vectors;

export const useLinAlg = create<LinAlgState>((set) => ({
  matrix: blockIdentity(3, 3),
  rows: 3,
  cols: 3,
  t: 1,
  vectors: [{ id: "v", v: [2, 1.5, -1], label: "v" }],

  setEntry: (row, col, value) =>
    set((s) => {
      const matrix = [...s.matrix] as Mat3;
      matrix[entryIndex(row, col)] = value;
      return { matrix };
    }),
  setMatrix: (matrix) => set({ matrix }),
  setDims: (rows, cols) =>
    set((s) => {
      const matrix: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          matrix[entryIndex(r, c)] =
            r < s.rows && c < s.cols ? s.matrix[entryIndex(r, c)] : r === c ? 1 : 0;
        }
      return { rows, cols, matrix, vectors: clampVectors(s.vectors, cols) };
    }),
  transpose: () =>
    set((s) => {
      const matrix: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < s.cols; r++)
        for (let c = 0; c < s.rows; c++) matrix[entryIndex(r, c)] = s.matrix[entryIndex(c, r)];
      return { rows: s.cols, cols: s.rows, matrix, vectors: clampVectors(s.vectors, s.rows) };
    }),
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  setVector: (id, v) =>
    set((s) => ({
      vectors: s.vectors.map((u) =>
        u.id === id ? { ...u, v: s.cols === 2 ? ([v[0], v[1], 0] as Vec3) : v } : u
      ),
    })),
  reset: () => set((s) => ({ matrix: blockIdentity(s.rows, s.cols), t: 1 })),
}));
