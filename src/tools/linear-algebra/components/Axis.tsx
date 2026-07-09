import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

// Axis component with Text labels
interface AxisProps {
  length?: number;
}

const Axis = ({ length = 10 }: AxisProps) => {
  // Use the provided axis length or default to 10
  const axisLength = length;
  
  // Get camera for billboard text
  const { camera } = useThree();
  
  // Debug info
  console.log("Rendering Axis component, length:", axisLength);
  
  return (
    <group>
      {/* X Axis (Red) - Thick line */}
      <mesh position={[axisLength/2, 0, 0]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.05, 0.05, axisLength, 8]} />
        <meshStandardMaterial color="red" />
      </mesh>
      
      {/* Y Axis (Green) - Thick line */}
      <mesh position={[0, axisLength/2, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, axisLength, 8]} />
        <meshStandardMaterial color="green" />
      </mesh>
      
      {/* Z Axis (Blue) - Thick line - Properly vertical */}
      <mesh position={[0, 0, axisLength/2]} rotation={[Math.PI/2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, axisLength, 8]} />
        <meshStandardMaterial color="blue" />
      </mesh>
      
      {/* Large sphere at origin */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color="white" />
      </mesh>
      
      {/* Cone at the end of X axis */}
      <mesh position={[axisLength, 0, 0]} rotation={[0, 0, -Math.PI/2]}>
        <coneGeometry args={[0.2, 0.5, 8]} />
        <meshStandardMaterial color="red" />
      </mesh>
      
      {/* Cone at the end of Y axis */}
      <mesh position={[0, axisLength, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.2, 0.5, 8]} />
        <meshStandardMaterial color="green" />
      </mesh>
      
      {/* Cone at the end of Z axis - Now pointing up */}
      <mesh position={[0, 0, axisLength]}>
        <coneGeometry args={[0.2, 0.5, 8]} />
        <meshStandardMaterial color="blue" />
      </mesh>
      
      {/* Axis labels */}
      {/* X Axis Label */}
      <Text
        position={[axisLength + 0.7, 0, 0]}
        fontSize={0.8}
        color="red"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#000000"
        quaternion={camera.quaternion}
      >
        X
      </Text>
      
      {/* Y Axis Label */}
      <Text
        position={[0, axisLength + 0.7, 0]}
        fontSize={0.8}
        color="green"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#000000"
        quaternion={camera.quaternion}
      >
        Y
      </Text>
      
      {/* Z Axis Label */}
      <Text
        position={[0, 0, axisLength + 0.7]}
        fontSize={0.8}
        color="blue"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#000000"
        quaternion={camera.quaternion}
      >
        Z
      </Text>
    </group>
  );
};

export default Axis;
