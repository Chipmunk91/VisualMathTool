import * as THREE from "three";
import { useEffect } from "react";

interface GridProps {
  size?: number;
  divisions?: number;
  color?: string;
}

const Grid = ({ size = 10, divisions = 10, color = "#444444" }: GridProps) => {
  // Adjust divisions for larger grids to maintain a reasonable grid density
  // For 10x10 grid, we want 10 divisions (1 unit spacing)
  // For larger grids, make sure divisions aren't too dense or too sparse
  const adjustedDivisions = Math.min(Math.max(10, Math.floor(size)), 20);
  
  // Debug logging
  useEffect(() => {
    console.log("Rendering Grid component, size:", size, "adjusted divisions:", adjustedDivisions);
  }, [size, adjustedDivisions]);

  return (
    <>
      {/* XY Grid (floor) - with Z axis pointing up */}
      <gridHelper
        args={[size, adjustedDivisions, color, color]}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
      />
      
      {/* XZ Grid (vertical along Y) */}
      <gridHelper
        args={[size, adjustedDivisions, color, color]}
        position={[0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      
      {/* YZ Grid (vertical along X) */}
      <gridHelper
        args={[size, adjustedDivisions, color, color]}
        position={[0, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />
      
      {/* Light gray background plane for the floor (XY plane) */}
      <mesh 
        position={[0, 0, -0.01]} 
        rotation={[0, 0, 0]}
      >
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial 
          color="#f5f5f5" 
          transparent={true} 
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
};

export default Grid;
