import React, { useState, Suspense, useCallback, useRef, useLayoutEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import "@fontsource/inter";
import Controls from "./components/Controls";
import VectorInput from "./components/VectorInput";
import MatrixInput from "./components/MatrixInput";
import VectorScene from "./components/VectorScene";
import { useMatrixStore } from "./lib/stores/useMatrixStore";
import { useVectorStore } from "./lib/stores/useVectorStore";
import { applyMatrixTransformation } from "./lib/math";

function LinearAlgebraTool() {
  // State for controlling panel layout
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  
  // Get store data
  const { matrix, showTransformed } = useMatrixStore();
  const { vectors, setTransformedVectors, clearTransformedVectors } = useVectorStore();

  // Use a simpler approach by creating stable hash values for comparison
  const nonTransformedVectorsHash = useMemo(() => {
    const originalVectors = vectors.filter(v => !v.isTransformed);
    return JSON.stringify(originalVectors.map(v => ({
      id: v.id,
      components: v.components,
      visible: v.visible
    })));
  }, [vectors]);
  
  const matrixHash = useMemo(() => JSON.stringify(matrix), [matrix]);
  
  // Track last input hash with a ref instead of DOM attribute
  const lastTransformHashRef = useRef('');
  
  // Track whether we've processed the initial transform state
  const initialProcessRef = useRef(false);
  
  // Track previous showTransformed state
  const wasShowingRef = useRef(showTransformed);
  
  // Process matrix transformations with better loop protection
  useLayoutEffect(() => {
    // Always log current showTransformed state for debugging
    console.log("ShowTransformed state:", showTransformed);
    
    // Avoid running clear on every render when showTransformed is false
    // Only run it once when the value changes from true to false
    if (!showTransformed && wasShowingRef.current) {
      // Only clear when changing from true to false
      console.log("Show transformed CHANGED to false, clearing transformed vectors");
      clearTransformedVectors();
    }
    
    // Reset transformation hash when toggling back on, to force regeneration
    if (showTransformed && !wasShowingRef.current) {
      console.log("Show transformed CHANGED to true, forcing regeneration");
      lastTransformHashRef.current = ''; // Reset hash to force regeneration
    }
    
    // Update ref to current value
    wasShowingRef.current = showTransformed;
    
    // Skip rest of the effect if transformations are disabled
    if (!showTransformed) {
      return;
    }
    
    // Get only original vectors
    const originalVectors = vectors.filter(v => !v.isTransformed);
    if (originalVectors.length === 0) {
      return;
    }

    // Protection against infinite loops - use a ref to track last transformation
    // and skip if inputs are identical
    const currentInputHash = `${nonTransformedVectorsHash}-${matrixHash}`;
    
    // Skip if this is the same input as last time
    if (lastTransformHashRef.current === currentInputHash) {
      console.log("Skipping identical transformation");
      return;
    }
    
    // Calculate transformed vectors
    try {
      // Calculate transformations
      const transformedVectors = [];
      
      for (const vector of originalVectors) {
        const transformed = applyMatrixTransformation(matrix, vector);
        if (transformed) {
          transformedVectors.push(transformed);
        }
      }
      
      // Only update if we have transformations to add
      if (transformedVectors.length > 0) {
        // Important: Use originalVectors as first parameter
        setTransformedVectors(originalVectors, transformedVectors);
        
        // Store the current hash to prevent infinite loops
        lastTransformHashRef.current = currentInputHash;
      }
    } catch (error) {
      console.error("Error applying matrix transformations:", error);
    }
  }, [showTransformed, nonTransformedVectorsHash, matrixHash, clearTransformedVectors, setTransformedVectors, vectors, matrix]);

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-background text-foreground">
      {/* Left Panel - Matrix Input */}
      <div 
        className={`${showLeftPanel ? 'w-full h-1/3 md:h-full sm:w-1/3 md:w-1/4 min-w-0 sm:min-w-[250px]' : 'w-0 h-0 md:h-full'} transition-all duration-300 bg-card border-r border-border overflow-y-auto overflow-x-hidden`}
      >
        {showLeftPanel && (
          <Suspense fallback={<div className="p-4">Loading Matrix controls...</div>}>
            <MatrixInput />
          </Suspense>
        )}
      </div>

      {/* Center - 3D Visualization */}
      <div className="flex-1 flex flex-col md:h-full h-1/3 relative">
        {/* Top Controls */}
        <div className="absolute top-2 right-2 z-10 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => setShowLeftPanel(!showLeftPanel)}
            className="bg-primary text-primary-foreground px-2 py-1 rounded-md text-xs sm:text-sm"
          >
            {showLeftPanel ? '← Hide Matrix' : 'Show Matrix →'}
          </button>
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="bg-primary text-primary-foreground px-2 py-1 rounded-md text-xs sm:text-sm"
          >
            {showRightPanel ? 'Hide Vectors →' : '← Show Vectors'}
          </button>
        </div>

        {/* Canvas Container */}
        <div className="flex-1 border-2 border-blue-500">
          <Canvas
            camera={{ position: [8, 0, 8], fov: 60, up: [0, 0, 1] }}
            gl={{ antialias: true }}
            shadows
            style={{ background: "#ffffff" }}
          >
            {/* Ambient and directional lighting */}
            <ambientLight intensity={0.6} />
            <directionalLight 
              position={[10, 10, 5]} 
              intensity={0.8} 
              castShadow 
              shadow-mapSize={[1024, 1024]}
            />
            
            {/* Scene contents */}
            <Suspense fallback={null}>
              <VectorScene />
            </Suspense>
            
            {/* Camera controls */}
            <Controls />
          </Canvas>
        </div>
      </div>

      {/* Right Panel - Vector Input */}
      <div 
        className={`${showRightPanel ? 'w-full h-1/3 md:h-full sm:w-1/3 md:w-1/4 min-w-0 sm:min-w-[250px]' : 'w-0 h-0 md:h-full'} transition-all duration-300 bg-card border-l border-border overflow-y-auto overflow-x-hidden`}
      >
        {showRightPanel && (
          <Suspense fallback={<div className="p-4">Loading Vector controls...</div>}>
            <VectorInput />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default LinearAlgebraTool;
