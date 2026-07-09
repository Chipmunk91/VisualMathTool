import { useMatrixStore, MatrixDimension } from "../lib/stores/useMatrixStore";
import { useVectorStore } from "../lib/stores/useVectorStore";
import { applyMatrixTransformation } from "../lib/math";
import { evaluateExpression } from "../lib/mathParser";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import MatrixAnalysis from "./MatrixAnalysis";

// Extremely simplified component - no side effects
const MatrixInput = () => {
  const { 
    matrix, 
    updateMatrixValue, 
    setDimension, 
    showTransformed, 
    toggleShowTransformed, 
    showDimensionVisualization,
    toggleDimensionVisualization,
    transposeMatrix 
  } = useMatrixStore();

  // These handlers don't have any side effects beyond the store update
  const handleMatrixChange = (row: number, col: number, value: string) => {
    // If the value is empty string, treat it as 0
    if (value === '') {
      updateMatrixValue(row, col, 0, '0');
      return;
    }
    
    try {
      // Evaluate mathematical expressions like "1/7" or "2^(1/3)"
      const result = evaluateExpression(value);
      // Store both the evaluated value and the original expression
      updateMatrixValue(row, col, result, value);
    } catch (error) {
      console.log(`Error parsing expression "${value}":`, error);
      
      // Don't update if there's an error in the expression
      // This allows the user to continue typing a complex expression
    }
  };

  // Import from useVectorStore directly in component
  const { clearTransformedVectors } = useVectorStore();
  
  const handleDimensionChange = (value: string) => {
    if (['2x2', '2x3', '3x2', '3x3'].includes(value)) {
      // Set the new dimension
      setDimension(value as MatrixDimension);
      
      // Clear transformed vectors when dimension changes
      clearTransformedVectors();
      console.log(`Matrix dimension changed to ${value}, clearing transformed vectors`);
    }
  };

  // Parse dimensions from string
  const [rows, cols] = matrix.dimension.split('x').map(Number);

  return (
    <div className="p-4 h-full flex flex-col">
      <h2 className="text-xl font-bold mb-4">Matrix Controls</h2>
      
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Matrix Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="matrix-dimension">Matrix Dimension</Label>
              <div className="relative">
                <select
                  id="matrix-dimension"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  value={matrix.dimension}
                  onChange={(e) => handleDimensionChange(e.target.value)}
                >
                  <option value="2x2">2×2</option>
                  <option value="2x3">2×3</option>
                  <option value="3x2">3×2</option>
                  <option value="3x3">3×3</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="show-transformed"
                checked={showTransformed}
                onChange={() => {
                  // Get current dimension info for verification
                  const { dimension } = useMatrixStore.getState().matrix;
                  const [rows, cols] = dimension.split('x').map(Number);
                  const vectors = useVectorStore.getState().vectors.filter(v => !v.isTransformed);
                  
                  // Check if any vectors would be compatible
                  const compatibleVectors = vectors.filter(v => v.components.length === cols);
                  const incompatibleVectors = vectors.filter(v => v.components.length !== cols);
                  
                  if (!showTransformed && incompatibleVectors.length > 0) {
                    // Warn about incompatible vectors
                    console.log(
                      `Warning: ${incompatibleVectors.length} vector(s) are incompatible with the current ${dimension} matrix. ` +
                      `For a ${dimension} matrix, vectors must have ${cols} components.`
                    );
                    
                    // List incompatible vectors
                    incompatibleVectors.forEach(v => {
                      console.log(`- Vector "${v.label}" has ${v.components.length} components but needs ${cols} for compatibility.`);
                    });
                  }
                  
                  toggleShowTransformed();
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="show-transformed">Show Transformed Vectors</Label>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="show-dimension-visualization"
                checked={showDimensionVisualization}
                onChange={toggleDimensionVisualization}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="show-dimension-visualization">Visualize Matrix Dimension</Label>
            </div>
            
            <div>
              <Button 
                onClick={() => {
                  // Get current matrix info for logging
                  const { dimension } = useMatrixStore.getState().matrix;
                  const [oldRows, oldCols] = dimension.split('x').map(Number);
                  const newDimension = `${oldCols}x${oldRows}`;
                  
                  // First transpose the matrix
                  transposeMatrix();
                  
                  // Add a hint for the user about compatibility
                  console.log(
                    `Matrix transposed from ${dimension} to ${newDimension}. ` +
                    `This may change compatibility with vectors. A ${oldRows}x${oldCols} matrix requires vectors with ${oldCols} components.`
                  );
                  
                  // If we have Show Transformed Vectors enabled, refresh transformations
                  // to ensure compatibility with the new matrix dimensions
                  const showTransformed = useMatrixStore.getState().showTransformed;
                  if (showTransformed) {
                    // Force recalculation of transformed vectors with the transposed matrix
                    useVectorStore.getState().clearTransformedVectors();
                    
                    // Get non-transformed vectors
                    const originalVectors = useVectorStore
                      .getState()
                      .vectors
                      .filter(v => !v.isTransformed);
                      
                    // Create transformed versions if possible
                    const transformedVectors = originalVectors.map(vector => {
                      return applyMatrixTransformation(
                        useMatrixStore.getState().matrix,
                        vector
                      );
                    });
                    
                    // Filter out nulls to satisfy TypeScript
                    const validTransformedVectors = transformedVectors.filter(
                      (v): v is NonNullable<typeof v> => v !== null
                    );
                    
                    // Update the store with valid transformations
                    useVectorStore.getState().setTransformedVectors(
                      originalVectors,
                      validTransformedVectors
                    );
                  }
                }}
                className="w-full"
              >
                Transpose Matrix
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="flex-1 overflow-auto">
        <CardHeader className="pb-2 flex justify-between items-center">
          <CardTitle className="text-lg">Matrix Values</CardTitle>
          <button 
            onClick={() => {
              const { resetMatrix } = useMatrixStore.getState();
              resetMatrix();
              // Clear transformed vectors
              const { clearTransformedVectors } = useVectorStore.getState();
              clearTransformedVectors();
              console.log("Matrix reset to identity");
            }}
            className="text-gray-500 hover:text-gray-800 focus:outline-none"
            title="Reset to identity matrix"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
          </button>
        </CardHeader>
        <CardContent className="overflow-y-auto">
          <div className="grid gap-4 mb-4">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex flex-wrap justify-center gap-2">
                {Array.from({ length: cols }).map((_, colIndex) => (
                  <div key={`${rowIndex}-${colIndex}`} className="w-[80px] flex-grow-0 flex-shrink-0">
                    <Label htmlFor={`m-${rowIndex}-${colIndex}`} className="whitespace-nowrap text-center block mb-1">
                      M<sub>{rowIndex+1},{colIndex+1}</sub>
                    </Label>
                    <Input
                      id={`m-${rowIndex}-${colIndex}`}
                      type="text"
                      className="min-w-0"
                      // Display the original expression if available, otherwise the numeric value
                      value={(matrix.expressions && matrix.expressions[rowIndex][colIndex]) || 
                             matrix.values[rowIndex][colIndex].toString()}
                      onChange={(e) => {
                        // Get the raw input value
                        let value = e.target.value;
                        handleMatrixChange(rowIndex, colIndex, value);
                      }}
                      onBlur={(e) => {
                        // When focus leaves the input field, convert expression to numeric value
                        try {
                          const expressionValue = e.target.value;
                          // Skip if expression is empty
                          if (expressionValue.trim() === '') return;
                          
                          // Skip if it's already a simple number
                          if (/^-?\d+(\.\d+)?$/.test(expressionValue)) return;
                          
                          // Try to evaluate the expression
                          const numericValue = evaluateExpression(expressionValue);
                          // Format to 8 decimal places, removing trailing zeros
                          const formattedValue = numericValue.toFixed(8).replace(/\.?0+$/, '');
                          
                          // Update the matrix with the evaluated value and formatted expression
                          updateMatrixValue(rowIndex, colIndex, numericValue, formattedValue);
                        } catch (error) {
                          // Keep the original expression if evaluation fails
                          console.log("Error converting matrix expression to numeric form:", error);
                        }
                      }}
                      onClick={(e) => {
                        // Select all on click
                        (e.target as HTMLInputElement).select();
                      }}
                      onDoubleClick={(e) => {
                        // Also select on double click to be safe
                        (e.target as HTMLInputElement).select();
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          
          <MatrixAnalysis />
        </CardContent>
      </Card>
    </div>
  );
};

export default MatrixInput;