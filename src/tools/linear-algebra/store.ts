/**
 * The tool's single store. Everything in the scene derives from two values:
 * the matrix A and the animation parameter t — the space you see is always
 * lerp(I, A, t) applied to the untouched model space.
 */
import { create } from "zustand";
import { IDENTITY, entryIndex, type Mat3, type Vec3 } from "./lib/mat3";

export interface UserVector {
  id: string;
  v: Vec3;
  label: string;
}

interface LinAlgState {
  /** The transformation, exactly as typed */
  matrix: Mat3;
  /** 0 = identity (home), 1 = the full transformation */
  t: number;
  vectors: UserVector[];

  setEntry: (row: number, col: number, value: number) => void;
  setMatrix: (m: Mat3) => void;
  setT: (t: number) => void;
  setVector: (id: string, v: Vec3) => void;
  reset: () => void;
}

export const useLinAlg = create<LinAlgState>((set) => ({
  matrix: [...IDENTITY] as Mat3,
  t: 1,
  vectors: [{ id: "v", v: [2, 1.5, -1], label: "v" }],

  setEntry: (row, col, value) =>
    set((s) => {
      const matrix = [...s.matrix] as Mat3;
      matrix[entryIndex(row, col)] = value;
      return { matrix };
    }),
  setMatrix: (matrix) => set({ matrix }),
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  setVector: (id, v) =>
    set((s) => ({ vectors: s.vectors.map((u) => (u.id === id ? { ...u, v } : u)) })),
  reset: () => set({ matrix: [...IDENTITY] as Mat3, t: 1 }),
}));
