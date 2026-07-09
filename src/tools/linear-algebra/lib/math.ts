import { Vector } from "./stores/useVectorStore";
import { Matrix } from "./stores/useMatrixStore";
import { create, all } from "mathjs";

// Configure math.js for our needs
const math = create(all);

/**
 * Apply a matrix transformation to a vector
 * @param matrix The transformation matrix
 * @param vector The vector to transform
 * @returns A new transformed vector or null if incompatible dimensions
 */
export function applyMatrixTransformation(
  matrix: Matrix,
  vector: Vector
): Vector | null {
  // Exit early if the vector is already transformed to avoid loops
  if (vector.isTransformed) {
    return null;
  }

  const [mRows, mCols] = matrix.dimension.split('x').map(Number);
  const vDim = vector.components.length;
  
  // Strict mathematical compatibility check: matrix columns must match vector dimension
  // For matrix-vector multiplication: (m×n) * (n×1) = (m×1)
  if (mCols !== vDim) {
    // Don't log a warning - this is expected in the UI when dimensions don't match
    return null;
  }
  
  try {
    // Convert to math.js matrix and vector
    const matrixArray = matrix.values;
    const vectorArray = vector.components;
    
    // Perform matrix multiplication
    const result = math.multiply(matrixArray, vectorArray);
    
    // Convert result back to array
    const resultArray = Array.isArray(result) ? result : [result];
    
    // Round values to 6 decimal places to avoid floating point issues
    const roundedArray = resultArray.map(val => Math.round(val * 1000000) / 1000000);
    
    // Generate a stable, unique ID to avoid recreating the same vector
    const uniqueId = `transformed-${vector.id}-${Date.now()}`;
    
    // Create a new vector with the transformed components
    return {
      id: uniqueId,
      components: roundedArray,
      color: vector.color,
      label: `${vector.label} - T`,
      visible: vector.visible, // Match original visibility
      isTransformed: true,
      originalId: vector.id,
      opacity: 0.6  // Make transformed vectors semi-transparent
    };
  } catch (error) {
    console.error("Error applying transformation:", error);
    return null;
  }
}

/**
 * Calculate the magnitude (length) of a vector
 * @param components Vector components
 * @returns The magnitude of the vector
 */
export function calculateMagnitude(components: number[]): number {
  return Math.sqrt(components.reduce((sum, component) => sum + component * component, 0));
}

/**
 * Calculate the dot product of two vectors
 * @param v1 First vector components
 * @param v2 Second vector components
 * @returns The dot product or null if dimensions don't match
 */
export function dotProduct(v1: number[], v2: number[]): number | null {
  if (v1.length !== v2.length) {
    return null;
  }
  
  return v1.reduce((sum, component, index) => sum + component * v2[index], 0);
}

/**
 * Calculate the cross product of two 3D vectors
 * @param v1 First vector components
 * @param v2 Second vector components
 * @returns The cross product or null if both aren't 3D
 */
export function crossProduct(v1: number[], v2: number[]): number[] | null {
  if (v1.length !== 3 || v2.length !== 3) {
    return null;
  }
  
  return [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0]
  ];
}

/**
 * Calculate the Euclidean distance between two vectors
 * @param v1 First vector components
 * @param v2 Second vector components
 * @returns The distance between vectors or null if dimensions don't match
 */
export function vectorDistance(v1: number[], v2: number[]): number | null {
  if (v1.length !== v2.length) {
    return null;
  }
  
  let sumSquared = 0;
  for (let i = 0; i < v1.length; i++) {
    sumSquared += Math.pow(v1[i] - v2[i], 2);
  }
  
  return Math.sqrt(sumSquared);
}

/**
 * Calculate the angle between two vectors in radians
 * @param v1 First vector components
 * @param v2 Second vector components
 * @returns The angle in radians or null if dimensions don't match
 */
export function angleBetweenVectors(v1: number[], v2: number[]): number | null {
  const dot = dotProduct(v1, v2);
  if (dot === null) return null;
  
  const mag1 = calculateMagnitude(v1);
  const mag2 = calculateMagnitude(v2);
  
  if (mag1 === 0 || mag2 === 0) return null;
  
  // Use Math.min to handle floating point errors that may cause the ratio to be slightly > 1
  return Math.acos(Math.min(1, dot / (mag1 * mag2)));
}

/**
 * Calculate the determinant of a matrix
 * @param matrix The matrix to analyze
 * @returns The determinant or null if not a square matrix
 */
export function calculateDeterminant(matrix: Matrix): number | null {
  try {
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    if (rows !== cols) return null;
    
    return math.det(matrix.values);
  } catch (error) {
    console.error("Error calculating determinant:", error);
    return null;
  }
}

/**
 * Calculate the trace of a matrix (sum of diagonal elements)
 * @param matrix The matrix to analyze
 * @returns The trace or null if not a square matrix
 */
export function calculateTrace(matrix: Matrix): number | null {
  const [rows, cols] = matrix.dimension.split('x').map(Number);
  if (rows !== cols) return null;
  
  let trace = 0;
  for (let i = 0; i < rows; i++) {
    trace += matrix.values[i][i];
  }
  
  return trace;
}

export interface ComplexValue {
  re: number;
  im: number;
}

export interface EigenResult {
  /** All eigenvalues, possibly complex (e.g. rotations) */
  eigenvalues: ComplexValue[];
  /** Real eigenvalue/eigenvector pairs — the ones that can be drawn in 3D space */
  realEigenpairs: { value: number; vector: number[] }[];
}

// mathjs returns plain numbers for real values and Complex objects otherwise
function toComplex(v: unknown): ComplexValue {
  if (typeof v === "number") return { re: v, im: 0 };
  const c = v as { re?: number; im?: number };
  return { re: c.re ?? 0, im: c.im ?? 0 };
}

/**
 * Calculate the eigendecomposition of a square matrix using math.js.
 * Complex eigenvalues (rotations) are reported; eigenvectors are returned
 * only for real eigenpairs. Defective matrices may have fewer eigenvectors
 * than eigenvalues.
 */
export function calculateEigen(matrix: Matrix): EigenResult | null {
  try {
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    if (rows !== cols) return null;

    const result = math.eigs(matrix.values);
    const rawValues = (result.values as { valueOf(): unknown[] }).valueOf();
    const eigenvalues = rawValues.map(toComplex);

    const realEigenpairs: { value: number; vector: number[] }[] = [];
    for (const pair of result.eigenvectors ?? []) {
      const value = toComplex(pair.value);
      if (Math.abs(value.im) > 1e-9) continue;

      const rawVector = (pair.vector as { valueOf(): unknown[] }).valueOf();
      const components = rawVector.map(toComplex);
      if (components.some((c) => Math.abs(c.im) > 1e-9)) continue;

      let vector = components.map((c) => c.re);
      const magnitude = Math.hypot(...vector);
      if (magnitude < 1e-12) continue;
      vector = vector.map((x) => x / magnitude);

      realEigenpairs.push({ value: value.re, vector });
    }

    return { eigenvalues, realEigenpairs };
  } catch (error) {
    console.error("Error calculating eigendecomposition:", error);
    return null;
  }
}

/**
 * Calculate the singular values of a matrix: the square roots of the
 * eigenvalues of MᵀM (which is symmetric, so its eigenvalues are real).
 * Works for square and non-square matrices.
 */
export function calculateSingularValues(matrix: Matrix): number[] | null {
  try {
    const a = matrix.values;
    const ata = math.multiply(math.transpose(a), a) as number[][];
    const rawValues = (math.eigs(ata).values as { valueOf(): unknown[] }).valueOf();

    return rawValues
      .map(toComplex)
      .map((v) => Math.sqrt(Math.max(0, v.re)))
      .sort((x, y) => y - x)
      .map((v) => Math.round(v * 10000) / 10000);
  } catch (error) {
    console.error("Error calculating singular values:", error);
    return null;
  }
}

/**
 * Interpolate a square matrix with the identity: M(t) = (1-t)·I + t·A.
 * At t=0 this is the identity (nothing happens), at t=1 the full transform.
 * Note (1-t)v + t·Av = M(t)v, so lerping transformed points is exactly
 * equivalent to applying the interpolated matrix.
 */
export function interpolateWithIdentity(values: number[][], t: number): number[][] {
  return values.map((row, i) =>
    row.map((v, j) => (i === j ? (1 - t) + t * v : t * v))
  );
}

/**
 * Check if a matrix is invertible
 * @param matrix The matrix to analyze
 * @returns Boolean indicating if matrix is invertible or null if not a square matrix
 */
export function isMatrixInvertible(matrix: Matrix): boolean | null {
  try {
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    if (rows !== cols) return null;
    
    const det = calculateDeterminant(matrix);
    
    // Matrix is invertible if determinant is not zero
    return det !== null && Math.abs(det) > 1e-10;
  } catch (error) {
    console.error("Error checking if matrix is invertible:", error);
    return null;
  }
}
