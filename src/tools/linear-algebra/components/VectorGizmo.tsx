import { useEffect, useRef } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { useVectorStore } from "../lib/stores/useVectorStore";

/**
 * Industry-standard translate gizmo (à la Unity/Blender) attached to the
 * selected vector's tip. Click a vector's arrowhead to select it, then drag
 * the red/green/blue axis handles to move the tip precisely along one axis
 * (or a plane). OrbitControls is `makeDefault`, so drei automatically
 * disables camera movement while a handle is being dragged.
 */
const VectorGizmo = () => {
  const { vectors, selectedVectorId, updateVector } = useVectorStore();
  const proxyRef = useRef<THREE.Group>(null);

  const vector = vectors.find(
    (v) =>
      v.id === selectedVectorId &&
      !v.isTransformed &&
      !v.id.startsWith("default-")
  );

  const is3D = (vector?.components.length ?? 3) === 3;

  // Keep the proxy in sync when the vector changes from the input panel
  useEffect(() => {
    if (!vector || !proxyRef.current) return;
    const [x = 0, y = 0, z = 0] = vector.components;
    proxyRef.current.position.set(x, y, z);
  }, [vector?.components[0], vector?.components[1], vector?.components[2], vector?.id]);

  if (!vector) return null;

  const handleChange = () => {
    const p = proxyRef.current?.position;
    if (!p) return;
    const components = (is3D ? [p.x, p.y, p.z] : [p.x, p.y]).map(
      (c) => Math.round(c * 100) / 100
    );
    for (let i = 0; i < components.length; i++) {
      updateVector(vector.id, components, components[i].toFixed(2), i);
    }
  };

  return (
    <>
      <group ref={proxyRef} />
      <TransformControls
        object={proxyRef as React.MutableRefObject<THREE.Group>}
        mode="translate"
        size={0.8}
        showZ={is3D}
        translationSnap={0.25}
        onObjectChange={handleChange}
      />
    </>
  );
};

export default VectorGizmo;
