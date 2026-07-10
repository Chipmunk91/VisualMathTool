/**
 * The tool's single store. Everything in the scene derives from the matrix A
 * (padded 3×3, rows×cols visible), the optional journey it belongs to
 * (compose with B, undo with A⁻¹, or the SVD story), the global scrub T,
 * and the vectors living in the input space.
 */
import { create } from "zustand";
import { blockIdentity, entryIndex, type Dim, type Mat3, type Vec3 } from "./lib/mat3";
import type { JourneyKind } from "./lib/journey";

export interface UserVector {
  id: string;
  v: Vec3;
  label: string;
  color: string;
}

const V_COLOR = "#f59e0b"; // amber-500
const W_COLOR = "#c026d3"; // fuchsia-600

export interface SharedState {
  rows: Dim;
  cols: Dim;
  matrix: Mat3;
  matrixB: Mat3;
  journey: JourneyKind;
  t: number;
  vectors: Vec3[];
}

interface LinAlgState {
  matrix: Mat3;
  /** second matrix for the composition journey (applied after A) */
  matrixB: Mat3;
  rows: Dim;
  cols: Dim;
  journey: JourneyKind;
  /** global journey progress: 0 … number of stages */
  t: number;
  vectors: UserVector[];

  setEntry: (row: number, col: number, value: number) => void;
  setEntryB: (row: number, col: number, value: number) => void;
  setMatrix: (m: Mat3) => void;
  setMatrixB: (m: Mat3) => void;
  setDims: (rows: Dim, cols: Dim) => void;
  transpose: () => void;
  setJourney: (journey: JourneyKind) => void;
  setT: (t: number) => void;
  setVector: (id: string, v: Vec3) => void;
  addSecondVector: () => void;
  removeSecondVector: () => void;
  applyShared: (s: SharedState) => void;
  reset: () => void;
}

const clampVectors = (vectors: UserVector[], cols: Dim): UserVector[] =>
  cols === 2 ? vectors.map((u) => ({ ...u, v: [u.v[0], u.v[1], 0] as Vec3 })) : vectors;

/** The natural resting point of each journey's scrub */
const restingT = (journey: JourneyKind): number =>
  journey === "single" ? 1 : journey === "compose" ? 2 : journey === "inverse" ? 1 : 0;

export const useLinAlg = create<LinAlgState>((set) => ({
  matrix: blockIdentity(3, 3),
  matrixB: blockIdentity(3, 3),
  rows: 3,
  cols: 3,
  journey: "single",
  t: 1,
  vectors: [{ id: "v", v: [2, 1.5, -1], label: "v", color: V_COLOR }],

  setEntry: (row, col, value) =>
    set((s) => {
      const matrix = [...s.matrix] as Mat3;
      matrix[entryIndex(row, col)] = value;
      return { matrix };
    }),
  setEntryB: (row, col, value) =>
    set((s) => {
      const matrixB = [...s.matrixB] as Mat3;
      matrixB[entryIndex(row, col)] = value;
      return { matrixB };
    }),
  setMatrix: (matrix) => set({ matrix }),
  setMatrixB: (matrixB) => set({ matrixB }),
  setDims: (rows, cols) =>
    set((s) => {
      const repad = (src: Mat3): Mat3 => {
        const m: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            m[entryIndex(r, c)] = r < s.rows && c < s.cols ? src[entryIndex(r, c)] : r === c ? 1 : 0;
        return m;
      };
      return {
        rows,
        cols,
        matrix: repad(s.matrix),
        matrixB: blockIdentity(rows, cols),
        journey: "single",
        t: 1,
        vectors: clampVectors(s.vectors, cols),
      };
    }),
  transpose: () =>
    set((s) => {
      const matrix: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let r = 0; r < s.cols; r++)
        for (let c = 0; c < s.rows; c++) matrix[entryIndex(r, c)] = s.matrix[entryIndex(c, r)];
      return {
        rows: s.cols,
        cols: s.rows,
        matrix,
        matrixB: blockIdentity(s.cols, s.rows),
        journey: "single",
        t: 1,
        vectors: clampVectors(s.vectors, s.rows),
      };
    }),
  setJourney: (journey) => set({ journey, t: restingT(journey) }),
  setT: (t) => set({ t: Math.max(0, t) }),
  setVector: (id, v) =>
    set((s) => ({
      vectors: s.vectors.map((u) =>
        u.id === id ? { ...u, v: s.cols === 2 ? ([v[0], v[1], 0] as Vec3) : v } : u
      ),
    })),
  addSecondVector: () =>
    set((s) =>
      s.vectors.length >= 2
        ? s
        : {
            vectors: [
              ...s.vectors,
              {
                id: "w",
                v: (s.cols === 2 ? [-1, 1, 0] : [-1, 1, 0.5]) as Vec3,
                label: "w",
                color: W_COLOR,
              },
            ],
          }
    ),
  removeSecondVector: () => set((s) => ({ vectors: s.vectors.filter((u) => u.id !== "w") })),
  applyShared: (shared) =>
    set(() => ({
      rows: shared.rows,
      cols: shared.cols,
      matrix: shared.matrix,
      matrixB: shared.matrixB,
      journey: shared.journey,
      t: shared.t,
      vectors: shared.vectors.map((v, i) =>
        i === 0
          ? { id: "v", v, label: "v", color: V_COLOR }
          : { id: "w", v, label: "w", color: W_COLOR }
      ),
    })),
  reset: () =>
    set((s) => ({
      matrix: blockIdentity(s.rows, s.cols),
      matrixB: blockIdentity(s.rows, s.cols),
      journey: "single",
      t: 1,
    })),
}));
