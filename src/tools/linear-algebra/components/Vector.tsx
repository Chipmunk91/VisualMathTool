import React, { useMemo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Vector as VectorType } from "../lib/stores/useVectorStore";
import { useVectorStore } from "../lib/stores/useVectorStore";
import { useMatrixStore } from "../lib/stores/useMatrixStore";
import { useThree, ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";

interface VectorProps {
  vector: VectorType;
}

const Vector = ({ vector }: VectorProps) => {
  const { vectors, selectedVectorId, setSelectedVector } = useVectorStore();
  const { camera } = useThree();
  
  const components = vector.components;
  const isTransformed = vector.isTransformed;
  
  // If this is a transformed vector, get the original vector for comparison
  const originalVector = useMemo(() => {
    if (isTransformed && vector.originalId) {
      return vectors.find(v => v.id === vector.originalId);
    }
    return null;
  }, [isTransformed, vector.originalId, vectors]);
  
  // Create refs for interactive elements
  const arrowHeadRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  
  // Origin is always (0,0,0)
  const start = new THREE.Vector3(0, 0, 0);

  // Animation progress: transformed vectors are drawn at lerp(v, Av, t),
  // which equals ((1-t)I + tA)v — the interpolated transformation applied to v
  const animationT = useMatrixStore((state) => state.animationT);
  const displayComponents = useMemo(() => {
    if (!isTransformed || !originalVector) return components;
    return components.map(
      (c, i) => (originalVector.components[i] ?? 0) * (1 - animationT) + c * animationT
    );
  }, [components, isTransformed, originalVector, animationT]);

  // End point depends on vector dimensions
  const end = useMemo(() => {
    if (displayComponents.length === 2) {
      return new THREE.Vector3(displayComponents[0], displayComponents[1], 0);
    } else {
      return new THREE.Vector3(displayComponents[0], displayComponents[1], displayComponents[2]);
    }
  }, [displayComponents]);

  // Calculate midpoint for arrow placement
  const midPoint = useMemo(() => {
    return new THREE.Vector3(
      start.x + (end.x - start.x) * 0.5,
      start.y + (end.y - start.y) * 0.5,
      start.z + (end.z - start.z) * 0.5
    );
  }, [start, end]);

  // Arrow parameters
  const arrowLength = end.distanceTo(start);
  const arrowDirection = new THREE.Vector3().subVectors(end, start).normalize();
  
  // Convert color string to THREE.Color
  const threeColor = new THREE.Color(vector.color);
  
  // Adjust opacity and size for transformed vectors
  const opacity = vector.opacity !== undefined ? vector.opacity : (isTransformed ? 0.6 : 1);
  const arrowHeadSize = isTransformed ? 0.13 : 0.15;
  const lineWidth = isTransformed ? 0.04 : 0.05;
  
  // Transformed vectors and default basis vectors can't be moved
  const isDefaultAxis = vector.id === "default-x" || vector.id === "default-y" || vector.id === "default-z";
  const isUnitVector = isDefaultAxis; // Unit vectors are default i-j-k hats
  const isDraggable = !isTransformed && !isDefaultAxis;
  const isSelected = isDraggable && selectedVectorId === vector.id;

  // Use internal state for managing cursor
  const [hovered, setHovered] = useState(false);

  // Update cursor style to pointer (hand) when hovering over selectable vector tips
  useEffect(() => {
    if (isDraggable) {
      document.body.style.cursor = hovered ? 'pointer' : 'auto';
    }

    // Cleanup
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered, isDraggable]);
  
  return (
    <group>
      {/* Visible cylinder for the arrow line */}
      <mesh
        position={midPoint}
        scale={[lineWidth, arrowLength, lineWidth]}
        rotation={arrowDirection.x || arrowDirection.z ? 
          new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0), 
              arrowDirection
            )
          ) 
          : new THREE.Euler(0, 0, 0)}
      >
        <cylinderGeometry args={[1, 1, 1, 16]} />
        <meshStandardMaterial 
          color={threeColor}
          opacity={opacity}
          transparent={true}
        />
      </mesh>
      
      {/* Arrow head at the end point - draggable */}
      <group
        ref={groupRef}
        position={end}
        rotation={arrowDirection.x || arrowDirection.z ? 
          new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 1, 0), 
              arrowDirection
            )
          ) 
          : new THREE.Euler(0, 0, 0)}
      >
        {/* Arrowhead — click to select and show the translate gizmo */}
        <mesh
          ref={arrowHeadRef}
          userData={{ vectorElement: true }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            if (!isDraggable) return;
            e.stopPropagation();
            setSelectedVector(isSelected ? null : vector.id);
          }}
          onPointerEnter={() => isDraggable && setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <coneGeometry args={[hovered && isDraggable ? arrowHeadSize * 1.2 : arrowHeadSize, 0.4, 16]} />
          <meshStandardMaterial
            color={hovered && isDraggable ? new THREE.Color(0xffffff) : threeColor}
            opacity={opacity}
            transparent={true}
            emissive={isSelected || (hovered && isDraggable) ? threeColor : undefined}
            emissiveIntensity={isSelected ? 0.7 : (hovered && isDraggable ? 0.5 : 0)}
          />
        </mesh>
      </group>
      
      {/* Small sphere at the origin */}
      <mesh position={start}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial 
          color={threeColor}
          opacity={opacity * 0.7}
          transparent={true}
        />
      </mesh>
      
      {/* Labels for all vectors */}
      {vector.visible && (
        <>
          {/* Vector name label with significantly increased distance */}
          <Text
            position={[
              // Position label further away from the vector end
              end.x + (end.x * 0.2), // Shift label a bit in the X direction (20% of vector length)
              end.y + 1.2, // Significantly moved up from the vector tip
              end.z + (end.z * 0.2) // Shift label a bit in the Z direction (20% of vector length)
            ]}
            fontSize={0.4}
            color={vector.color}
            anchorX="center"
            anchorY="bottom"
            fillOpacity={opacity}
            outlineWidth={0.05}
            outlineColor="#222222"
            outlineOpacity={opacity * 0.8}
            quaternion={camera.quaternion}
          >
            {vector.label}
          </Text>
          
          {/* 
            Show coordinates for original vectors, and for transformed vectors,
            only if they are different from the original vector.
            Never show coordinates for unit vectors (i-j-k hats).
          */}
          {(() => {
            // Don't display coordinates for unit vectors (default x-y-z axes)
            if (isUnitVector) {
              return null;
            }
            
            // For transformed vectors, we need special handling for dimension changes
            const { matrix } = useMatrixStore();
            
            // Function to check if components differ in dimension or values
            const areComponentsDifferent = () => {
              // If no original vector, components are different
              if (!originalVector) return true;
              
              // If dimensions are different (like 3D to 2D), components are different
              if (components.length !== originalVector.components.length) return true;
              
              // Check each component value
              return !components.every((val, idx) => 
                originalVector.components[idx] !== undefined && 
                Math.abs(val - originalVector.components[idx]) < 0.001
              );
            };
            
            // Show coordinates if:
            // - Not a transformed vector, OR
            // - Is a transformed vector with different components from original
            const showCoordinates = !isTransformed || (isTransformed && areComponentsDifferent());
            
            // Only show coordinates if they're meaningful
            if (showCoordinates) {
              return (
                <Text
                  position={[
                    end.x + (end.x * 0.1), // Coordinates offset slightly from vector end (10% of vector length)
                    end.y + 0.6, // Closer to the vector tip than the label
                    end.z + (end.z * 0.1) // Minor Z offset to match the X offset
                  ]}
                  fontSize={0.25}
                  color={vector.color}
                  anchorX="center"
                  anchorY="bottom"
                  fillOpacity={opacity * 0.9}
                  outlineWidth={0.03}
                  outlineColor="#222222"
                  outlineOpacity={opacity * 0.7}
                  quaternion={camera.quaternion}
                >
                  {/* Format values to 2 decimal places */}
                  {`(${displayComponents.map(c => c.toFixed(2)).join(', ')})`}
                </Text>
              );
            }
            
            return null;
          })()}
        </>
      )}
    </group>
  );
};

export default Vector;
