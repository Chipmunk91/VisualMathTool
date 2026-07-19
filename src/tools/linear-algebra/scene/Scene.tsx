/**
 * Everything inside the canvas. The organizing idea: the space you see is
 * effectiveAt(stages, T) — the current point of a journey of stage matrices
 * (a single A, a composition B·A, do-then-undo with A⁻¹, or the SVD's
 * rotate → stretch → rotate). Everything else derives from that one matrix.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLinAlg } from "../store";
import { apply, invert, invert2, matEquals, baseFor, toMatrix4, type Vec3 } from "../lib/mat3";
import { effectiveAt, journeyProduct, stagesFor } from "../lib/journey";
import { complexRotation2, complexRotation3, realEigenAxes, realEigenAxes2 } from "../lib/eigen";
import { columnSpace, nullSpace } from "../lib/spaces";
import { Grid } from "./Grid";
import { Axes } from "./Axes";
import { Arrow } from "./Arrow";
import {
  UnitCube,
  UnitSquare,
  EigenAxisLine,
  RotationDisc,
  TipHandle,
  SubspacePlane,
  SubspaceLine,
  SpanParallelogram,
} from "./Extras";

const column = (m: number[], i: number): Vec3 => [m[3 * i], m[3 * i + 1], m[3 * i + 2]];

/** A gentle camera preset: front-on for pure 2D maps, the 3D vantage otherwise */
function CameraRig({ flat }: { flat: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;
  useEffect(() => {
    if (!controls) return;
    if (flat) {
      camera.position.set(0.4, 0.9, 10.5);
      controls.target.set(0.4, 0.9, 0);
    } else {
      camera.position.set(5.2, 3.8, 7.2);
      controls.target.set(0, 0.6, 0);
    }
    controls.update();
  }, [flat, camera, controls]);
  return null;
}

export function Scene() {
  const matrix = useLinAlg((s) => s.matrix);
  const matrixB = useLinAlg((s) => s.matrixB);
  const journey = useLinAlg((s) => s.journey);
  const rows = useLinAlg((s) => s.rows);
  const cols = useLinAlg((s) => s.cols);
  const t = useLinAlg((s) => s.t);
  const vectors = useLinAlg((s) => s.vectors);
  const setVector = useLinAlg((s) => s.setVector);

  const stages = useMemo(
    () => stagesFor(journey, matrix, matrixB, rows, cols),
    [journey, matrix, matrixB, rows, cols]
  );
  const effective = useMemo(() => effectiveAt(stages, t, cols), [stages, t, cols]);
  const effectiveM4 = useMemo(() => toMatrix4(effective), [effective]);
  const product = useMemo(() => journeyProduct(stages), [stages]);
  const transformed = !matEquals(matrix, baseFor(cols)) || journey === "compose";

  // Eigen-axes belong to the full end-to-end map (only square shapes have them)
  const eigenAxes = useMemo(() => {
    if (rows !== cols) return [];
    return rows === 3 ? realEigenAxes(product) : realEigenAxes2(product);
  }, [product, rows, cols]);

  // A complex pair is the map's rotation — drawn as the plane it spins
  const spinPlane = useMemo(() => {
    if (rows !== cols) return null;
    return rows === 3 ? complexRotation3(product) : complexRotation2(product);
  }, [product, rows, cols]);

  // Column space of the final map (where outputs can land), null space (what dies)
  const colSpace = useMemo(() => columnSpace(product, rows, cols), [product, rows, cols]);
  const nulSpace = useMemo(() => nullSpace(product, rows, cols), [product, rows, cols]);

  // Dragging the displayed tip means pulling it back through the current map
  const pullback = useMemo(() => {
    if (rows !== cols) return null; // between different spaces there is no unique pre-image
    if (rows === 3) {
      const inv = invert(effective);
      return inv ? (p: Vec3) => apply(inv, p) : null;
    }
    const inv = invert2(effective);
    return inv ? (p: Vec3) => apply(inv, [p[0], p[1], 0]) : null;
  }, [effective, rows, cols]);

  const tips = vectors.map((u) => apply(effective, u.v));

  return (
    <>
      <CameraRig flat={rows === 2 && cols === 2} />

      {/* reference frame: static axes + the floor, which never transforms */}
      <Axes />
      <Grid plane="xz" opacity={0.13} />

      {/* the blackboard plane (xy) is the space that dances — one matrix
          carries the whole grid; a faint untouched copy stays behind it */}
      {transformed && <Grid plane="xy" opacity={0.08} />}
      <Grid plane="xy" matrix={effectiveM4} opacity={transformed ? 0.32 : 0.16} />

      {/* the volume/area witness: cube for a 3D domain, square for a 2D one */}
      {transformed && (cols === 3 ? <UnitCube matrix={effectiveM4} /> : <UnitSquare matrix={effectiveM4} />)}

      {/* invariant directions — only the real ones exist to draw */}
      {transformed && eigenAxes.map((axis) => <EigenAxisLine key={axis.dir.join(",")} axis={axis} />)}

      {/* the complex pair: no axis holds still, but a plane spins in place */}
      {transformed && spinPlane && <RotationDisc rot={spinPlane} />}

      {/* rank-deficient maps: where everything must land, and what is crushed */}
      {transformed && colSpace.kind === "plane" && (
        <SubspacePlane normal={colSpace.normal!} label="column space" />
      )}
      {transformed && colSpace.kind === "line" && (
        <SubspaceLine dir={colSpace.dir!} color="#0284c7" label="column space" />
      )}
      {transformed && nulSpace.kind === "line" && (
        <SubspaceLine dir={nulSpace.dir!} label="null space → 0" />
      )}
      {transformed && nulSpace.kind === "plane" && (
        <SubspacePlane normal={nulSpace.normal!} color="#71717a" label="null space → 0" />
      )}

      {/* basis vectors: the columns of the effective matrix, by definition;
          k̂ only exists when the domain is three-dimensional */}
      <Arrow to={column(effective, 0)} color="#e11d48" label="î" labelClass="not-italic" />
      <Arrow to={column(effective, 1)} color="#059669" label="ĵ" labelClass="not-italic" />
      {cols === 3 && <Arrow to={column(effective, 2)} color="#0284c7" label="k̂" labelClass="not-italic" />}

      {/* the span of two vectors, made visible as their parallelogram */}
      {vectors.length === 2 && <SpanParallelogram a={tips[0]} b={tips[1]} />}

      {/* the user's vectors, carried by the same map — tips are grabbable
          whenever the map can be undone */}
      {vectors.map((u, i) => (
        <group key={u.id}>
          <Arrow to={tips[i]} color={u.color} label={u.label} thickness={0.032} />
          {pullback && (
            <TipHandle
              tip={tips[i]}
              color={u.color}
              planeNormal={rows === 2 && cols === 2 ? [0, 0, 1] : undefined}
              onDrag={(p) => setVector(u.id, pullback(p))}
            />
          )}
        </group>
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={3}
        maxDistance={30}
        target={[0, 0.6, 0]}
      />
    </>
  );
}
