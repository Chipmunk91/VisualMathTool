import { useThree } from "@react-three/fiber";
import React, { useEffect, useState, useRef, useMemo } from "react";
import { useVectorStore, Vector as VectorType } from "../lib/stores/useVectorStore";
import Grid from "./Grid";
import Axis from "./Axis";
import Vector from "./Vector";
import { useMatrixStore, isIdentityMatrix } from "../lib/stores/useMatrixStore";
import * as THREE from "three";

// Default vectors that will always be shown for testing
const defaultVectors: VectorType[] = [
  {
    id: "default-x",
    components: [3, 0, 0],
    color: "#FF0000",
    label: "X",
    visible: true,
    isTransformed: false
  },
  {
    id: "default-y",
    components: [0, 3, 0],
    color: "#00FF00",
    label: "Y",
    visible: true,
    isTransformed: false
  },
  {
    id: "default-z",
    components: [0, 0, 3],
    color: "#0000FF",
    label: "Z",
    visible: true,
    isTransformed: false
  }
];

// Helper function to calculate matrix rank
const calculateMatrixRank = (matrix: number[][]): number => {
  // Simple implementation to estimate rank
  // For a more accurate version, we could use SVD or row reduction
  
  // Clone the matrix since we'll modify it
  const m = matrix.map(row => [...row]);
  const rows = m.length;
  const cols = m[0].length;
  
  // Use Gaussian elimination to find rank
  let rank = 0;
  const rowsProcessed = new Array(rows).fill(false);
  
  for (let col = 0; col < cols; col++) {
    let foundPivot = false;
    
    // Find pivot
    for (let row = 0; row < rows; row++) {
      if (!rowsProcessed[row] && Math.abs(m[row][col]) > 1e-10) {
        rowsProcessed[row] = true;
        rank++;
        foundPivot = true;
        
        // Normalize the pivot row
        const pivot = m[row][col];
        for (let c = col; c < cols; c++) {
          m[row][c] /= pivot;
        }
        
        // Eliminate this column from all other rows
        for (let r = 0; r < rows; r++) {
          if (r !== row && Math.abs(m[r][col]) > 1e-10) {
            const factor = m[r][col];
            for (let c = col; c < cols; c++) {
              m[r][c] -= factor * m[row][c];
            }
          }
        }
        
        break;
      }
    }
    
    if (!foundPivot) {
      // This column doesn't add to the rank
      continue;
    }
  }
  
  return rank;
};

const VectorScene = () => {
  const { vectors } = useVectorStore();
  const { matrix, showTransformed, showDimensionVisualization } = useMatrixStore();
  const { camera } = useThree();
  const [allVectors, setAllVectors] = useState<VectorType[]>([...defaultVectors]);
  
  // Check if the matrix is an identity matrix to decide whether to show transformed vectors
  const isIdentity = useMemo(() => {
    return isIdentityMatrix(matrix.values);
  }, [matrix.values]);
  
  // Default grid size
  const defaultSize = 10;
  
  // Calculate the grid size based on vector coordinates
  const [gridSize, setGridSize] = useState(defaultSize);
  
  // Combine user vectors with default vectors and calculate grid size
  useEffect(() => {
    console.log("Rendering VectorScene with vectors:", vectors);
    const combinedVectors = [...defaultVectors, ...vectors];
    setAllVectors(combinedVectors);
    
    // Determine if we need a larger grid size based on vector coordinates
    let maxCoordinate = defaultSize;
    
    // Check all vectors including transformed ones
    combinedVectors.forEach(vector => {
      vector.components.forEach(component => {
        const absComponent = Math.abs(component);
        if (absComponent > maxCoordinate) {
          // Round up to the nearest multiple of 10
          maxCoordinate = Math.ceil(absComponent / 10) * 10;
        }
      });
    });
    
    // Set the new grid size if it's changed
    if (maxCoordinate !== gridSize) {
      console.log("Setting new grid size:", maxCoordinate);
      setGridSize(maxCoordinate);
    }
  }, [vectors, gridSize, showTransformed, showDimensionVisualization]);
  
  // Camera setup - ONLY runs once when the component mounts
  const cameraInitialized = useRef(false);
  
  useEffect(() => {
    // Only set initial camera position on first render
    if (!cameraInitialized.current) {
      console.log("Setting initial camera position in VectorScene");
      camera.position.set(8, 8, 8);
      camera.up.set(0, 0, 1); // Set Z-axis as up direction
      camera.lookAt(0, 0, 0);
      cameraInitialized.current = true;
    }
  }, []);
  
  // Calculate matrix rank and generate visualization components for dimension
  const matrixRank = useMemo(() => {
    if (!showDimensionVisualization) return 0;
    
    // Handle non-square matrices
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    
    // For non-square matrices, the rank is at most min(rows, cols)
    // and we need a specific approach
    if (rows !== cols) {
      console.log(`Non-square matrix detected: ${rows}x${cols}`);
      
      // A 3x2 matrix can at most have rank 2 (maps to a plane)
      // A 2x3 matrix can at most have rank 2 (maps from a plane)
      return Math.min(calculateMatrixRank(matrix.values), Math.min(rows, cols));
    }
    
    return calculateMatrixRank(matrix.values);
  }, [matrix.values, matrix.dimension, showDimensionVisualization]);
  
  // Determine transformation characteristics for visualization
  const getTransformationSpace = useMemo(() => {
    // Only compute if visualization is enabled
    if (!showDimensionVisualization) {
      return {
        rank1Direction: new THREE.Vector3(1, 0, 0),
        rank2Normal: new THREE.Vector3(0, 0, 1),
        rank2Basis1: new THREE.Vector3(1, 0, 0),
        rank2Basis2: new THREE.Vector3(0, 1, 0)
      };
    }
    
    // Get matrix values
    const m = matrix.values;
    console.log("Matrix for transformation space:", m);
    
    // Get matrix dimensions
    const [rows, cols] = matrix.dimension.split('x').map(Number);
    console.log(`Processing matrix with dimensions ${rows}x${cols}`);
    
    // For 3x3 matrices and non-square matrices
    if (m.length > 0 && m[0].length > 0) {
      // Create the column vectors of the matrix (these define the transformation)
      // Handle different matrix dimensions
      let colVec1, colVec2, colVec3;
      
      // Fill column vectors based on matrix dimensions, with zeros for missing values
      if (rows === 3) {
        colVec1 = new THREE.Vector3(
          cols > 0 ? m[0][0] : 0, 
          cols > 0 ? m[1][0] : 0, 
          cols > 0 ? m[2][0] : 0
        );
        colVec2 = new THREE.Vector3(
          cols > 1 ? m[0][1] : 0, 
          cols > 1 ? m[1][1] : 0, 
          cols > 1 ? m[2][1] : 0
        );
        colVec3 = new THREE.Vector3(
          cols > 2 ? m[0][2] : 0, 
          cols > 2 ? m[1][2] : 0, 
          cols > 2 ? m[2][2] : 0
        );
      } else if (rows === 2) {
        // For 2-row matrices, we use z=0 for the third component
        colVec1 = new THREE.Vector3(
          cols > 0 ? m[0][0] : 0, 
          cols > 0 ? m[1][0] : 0, 
          0
        );
        colVec2 = new THREE.Vector3(
          cols > 1 ? m[0][1] : 0, 
          cols > 1 ? m[1][1] : 0, 
          0
        );
        colVec3 = new THREE.Vector3(
          cols > 2 ? m[0][2] : 0, 
          cols > 2 ? m[1][2] : 0, 
          0
        );
      } else {
        // Default case
        colVec1 = new THREE.Vector3(
          cols > 0 && m[0] ? m[0][0] : 0, 
          0, 
          0
        );
        colVec2 = new THREE.Vector3(
          cols > 1 && m[0] ? m[0][1] : 0, 
          0, 
          0
        );
        colVec3 = new THREE.Vector3(
          cols > 2 && m[0] ? m[0][2] : 0, 
          0, 
          0
        );
      }
      
      console.log("Column vectors:", { colVec1, colVec2, colVec3 });
      
      // For rank 1 matrices with specific patterns like [[1,0,0],[0,0,0],[0,0,0]], 
      // we need direct checking rather than just magnitudes
      
      // Special case check for specific axes-aligned matrices
      // Only apply these checks for 3x3 matrices
      if (rows === 3 && cols === 3) {
        if (m[0][0] !== 0 && m[1][0] === 0 && m[2][0] === 0 && 
            m[0][1] === 0 && m[1][1] === 0 && m[2][1] === 0 && 
            m[0][2] === 0 && m[1][2] === 0 && m[2][2] === 0) {
          // Case for X-axis aligned transformation [[x,0,0],[0,0,0],[0,0,0]]
          console.log("Special case: X-axis aligned matrix");
          // Force to exact axes for visualization purposes
          return {
            rank1Direction: new THREE.Vector3(1, 0, 0).normalize(),
            rank2Normal: new THREE.Vector3(0, 0, 1).normalize(),
            rank2Basis1: new THREE.Vector3(1, 0, 0).normalize(),
            rank2Basis2: new THREE.Vector3(0, 1, 0).normalize()
          };
        } else if (m[0][0] === 0 && m[1][0] !== 0 && m[2][0] === 0 && 
                  m[0][1] === 0 && m[1][1] === 0 && m[2][1] === 0 && 
                  m[0][2] === 0 && m[1][2] === 0 && m[2][2] === 0) {
          // Case for Y-axis aligned transformation [[0,0,0],[y,0,0],[0,0,0]]
          console.log("Special case: Y-axis aligned matrix");
          return {
            rank1Direction: new THREE.Vector3(0, 1, 0),
            rank2Normal: new THREE.Vector3(0, 0, 1),
            rank2Basis1: new THREE.Vector3(0, 1, 0),
            rank2Basis2: new THREE.Vector3(1, 0, 0)
          };
        } else if (m[0][0] === 0 && m[1][0] === 0 && m[2][0] !== 0 && 
                  m[0][1] === 0 && m[1][1] === 0 && m[2][1] === 0 && 
                  m[0][2] === 0 && m[1][2] === 0 && m[2][2] === 0) {
          // Case for Z-axis aligned transformation [[0,0,0],[0,0,0],[z,0,0]]
          console.log("Special case: Z-axis aligned matrix");
          return {
            rank1Direction: new THREE.Vector3(0, 0, 1),
            rank2Normal: new THREE.Vector3(1, 0, 0),
            rank2Basis1: new THREE.Vector3(0, 0, 1),
            rank2Basis2: new THREE.Vector3(0, 1, 0)
          };
        }
      }
      
      // Special case for 3x2 (matrix-vector) product which should map to a plane
      if (rows === 3 && cols === 2) {
        // Ensure we handle specifically the [[1,2],[3,4],[5,6]] case which maps to a plane in 3D
        console.log("Special case: 3x2 matrix (maps to a plane)");
        
        // For a 3x2 matrix, the columns represent the basis vectors of the plane
        // First, ensure the vectors are linearly independent
        const col1 = colVec1.clone();
        let col2 = colVec2.clone();
        
        // If col2 is dependent on col1, generate a perpendicular vector
        if (Math.abs(col1.dot(col2) / (col1.length() * col2.length())) > 0.99) {
          // They're almost parallel, so make a perpendicular vector
          console.log("Columns are nearly dependent, creating orthogonal vector");
          if (Math.abs(col1.x) < 0.9) {
            col2 = new THREE.Vector3(1, 0, 0).sub(
              col1.clone().multiplyScalar(col1.x / col1.lengthSq())
            );
          } else {
            col2 = new THREE.Vector3(0, 1, 0).sub(
              col1.clone().multiplyScalar(col1.y / col1.lengthSq())
            );
          }
        } else {
          // Make col2 orthogonal to col1 for better visualization
          const col1UnitSq = col1.lengthSq();
          if (col1UnitSq > 0.00001) {
            col2.sub(col1.clone().multiplyScalar(col1.dot(col2) / col1UnitSq));
          }
        }
        
        // Normalize the vectors
        col1.normalize();
        col2.normalize();
        
        // Calculate the normal vector to the plane (cross product of the columns)
        const normal = new THREE.Vector3().crossVectors(col1, col2).normalize();
        
        console.log("3x2 transformation space:", {
          "basis1": col1,
          "basis2": col2,
          "normal": normal
        });
        
        return {
          rank1Direction: col1,
          rank2Normal: normal,
          rank2Basis1: col1,
          rank2Basis2: col2
        };
      }
      
      // Our improved approach, completely rewritten to be more robust
      
      // Start with the basic collection of column vectors and their magnitudes
      const colVectors = [
        { vec: colVec1, mag: colVec1.length() },
        { vec: colVec2, mag: colVec2.length() },
        { vec: colVec3, mag: colVec3.length() }
      ];
      
      // Handle each rank differently
      if (matrixRank === 1) {
        // RANK 1: For rank 1 matrices, ALWAYS use the first column vector direction
        // (regardless of magnitude) to ensure consistent behavior
        console.log("Handling rank 1 matrix");
        
        // Create first column vector based on matrix dimensions
        let firstColVector: THREE.Vector3;
        
        if (rows === 3) {
          // 3x3 or 3x2 matrix
          firstColVector = new THREE.Vector3(m[0][0], m[1][0], m[2][0]);
        } else if (rows === 2) {
          // 2x3 or 2x2 matrix
          firstColVector = new THREE.Vector3(m[0][0], m[1][0], 0);
        } else {
          // Shouldn't happen, use default
          firstColVector = colVec1.clone();
        }
        
        // Normalize to get direction (magnitude doesn't matter)
        const direction = firstColVector.clone().normalize();
        console.log("Rank 1 direction vector:", direction);
        
        // Create orthogonal vectors for the basis
        let orthogonal = new THREE.Vector3();
        if (Math.abs(direction.x) < 0.9) {
          orthogonal.set(1, 0, 0).sub(
            direction.clone().multiplyScalar(direction.x)
          ).normalize();
        } else {
          orthogonal.set(0, 1, 0).sub(
            direction.clone().multiplyScalar(direction.y)
          ).normalize();
        }
        
        // Calculate normal for rank 2 plane (will be used if we toggle to rank 2)
        const normal = new THREE.Vector3().crossVectors(direction, orthogonal).normalize();
        
        // Return the transformation space for rank 1
        return {
          rank1Direction: direction,
          rank2Normal: normal,
          rank2Basis1: direction,
          rank2Basis2: orthogonal
        };
      } 
      else {
        // RANK 2 or 3: Can use magnitude-based approach
        // Sort vectors by magnitude (largest first)
        colVectors.sort((a, b) => b.mag - a.mag);
        
        // Primary direction is the largest vector
        const direction = colVectors[0].vec.clone().normalize();
        
        // Find a second linearly independent vector for rank2Basis2
        let secondVector = new THREE.Vector3();
        
        // Try using the second largest vector, making it orthogonal to the first
        if (colVectors[1].mag > 0.00001) {
          const tempVec = colVectors[1].vec.clone();
          tempVec.sub(direction.clone().multiplyScalar(tempVec.dot(direction)));
          
          if (tempVec.length() > 0.00001) {
            // Second vector is good
            secondVector = tempVec.normalize();
          } else {
            // Try third vector if available
            if (colVectors[2].mag > 0.00001) {
              const thirdVec = colVectors[2].vec.clone();
              thirdVec.sub(direction.clone().multiplyScalar(thirdVec.dot(direction)));
              
              if (thirdVec.length() > 0.00001) {
                secondVector = thirdVec.normalize();
              } else {
                // Generate an orthogonal vector
                if (Math.abs(direction.x) < 0.9) {
                  secondVector.set(1, 0, 0).sub(direction.clone().multiplyScalar(direction.x)).normalize();
                } else {
                  secondVector.set(0, 1, 0).sub(direction.clone().multiplyScalar(direction.y)).normalize();
                }
              }
            } else {
              // Generate an orthogonal vector
              if (Math.abs(direction.x) < 0.9) {
                secondVector.set(1, 0, 0).sub(direction.clone().multiplyScalar(direction.x)).normalize();
              } else {
                secondVector.set(0, 1, 0).sub(direction.clone().multiplyScalar(direction.y)).normalize();
              }
            }
          }
        } else {
          // Generate an orthogonal vector if no suitable second vector exists
          if (Math.abs(direction.x) < 0.9) {
            secondVector.set(1, 0, 0).sub(direction.clone().multiplyScalar(direction.x)).normalize();
          } else {
            secondVector.set(0, 1, 0).sub(direction.clone().multiplyScalar(direction.y)).normalize();
          }
        }
        
        // Calculate normal vector for the plane
        const normal = new THREE.Vector3().crossVectors(direction, secondVector).normalize();
        
        console.log("Space computed for rank", matrixRank, "matrix:", {
          rank1Direction: direction,
          rank2Normal: normal,
          rank2Basis1: direction,
          rank2Basis2: secondVector
        });
        
        // Return the transformation space
        return {
          rank1Direction: direction,
          rank2Normal: normal,
          rank2Basis1: direction,
          rank2Basis2: secondVector
        };
      }
    }
    
    // Default fallback - should never reach here but provide sensible defaults
    const defaultDirection = new THREE.Vector3(1, 0, 0);
    const defaultSecondary = new THREE.Vector3(0, 1, 0);
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    
    console.log("Using default transformation space (fallback)");
    
    return {
      rank1Direction: defaultDirection,
      rank2Normal: defaultNormal,
      rank2Basis1: defaultDirection,
      rank2Basis2: defaultSecondary
    };
  }, [matrix.values, matrix.dimension, showDimensionVisualization]);
  
  // Create visualization elements based on rank
  const dimensionVisualization = useMemo(() => {
    if (!showDimensionVisualization) return null;
    
    console.log(`Visualizing matrix with rank ${matrixRank}`);
    
    // Size of visualization (adjusted to match grid)
    const size = 5;
    
    // Get transformation space info
    const transformSpace = getTransformationSpace;
    
    // We'll only need a quaternion for rank 2 plane visualization
    // For rank 1, we now use direct line drawing
    
    if (matrixRank === 1) {
      // Rank 1: Line visualization (1D)
      // Instead of using a cylinder, use a direct LineSegments object for stability
      
      // Get the direction vector
      const direction = transformSpace.rank1Direction.clone().normalize();
      
      // Calculate midpoint (center of our line)
      const midPoint = new THREE.Vector3(0, 0, 0);
      
      // Calculate start and end points for visual elements
      const startPoint = direction.clone().multiplyScalar(-size);
      const endPoint = direction.clone().multiplyScalar(size);
      
      console.log("Creating line visualization along direction:", direction);
      
      // Compute rotation to align with the direction vector
      // Start with a vector pointing in the Y direction (0,1,0)
      const defaultUp = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(defaultUp, direction);
      
      return (
        <>
          {/* Draw a line using a thin, stretched box, rotated to match direction */}
          <mesh position={midPoint.toArray()} quaternion={quaternion.toArray()}>
            <boxGeometry args={[0.05, size * 2, 0.05]} />
            <meshStandardMaterial 
              color="#7F00FF" 
              transparent 
              opacity={0.5}
              emissive="#7F00FF"
              emissiveIntensity={0.3}
            />
          </mesh>
          
          {/* Add small spheres at each end to make direction more visible */}
          <mesh position={startPoint.toArray()}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#7F00FF" transparent opacity={0.7} />
          </mesh>
          <mesh position={endPoint.toArray()}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#7F00FF" transparent opacity={0.7} />
          </mesh>
          
          {/* Add an arrow head at the end */}
          <mesh 
            position={endPoint.toArray()}
            quaternion={quaternion.toArray()}
          >
            <coneGeometry args={[0.2, 0.4, 16]} />
            <meshStandardMaterial color="#7F00FF" transparent opacity={0.7} />
          </mesh>
        </>
      );
    } else if (matrixRank === 2) {
      // Rank 2: Plane visualization (2D)
      // Get basis and normal vectors from transformation space
      
      // Create a quaternion to align the plane with the matrix's column vectors
      const planeQuaternion = new THREE.Quaternion();
      const defaultNormal = new THREE.Vector3(0, 0, 1); // Default plane normal
      
      // Rotate to match transformation space
      planeQuaternion.setFromUnitVectors(defaultNormal, transformSpace.rank2Normal);
      
      return (
        <group quaternion={planeQuaternion.toArray()}>
          {/* Main plane */}
          <mesh>
            <planeGeometry args={[size * 2, size * 2]} />
            <meshStandardMaterial color="#00BFFF" transparent opacity={0.2} side={THREE.DoubleSide} />
          </mesh>
          
          {/* Corner indicators to make plane more visible */}
          <mesh position={[size, size, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#00BFFF" transparent opacity={0.6} />
          </mesh>
          <mesh position={[-size, size, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#00BFFF" transparent opacity={0.6} />
          </mesh>
          <mesh position={[size, -size, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#00BFFF" transparent opacity={0.6} />
          </mesh>
          <mesh position={[-size, -size, 0]}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial color="#00BFFF" transparent opacity={0.6} />
          </mesh>
          
          {/* Grid lines to indicate plane orientation */}
          <lineSegments>
            <edgesGeometry args={[new THREE.PlaneGeometry(size * 2, size * 2, 4, 4)]} />
            <lineBasicMaterial color="#00BFFF" transparent opacity={0.6} />
          </lineSegments>
        </group>
      );
    } else if (matrixRank === 3) {
      // Rank 3: Space visualization (3D)
      // Using just the edges of a cube to show the space without obscuring objects inside
      return (
        <>
          {/* Edges-only box */}
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(size * 2, size * 2, size * 2)]} />
            <lineBasicMaterial color="#FF6347" transparent opacity={0.3} />
          </lineSegments>
          
          {/* Vertices as small spheres at corners (8) */}
          {/* Using a loop to create spheres at the 8 corners of the cube */}
          {[
            [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
          ].map((pos, index) => (
            <mesh 
              key={`corner-${index}`}
              position={[pos[0] * size, pos[1] * size, pos[2] * size]}
            >
              <sphereGeometry args={[0.15, 16, 16]} />
              <meshBasicMaterial color="#FF6347" transparent opacity={0.5} />
            </mesh>
          ))}
        </>
      );
    }
    
    return null;
  }, [matrixRank, showDimensionVisualization, getTransformationSpace]);
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={0.8} />
      
      {/* Coordinate system - adjust grid size dynamically but keep axis at 10 units */}
      <Grid size={gridSize} divisions={gridSize} />
      <Axis length={10} />
      
      {/* Matrix dimension visualization */}
      {dimensionVisualization}
      
      {/* Debug sphere at origin */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <meshStandardMaterial color="#FFFFFF" />
      </mesh>
      
      {/* Debug vectors for testing */}
      {defaultVectors.map((vector) => (
        <Vector 
          key={vector.id} 
          vector={vector} 
        />
      ))}
      
      {/* Render user-added vectors */}
      {vectors.map((vector) => (
        // Don't render transformed vectors if the matrix is an identity matrix
        vector.visible && 
        (!vector.isTransformed || !isIdentity) && (
          <Vector 
            key={vector.id} 
            vector={vector} 
          />
        )
      ))}
    </>
  );
};

export default VectorScene;
