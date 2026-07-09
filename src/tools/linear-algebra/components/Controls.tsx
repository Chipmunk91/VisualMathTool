import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

// Camera orbit controls. `makeDefault` registers them as the scene's default
// controls, which lets drei's TransformControls (the vector gizmo) disable
// them automatically while an axis handle is being dragged.
const Controls = () => {
  const { camera, gl } = useThree();

  return (
    <OrbitControls
      args={[camera, gl.domElement]}
      enableDamping={true}
      dampingFactor={0.05}
      rotateSpeed={0.6}
      zoomSpeed={0.6}
      panSpeed={0.6}
      minDistance={1}
      maxDistance={50}
      makeDefault
    />
  );
};

export default Controls;
