import { create } from "zustand";

export type MatrixDimension = '2x2' | '2x3' | '3x2' | '3x3';

export interface Matrix {
  values: number[][];
  dimension: MatrixDimension;
  // Store original expressions entered by user
  expressions?: string[][];
}

interface MatrixStore {
  matrix: Matrix;
  showTransformed: boolean;
  showDimensionVisualization: boolean;
  setMatrix: (matrix: Matrix) => void;
  updateMatrixValue: (row: number, col: number, value: number, expression?: string) => void;
  setDimension: (dimension: MatrixDimension) => void;
  toggleShowTransformed: () => void;
  toggleDimensionVisualization: () => void;
  transposeMatrix: () => void;
  resetMatrix: () => void; // New function to reset matrix to identity
}

const createEmptyMatrix = (dimension: MatrixDimension): number[][] => {
  const [rows, cols] = dimension.split('x').map(Number);
  return Array(rows).fill(0).map(() => Array(cols).fill(0));
};

// Initialize with identity matrix of the selected dimension
const createIdentityMatrix = (dimension: MatrixDimension): number[][] => {
  const [rows, cols] = dimension.split('x').map(Number);
  return Array(rows).fill(0).map((_, i) => 
    Array(cols).fill(0).map((_, j) => i === j ? 1 : 0)
  );
};

// Function to check if a matrix is an identity matrix
export const isIdentityMatrix = (matrix: number[][]): boolean => {
  const rows = matrix.length;
  if (rows === 0) return false;
  
  const cols = matrix[0].length;
  
  // Must be square for identity
  if (rows !== cols) return false;
  
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      // Diagonal elements should be 1
      if (i === j && Math.abs(matrix[i][j] - 1) > 0.001) {
        return false;
      }
      // Off-diagonal elements should be 0
      if (i !== j && Math.abs(matrix[i][j]) > 0.001) {
        return false;
      }
    }
  }
  
  return true;
};

export const useMatrixStore = create<MatrixStore>((set) => ({
  matrix: {
    values: createIdentityMatrix('3x3'),
    dimension: '3x3',
  },
  showTransformed: true,
  showDimensionVisualization: false,
  
  setMatrix: (matrix) => {
    set({ matrix });
  },
  
  updateMatrixValue: (row, col, value, expression) => {
    set((state) => {
      // Update the numeric values
      const newValues = [...state.matrix.values];
      newValues[row][col] = value;
      
      // Update the expressions if provided
      if (expression !== undefined) {
        // Initialize expressions array if it doesn't exist
        let newExpressions: string[][] = state.matrix.expressions 
          ? JSON.parse(JSON.stringify(state.matrix.expressions)) // Deep copy
          : state.matrix.values.map(row => row.map(val => val.toString()));
        
        // Update the expression at the specified position
        newExpressions[row][col] = expression;
        
        return {
          matrix: {
            ...state.matrix,
            values: newValues,
            expressions: newExpressions,
          }
        };
      }
      
      // If no expression provided, just update the values
      return {
        matrix: {
          ...state.matrix,
          values: newValues,
        }
      };
    });
  },
  
  setDimension: (dimension) => {
    set((state) => {
      // Create a new matrix with the new dimension
      const newValues = createIdentityMatrix(dimension);
      
      // Copy over existing values where possible
      const [oldRows, oldCols] = state.matrix.dimension.split('x').map(Number);
      const [newRows, newCols] = dimension.split('x').map(Number);
      
      for (let i = 0; i < Math.min(oldRows, newRows); i++) {
        for (let j = 0; j < Math.min(oldCols, newCols); j++) {
          newValues[i][j] = state.matrix.values[i][j];
        }
      }
      
      // Handle expressions if they exist
      let newExpressions = undefined;
      if (state.matrix.expressions) {
        // Initialize new expressions array
        newExpressions = Array(newRows).fill(0).map(() => Array(newCols).fill('0'));
        
        // For identity positions, use "1" as expression
        for (let i = 0; i < Math.min(newRows, newCols); i++) {
          newExpressions[i][i] = "1";
        }
        
        // Copy existing expressions where possible
        for (let i = 0; i < Math.min(oldRows, newRows); i++) {
          for (let j = 0; j < Math.min(oldCols, newCols); j++) {
            newExpressions[i][j] = state.matrix.expressions[i][j];
          }
        }
      }
      
      // Note: Clearing transformed vectors is now handled in the MatrixInput component
      // to avoid circular dependency between stores
      
      return {
        matrix: {
          values: newValues,
          dimension,
          expressions: newExpressions,
        }
      };
    });
  },
  
  toggleShowTransformed: () => {
    // Log for debugging
    console.log("Toggle show transformed called");
    
    // Use state directly with the set function
    set(state => {
      const newValue = !state.showTransformed;
      
      // Log new state
      console.log("Show transformed toggled to:", newValue);
      
      // Return new state
      return { showTransformed: newValue };
    });
  },
  
  toggleDimensionVisualization: () => {
    set(state => {
      const newValue = !state.showDimensionVisualization;
      console.log("Show dimension visualization toggled to:", newValue);
      return { showDimensionVisualization: newValue };
    });
  },
  
  transposeMatrix: () => {
    set((state) => {
      const [rows, cols] = state.matrix.dimension.split('x').map(Number);
      
      // Create a new matrix with transposed dimensions
      const newDimension = `${cols}x${rows}` as MatrixDimension;
      
      // Create the transposed matrix
      const transposedValues = Array(cols).fill(0).map(() => Array(rows).fill(0));
      
      // Fill with transposed values
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          transposedValues[j][i] = state.matrix.values[i][j];
        }
      }
      
      // Handle expressions if they exist
      let transposedExpressions = undefined;
      if (state.matrix.expressions) {
        transposedExpressions = Array(cols).fill(0).map(() => Array(rows).fill('0'));
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            transposedExpressions[j][i] = state.matrix.expressions[i][j];
          }
        }
      }
      
      // Log transposition for debugging
      console.log(`Transposed matrix from ${state.matrix.dimension} to ${newDimension}`);
      
      // Return the transposed matrix without changing showTransformed
      return {
        matrix: {
          values: transposedValues,
          dimension: newDimension,
          expressions: transposedExpressions,
        }
      };
    });
  },
  
  // Reset matrix to identity based on current dimension
  resetMatrix: () => {
    set((state) => {
      const dimension = state.matrix.dimension;
      const [rows, cols] = dimension.split('x').map(Number);
      
      // Create identity matrix for current dimension
      let newValues: number[][];
      let newExpressions: string[][];
      
      // Different handling for square and non-square matrices
      if (dimension === '2x2' || dimension === '3x3') {
        // True identity matrix for square matrices
        newValues = createIdentityMatrix(dimension);
        newExpressions = Array(rows).fill(0).map((_, i) => 
          Array(cols).fill(0).map((_, j) => i === j ? '1' : '0')
        );
      } 
      else if (dimension === '2x3') {
        // For 2x3, use [[1,0,0],[0,1,0]]
        newValues = [
          [1, 0, 0],
          [0, 1, 0]
        ];
        newExpressions = [
          ['1', '0', '0'],
          ['0', '1', '0']
        ];
      } 
      else if (dimension === '3x2') {
        // For 3x2, use [[1,0],[0,1],[0,0]]
        newValues = [
          [1, 0],
          [0, 1],
          [0, 0]
        ];
        newExpressions = [
          ['1', '0'],
          ['0', '1'],
          ['0', '0']
        ];
      }
      else {
        // Fallback to identity for any other dimensions
        newValues = createIdentityMatrix(dimension);
        newExpressions = Array(rows).fill(0).map((_, i) => 
          Array(cols).fill(0).map((_, j) => i === j ? '1' : '0')
        );
      }
      
      console.log(`Reset matrix to identity for ${dimension} dimension`);
      
      return {
        matrix: {
          values: newValues,
          dimension,
          expressions: newExpressions,
        }
      };
    });
  },
}));
