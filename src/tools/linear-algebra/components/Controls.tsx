import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useState, useRef } from "react";
import * as THREE from "three";

// This component adds orbit controls to the scene without resetting camera position
const Controls = () => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const [isVectorDragging, setIsVectorDragging] = useState(false);
  
  // Effect to detect when a vector is being dragged
  useEffect(() => {
    const handleDragStart = (event: MouseEvent) => {
      // Check if any vector arrowhead is clicked
      const canvas = document.querySelector('canvas');
      if (canvas?.getAttribute('data-vector-element') === 'true') {
        setIsVectorDragging(true);
        
        // Disable controls immediately
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
      }
    };
    
    const handleDragEnd = () => {
      // When pointer is released, re-enable controls
      setIsVectorDragging(false);
      
      // Small delay to prevent camera movement right after drag
      setTimeout(() => {
        if (controlsRef.current) {
          controlsRef.current.enabled = true;
        }
      }, 250); // Increased timeout to ensure dragging finishes before controls re-enable
    };
    
    // Use mousedown/mouseup for more reliable detection than pointerevents
    window.addEventListener('mousedown', handleDragStart);
    window.addEventListener('mouseup', handleDragEnd);
    
    return () => {
      window.removeEventListener('mousedown', handleDragStart);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, []);

  return (
    <OrbitControls
      ref={controlsRef}
      args={[camera, gl.domElement]}
      enableDamping={true}
      dampingFactor={0.05}
      rotateSpeed={0.6} // Further reduced rotation speed
      zoomSpeed={0.6}   // Further reduced zoom speed
      panSpeed={0.6}    // Further reduced pan speed
      minDistance={1}
      maxDistance={50}
      makeDefault
      enabled={!isVectorDragging} // Disable controls while dragging
    />
  );
};

export default Controls;
