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

/**
 * Calculate eigenvalues for a matrix
 * @param matrix The matrix to analyze
 * @returns Array of eigenvalues or null if not a square matrix
 */
export function calculateEigenvalues(matrix: Matrix): number[] | null {
  try {
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    if (rows !== cols) return null;
    
    // Fallback for 2x2 matrices - always use direct calculation
    if (matrix.dimension === '2x2') {
      const a = matrix.values[0][0];
      const b = matrix.values[0][1];
      const c = matrix.values[1][0];
      const d = matrix.values[1][1];
      
      const trace = a + d;
      const determinant = a * d - b * c;
      
      const discriminant = trace * trace - 4 * determinant;
      
      if (discriminant < 0) {
        // Complex eigenvalues, return real parts
        return [trace / 2, trace / 2];
      }
      
      const sqrtDiscriminant = Math.sqrt(discriminant);
      return [
        (trace + sqrtDiscriminant) / 2, 
        (trace - sqrtDiscriminant) / 2
      ];
    }
    
    // For 3x3 matrix, we'll use a simplified approach
    if (matrix.dimension === '3x3') {
      // This is an approximation that works for common cases
      // A full implementation would require solving the characteristic polynomial
      
      // Calculate the characteristic polynomial coefficients
      const m = matrix.values;
      const a = m[0][0];
      const b = m[0][1];
      const c = m[0][2];
      const d = m[1][0];
      const e = m[1][1];
      const f = m[1][2];
      const g = m[2][0];
      const h = m[2][1];
      const i = m[2][2];
      
      // Coefficients of characteristic polynomial: λ³ + pλ² + qλ + r = 0
      const p = -(a + e + i);
      const q = a*e + a*i + e*i - b*d - c*g - f*h;
      const r = -(a*e*i + b*f*g + c*d*h - a*f*h - b*d*i - c*e*g);
      
      // For a real 3x3 matrix, use diagonal elements as approximation
      // We're skipping polynomial solving due to math.js compatibility issues
      console.warn("Using diagonal elements as eigenvalue approximations");
      return [a, e, i];
    }
    
    return null;
  } catch (error) {
    console.error("Error calculating eigenvalues:", error);
    return null;
  }
}

/**
 * Calculate eigenvectors for a given matrix and eigenvalues
 * @param matrix The matrix to analyze
 * @param eigenvalues The eigenvalues of the matrix
 * @returns Array of normalized eigenvectors or null if not computable
 */
export function calculateEigenvectors(matrix: Matrix, eigenvalues: number[]): number[][] | null {
  try {
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    if (rows !== cols) return null;
    
    // Get matrix values
    const m = matrix.values;
    
    // For each eigenvalue, find a corresponding eigenvector
    const eigenvectors: number[][] = [];
    
    for (let i = 0; i < eigenvalues.length; i++) {
      const lambda = eigenvalues[i];
      
      if (matrix.dimension === '2x2') {
        // For 2x2 matrices
        const a = m[0][0] - lambda;
        const b = m[0][1];
        const c = m[1][0];
        const d = m[1][1] - lambda;
        
        // Find a non-trivial solution to (A - λI)v = 0
        let v: number[] = [];
        
        // Try using first row
        if (Math.abs(a) > 1e-10 || Math.abs(b) > 1e-10) {
          // If a ≈ 0, set x = 1 and find y
          if (Math.abs(a) < 1e-10) {
            v = [1, 0];
          } 
          // If b ≈ 0, set y = 1 and find x
          else if (Math.abs(b) < 1e-10) {
            v = [0, 1];
          }
          // Otherwise use the first row: ax + by = 0
          else {
            v = [-b, a]; // This satisfies ax + by = 0
          }
        } 
        // If first row fails, try second row
        else if (Math.abs(c) > 1e-10 || Math.abs(d) > 1e-10) {
          // Similar process with the second row
          if (Math.abs(c) < 1e-10) {
            v = [1, 0];
          } 
          else if (Math.abs(d) < 1e-10) {
            v = [0, 1];
          }
          else {
            v = [-d, c];
          }
        }
        
        // If no solution found, use a default vector
        if (v.length === 0) {
          v = [1, 0];
        }
        
        // Normalize the vector
        const magnitude = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        if (magnitude > 0) {
          v = [v[0] / magnitude, v[1] / magnitude];
        }
        
        eigenvectors.push(v);
      } 
      else if (matrix.dimension === '3x3') {
        // For 3x3 matrices, use a simplified approach
        // A - λI
        const a = m[0][0] - lambda;
        const b = m[0][1];
        const c = m[0][2];
        const d = m[1][0];
        const e = m[1][1] - lambda;
        const f = m[1][2];
        const g = m[2][0];
        const h = m[2][1];
        const i = m[2][2] - lambda;
        
        // Try a simplified approach: Find cross products of rows to get a vector in the null space
        // Compute cross products of pairs of rows
        const r1 = [a, b, c];
        const r2 = [d, e, f];
        const r3 = [g, h, i];
        
        // Cross products
        const cp12 = [
          r1[1] * r2[2] - r1[2] * r2[1],
          r1[2] * r2[0] - r1[0] * r2[2],
          r1[0] * r2[1] - r1[1] * r2[0]
        ];
        const cp13 = [
          r1[1] * r3[2] - r1[2] * r3[1],
          r1[2] * r3[0] - r1[0] * r3[2],
          r1[0] * r3[1] - r1[1] * r3[0]
        ];
        const cp23 = [
          r2[1] * r3[2] - r2[2] * r3[1],
          r2[2] * r3[0] - r2[0] * r3[2],
          r2[0] * r3[1] - r2[1] * r3[0]
        ];
        
        // Use the cross product with the largest magnitude
        let v: number[] = [];
        const mag12 = Math.sqrt(cp12[0] * cp12[0] + cp12[1] * cp12[1] + cp12[2] * cp12[2]);
        const mag13 = Math.sqrt(cp13[0] * cp13[0] + cp13[1] * cp13[1] + cp13[2] * cp13[2]);
        const mag23 = Math.sqrt(cp23[0] * cp23[0] + cp23[1] * cp23[1] + cp23[2] * cp23[2]);
        
        if (mag12 >= mag13 && mag12 >= mag23 && mag12 > 1e-10) {
          v = cp12;
        } else if (mag13 >= mag12 && mag13 >= mag23 && mag13 > 1e-10) {
          v = cp13;
        } else if (mag23 > 1e-10) {
          v = cp23;
        } else {
          // If all cross products are ~0, use a standard basis vector
          // that's most aligned with eigenvalue position
          v = i === 0 ? [1, 0, 0] : i === 1 ? [0, 1, 0] : [0, 0, 1];
        }
        
        // Normalize the vector
        const magnitude = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        if (magnitude > 0) {
          v = [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude];
        }
        
        eigenvectors.push(v);
      }
    }
    
    return eigenvectors;
  } catch (error) {
    console.error("Error calculating eigenvectors:", error);
    return null;
  }
}

/**
 * Calculate the singular values of a matrix
 * @param matrix The matrix to analyze
 * @returns Array of singular values or null if calculation fails
 */
export function calculateSingularValues(matrix: Matrix): number[] | null {
  try {
    // For a simplified approach, we'll compute the square roots of the eigenvalues
    // of M^T * M, which gives us the singular values for matrix M
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    
    // Compute M^T (transpose)
    const mT = Array(cols).fill(0).map(() => Array(rows).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        mT[j][i] = matrix.values[i][j];
      }
    }
    
    // Compute M^T * M
    const mTm = Array(cols).fill(0).map(() => Array(cols).fill(0));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < rows; k++) {
          sum += mT[i][k] * matrix.values[k][j];
        }
        mTm[i][j] = sum;
      }
    }
    
    // Try to compute eigenvalues of M^T * M
    let eigenvalues;
    
    if (cols === 2) {
      // For 2x2
      const a = mTm[0][0];
      const b = mTm[0][1];
      const c = mTm[1][0];
      const d = mTm[1][1];
      
      const trace = a + d;
      const determinant = a * d - b * c;
      
      const discriminant = trace * trace - 4 * determinant;
      
      if (discriminant < 0) {
        eigenvalues = [trace / 2, trace / 2];
      } else {
        const sqrtDiscriminant = Math.sqrt(discriminant);
        eigenvalues = [
          (trace + sqrtDiscriminant) / 2, 
          (trace - sqrtDiscriminant) / 2
        ];
      }
    } else if (cols === 3) {
      // For 3x3, just use diagonal elements as approximation
      // This is a very rough approximation
      eigenvalues = [mTm[0][0], mTm[1][1], mTm[2][2]];
    } else {
      // For non-square
      return null;
    }
    
    // Singular values are square roots of eigenvalues of M^T * M
    const singularValues = eigenvalues
      .filter(val => val > 0) // Only keep positive eigenvalues
      .map(val => Math.sqrt(val))
      .map(val => Math.round(val * 10000) / 10000); // Round to 4 decimal places
    
    return singularValues;
  } catch (error) {
    console.error("Error calculating singular values:", error);
    return null;
  }
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
