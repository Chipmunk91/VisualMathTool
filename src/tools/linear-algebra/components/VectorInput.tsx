import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Trash } from "lucide-react";
import VectorAnalysis from "./VectorAnalysis";
import { useVectorStore } from "../lib/stores/useVectorStore";
import ColorPicker from "./ColorPicker";
import { evaluateExpression } from "../lib/mathParser";

const VectorInput = () => {
  // Define dimensions state (2D or 3D)
  const [dimensions, setDimensions] = useState<"2d" | "3d">("3d");
  
  // Vector component values
  const [x, setX] = useState("1");
  const [y, setY] = useState("1");
  const [z, setZ] = useState("1");
  
  // Get vector store functions
  const { 
    vectors,
    addVector, 
    removeVector, 
    updateVector,
    updateVectorLabel,
    updateVectorColor,
    toggleVectorVisibility,
  } = useVectorStore();
  
  // Handle adding new vector
  const handleAddVector = () => {
    try {
      // Convert expressions to numeric values
      const xValue = evaluateExpression(x);
      const yValue = evaluateExpression(y);
      
      // Create components array based on dimensions
      const components = dimensions === "2d" 
        ? [xValue, yValue]
        : [xValue, yValue, evaluateExpression(z)];
      
      // Create expressions array to store original input
      const expressions = dimensions === "2d"
        ? [x, y]
        : [x, y, z];
      
      // Add the vector
      addVector(components, expressions);
      
      // Reset input fields to default
      setX("1");
      setY("1");
      setZ("1");
    } catch (error) {
      console.error("Error adding vector:", error);
    }
  };

  // Filter out transformed vectors for the list
  const originalVectors = vectors.filter(v => !v.isTransformed);

  return (
    <div className="p-4 h-full flex flex-col space-y-4">
      <h2 className="text-xl font-bold">Vector Controls</h2>
      
      {/* Add new vector */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Add New Vector</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="grid w-full grid-cols-2 rounded-md overflow-hidden mb-2">
              <button 
                onClick={() => setDimensions("2d")}
                className={`py-2 px-4 text-center ${dimensions === "2d" ? "bg-primary text-white" : "bg-secondary"}`}
              >
                2D Vector
              </button>
              <button 
                onClick={() => setDimensions("3d")}
                className={`py-2 px-4 text-center ${dimensions === "3d" ? "bg-primary text-white" : "bg-secondary"}`}
              >
                3D Vector
              </button>
            </div>
            
            {dimensions === "2d" ? (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <Label htmlFor="x-2d">X</Label>
                  <Input 
                    id="x-2d" 
                    type="text" 
                    value={x} 
                    onChange={(e) => {
                      // Handle leading zeros properly (keep for decimals like 0.5)
                      let value = e.target.value;
                      if (value.match(/^0[0-9]/) && !value.includes('.')) {
                        value = value.replace(/^0+/, '');
                        // Update the input value directly
                        e.target.value = value;
                      }
                      setX(value);
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
                        
                        // Update the state with the evaluated value
                        setX(formattedValue);
                      } catch (error) {
                        // Keep the original expression if evaluation fails
                        console.log("Error converting expression to numeric form:", error);
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
                <div>
                  <Label htmlFor="y-2d">Y</Label>
                  <Input 
                    id="y-2d" 
                    type="text" 
                    value={y}
                    onChange={(e) => {
                      // Handle leading zeros properly (keep for decimals like 0.5)
                      let value = e.target.value;
                      if (value.match(/^0[0-9]/) && !value.includes('.')) {
                        value = value.replace(/^0+/, '');
                        // Update the input value directly
                        e.target.value = value;
                      }
                      setY(value);
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
                        
                        // Update the state with the evaluated value
                        setY(formattedValue);
                      } catch (error) {
                        // Keep the original expression if evaluation fails
                        console.log("Error converting expression to numeric form:", error);
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
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <Label htmlFor="x-3d">X</Label>
                  <Input 
                    id="x-3d" 
                    type="text" 
                    value={x}
                    onChange={(e) => {
                      // Handle leading zeros properly (keep for decimals like 0.5)
                      let value = e.target.value;
                      if (value.match(/^0[0-9]/) && !value.includes('.')) {
                        value = value.replace(/^0+/, '');
                        // Update the input value directly
                        e.target.value = value;
                      }
                      setX(value);
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
                        
                        // Update the state with the evaluated value
                        setX(formattedValue);
                      } catch (error) {
                        // Keep the original expression if evaluation fails
                        console.log("Error converting expression to numeric form:", error);
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
                <div>
                  <Label htmlFor="y-3d">Y</Label>
                  <Input 
                    id="y-3d" 
                    type="text" 
                    value={y}
                    onChange={(e) => {
                      // Handle leading zeros properly (keep for decimals like 0.5)
                      let value = e.target.value;
                      if (value.match(/^0[0-9]/) && !value.includes('.')) {
                        value = value.replace(/^0+/, '');
                        // Update the input value directly
                        e.target.value = value;
                      }
                      setY(value);
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
                        
                        // Update the state with the evaluated value
                        setY(formattedValue);
                      } catch (error) {
                        // Keep the original expression if evaluation fails
                        console.log("Error converting expression to numeric form:", error);
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
                <div>
                  <Label htmlFor="z-3d">Z</Label>
                  <Input 
                    id="z-3d" 
                    type="text" 
                    value={z}
                    onChange={(e) => {
                      // Handle leading zeros properly (keep for decimals like 0.5)
                      let value = e.target.value;
                      if (value.match(/^0[0-9]/) && !value.includes('.')) {
                        value = value.replace(/^0+/, '');
                        // Update the input value directly
                        e.target.value = value;
                      }
                      setZ(value);
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
                        
                        // Update the state with the evaluated value
                        setZ(formattedValue);
                      } catch (error) {
                        // Keep the original expression if evaluation fails
                        console.log("Error converting expression to numeric form:", error);
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
              </div>
            )}
          </div>
          
          <Button onClick={handleAddVector} className="w-full">
            Add Vector
          </Button>
        </CardContent>
      </Card>
      
      {/* Vector Analysis - Keep this outside any scrollable container */}
      <div className="flex-none">
        <VectorAnalysis />
      </div>
      
      {/* Vector list - Scrollable with fixed height */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Vector List</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[300px] overflow-y-auto">
          {originalVectors.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No vectors added yet. Add a vector to get started.
            </p>
          ) : (
            <ul className="space-y-3">
              {originalVectors.map((vector) => (
                <li key={vector.id} className="border border-border rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ColorPicker 
                        currentColor={vector.color}
                        onChange={(color) => updateVectorColor(vector.id, color)}
                        className="h-5 w-5"
                      />
                      <Input 
                        value={vector.label}
                        onChange={(e) => updateVectorLabel(vector.id, e.target.value)}
                        className="h-7 w-16 text-sm py-0 px-2"
                      />
                      <div className="text-xs text-muted-foreground">
                        {vector.components.length}D
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleVectorVisibility(vector.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-full"
                        title={vector.visible ? "Hide Vector" : "Show Vector"}
                      >
                        {vector.visible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button
                        onClick={() => removeVector(vector.id)}
                        className="text-muted-foreground hover:text-red-500 p-1 rounded-full"
                        title="Remove Vector"
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Vector components */}
                  <div className="grid grid-cols-3 gap-2">
                    {vector.components.map((value: number, index) => (
                      <div key={index}>
                        <Label>{index === 0 ? 'X' : index === 1 ? 'Y' : 'Z'}</Label>
                        <Input
                          type="text"
                          // Show the original expression if available, otherwise the numeric value
                          // Display the formatted value with 2 decimal places to match the 3D display format
                          value={(vector.componentExpressions && vector.componentExpressions[index]) || 
                                  value.toFixed(2).replace(/\.?0+$/, '')}
                          onChange={(e) => {
                            // Get the input value
                            let expressionValue = e.target.value;
                            
                            // Create a copy of the components array
                            const newComponents = [...vector.components];
                            
                            try {
                              // If input is empty, use 0
                              if (expressionValue === '') {
                                newComponents[index] = 0;
                              } else {
                                // Otherwise, evaluate the mathematical expression
                                newComponents[index] = evaluateExpression(expressionValue);
                              }
                              
                              // Update the vector with both the new components and expression
                              updateVector(vector.id, newComponents, expressionValue, index);
                            } catch (error) {
                              console.log(`Error evaluating expression "${expressionValue}":`, error);
                              
                              // Don't update if there's an error in the expression
                              // This allows the user to continue typing a complex expression
                            }
                          }}
                          onBlur={(e) => {
                            // When focus leaves the input field, convert expression to numeric value if it's a valid math expression
                            try {
                              const expressionValue = e.target.value;
                              // Skip if expression is empty
                              if (expressionValue.trim() === '') return;
                              
                              // Skip if it's already a simple number
                              if (/^-?\d+(\.\d+)?$/.test(expressionValue)) return;
                              
                              // Try to evaluate the expression
                              const numericValue = evaluateExpression(expressionValue);
                              // Format to 8 decimal places for readability, removing trailing zeros
                              const formattedValue = numericValue.toFixed(8).replace(/\.?0+$/, '');
                              
                              // Update the components with the evaluated value
                              const newComponents = [...vector.components];
                              newComponents[index] = numericValue;
                              
                              // Update with the numeric representation instead of the expression
                              updateVector(vector.id, newComponents, formattedValue, index);
                            } catch (error) {
                              // Keep the original expression if evaluation fails
                              console.log("Error converting expression to numeric form:", error);
                            }
                          }}
                          onDoubleClick={(e) => {
                            // Select all text on double click for easier editing
                            (e.target as HTMLInputElement).select();
                          }}
                          onClick={(e) => {
                            // Also select on single click for better usability
                            (e.target as HTMLInputElement).select();
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VectorInput;