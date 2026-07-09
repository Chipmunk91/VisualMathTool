import React from "react";
import { useMatrixStore } from "../lib/stores/useMatrixStore";
import {
  calculateDeterminant,
  calculateTrace,
  calculateEigen,
  calculateSingularValues,
  isMatrixInvertible,
  type ComplexValue
} from "../lib/math";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MatrixAnalysis = () => {
  const { matrix } = useMatrixStore();
  const [rows, cols] = matrix.dimension.split('x').map(Number);
  
  // Check if the matrix is square (for eigenvalues, etc.)
  const isSquare = rows === cols;
  
  // Calculate matrix properties
  const determinant = isSquare ? calculateDeterminant(matrix) : null;
  const trace = isSquare ? calculateTrace(matrix) : null;
  const eigen = isSquare ? calculateEigen(matrix) : null;
  const singularValues = calculateSingularValues(matrix);
  const invertible = isSquare ? isMatrixInvertible(matrix) : null;

  const hasComplexEigenvalues = eigen?.eigenvalues.some((v) => Math.abs(v.im) > 1e-9) ?? false;

  return (
    <Card className="mb-4 overflow-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Matrix Analysis</CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="bg-muted p-3 rounded-md">
            <p className="font-medium">Dimension:</p>
            <p>{rows}×{cols}</p>
          </div>
          
          {isSquare && (
            <>
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">Invertible:</p>
                <p>
                  {invertible === true && "Yes"}
                  {invertible === false && "No (singular)"}
                  {invertible === null && "Unknown"}
                </p>
              </div>
              
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">Determinant:</p>
                <p>{determinant !== null ? determinant.toFixed(4) : "N/A"}</p>
              </div>
              
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">Trace:</p>
                <p>{trace !== null ? trace.toFixed(4) : "N/A"}</p>
              </div>
            </>
          )}
        </div>
        
        {/* Eigenvalue Decomposition */}
        {isSquare && eigen && eigen.eigenvalues.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Eigenvalue Decomposition</h3>
            <div className="space-y-3">
              <div className="bg-muted p-3 rounded-md">
                <p className="font-medium">Eigenvalues:</p>
                <p className="break-all">[{eigen.eigenvalues.map(formatComplex).join(", ")}]</p>
                {hasComplexEigenvalues && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Complex eigenvalues mean the transformation rotates — no real
                    direction is merely stretched.
                  </p>
                )}
              </div>

              {eigen.realEigenpairs.length > 0 && (
                <div className="bg-muted p-3 rounded-md">
                  <p className="font-medium">Eigenvectors (normalized):</p>
                  <div className="space-y-2 mt-1">
                    {eigen.realEigenpairs.map((pair, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-xs">λ = {pair.value.toFixed(4)}:</span>
                        <span className="break-all">[{pair.vector.map(v => v.toFixed(4)).join(", ")}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Singular Value Decomposition */}
        {singularValues && singularValues.length > 0 && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Singular Value Decomposition</h3>
            <div className="bg-muted p-3 rounded-md">
              <p className="font-medium">Singular Values:</p>
              <p className="break-all">[{singularValues.map(v => v.toFixed(4)).join(", ")}]</p>
              <div className="mt-2 text-sm text-muted-foreground">
                <p>Singular values represent the scaling factors in each principal direction.</p>
                <p>The number of non-zero singular values equals the rank of the matrix.</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Matrix Types */}
        {isSquare && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Matrix Classification</h3>
            <div className="bg-muted p-3 rounded-md">
              <ul className="space-y-1">
                {isDiagonal(matrix.values) && (
                  <li>✓ Diagonal matrix (only diagonal elements are non-zero)</li>
                )}
                {isIdentity(matrix.values) && (
                  <li>✓ Identity matrix (diagonal elements are 1, others are 0)</li>
                )}
                {isSymmetric(matrix.values) && (
                  <li>✓ Symmetric matrix (equal to its transpose)</li>
                )}
                {isUpperTriangular(matrix.values) && (
                  <li>✓ Upper triangular matrix (all elements below diagonal are 0)</li>
                )}
                {isLowerTriangular(matrix.values) && (
                  <li>✓ Lower triangular matrix (all elements above diagonal are 0)</li>
                )}
                {isOrthogonal(matrix.values) && (
                  <li>✓ Orthogonal matrix (inverse equals transpose)</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Format a possibly-complex eigenvalue for display
function formatComplex(v: ComplexValue): string {
  if (Math.abs(v.im) < 1e-9) return v.re.toFixed(4);
  const sign = v.im >= 0 ? "+" : "−";
  return `${v.re.toFixed(2)} ${sign} ${Math.abs(v.im).toFixed(2)}i`;
}

// Helper functions to determine matrix types
function isDiagonal(matrix: number[][]): boolean {
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && Math.abs(matrix[i][j]) > 1e-10) {
        return false;
      }
    }
  }
  
  return true;
}

function isIdentity(matrix: number[][]): boolean {
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Check diagonal elements are 1 and off-diagonal elements are 0
      if ((i === j && Math.abs(matrix[i][j] - 1) > 1e-10) || 
          (i !== j && Math.abs(matrix[i][j]) > 1e-10)) {
        return false;
      }
    }
  }
  
  return true;
}

function isSymmetric(matrix: number[][]): boolean {
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(matrix[i][j] - matrix[j][i]) > 1e-10) {
        return false;
      }
    }
  }
  
  return true;
}

function isUpperTriangular(matrix: number[][]): boolean {
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(matrix[i][j]) > 1e-10) {
        return false;
      }
    }
  }
  
  return true;
}

function isLowerTriangular(matrix: number[][]): boolean {
  const n = matrix.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(matrix[i][j]) > 1e-10) {
        return false;
      }
    }
  }
  
  return true;
}

function isOrthogonal(matrix: number[][]): boolean {
  const n = matrix.length;
  
  // For a matrix to be orthogonal, its columns (or rows) must be orthonormal
  // Check for orthogonality by computing dot products of columns
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Calculate dot product of columns i and j
      let dotProduct = 0;
      for (let k = 0; k < n; k++) {
        dotProduct += matrix[k][i] * matrix[k][j];
      }
      
      // Check if dot product is 1 for i=j and 0 for i≠j (allowing for small errors)
      const expected = i === j ? 1 : 0;
      if (Math.abs(dotProduct - expected) > 1e-8) {
        return false;
      }
    }
  }
  
  return true;
}

export default MatrixAnalysis;