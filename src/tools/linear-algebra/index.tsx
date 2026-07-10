/**
 * Matrix Meets Vector — rebuilt.
 *
 * Design: the 3D space IS the page, in the same spirit as the equation
 * playground. No side panels. A floating matrix at the bottom is the only
 * standing UI; everything else appears when the situation calls for it.
 *
 * Architecture: one zustand store (matrix A, scrub t, vectors). The scene
 * renders lerp(I, A, t) — the grid carries it as a single Object3D matrix
 * on the GPU, basis arrows are its columns, user vectors are mapped through
 * it. Every future feature (determinant volume, eigen-axes, presets) reads
 * the same effective matrix.
 */
import { Canvas } from "@react-three/fiber";
import { Scene } from "./scene/Scene";
import { MatrixPanel } from "./MatrixPanel";

const LinearAlgebraTool = () => (
  <div className="relative h-full w-full bg-background text-foreground">
    <Canvas
      camera={{ position: [5.2, 3.8, 7.2], fov: 36 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <Scene />
    </Canvas>
    <MatrixPanel />
  </div>
);

export default LinearAlgebraTool;
