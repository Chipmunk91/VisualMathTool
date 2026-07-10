/**
 * Everything inside the canvas. The one idea that organizes the scene:
 * the space you are looking at is lerp(I, A, t) — the effective matrix.
 * The grid carries it as an Object3D matrix; vectors and basis arrows are
 * computed from it directly so arrowheads never shear.
 *
 * Open-world reveals: the determinant cube and the eigen-axes only exist
 * once A ≠ I; the tip knob converts drags back through the inverse map.
 */
import { useMemo } from "react";
import { OrbitControls } from "@react-three/drei";
import { useLinAlg } from "../store";
import { apply, column, invert, isIdentity, lerpMat, toMatrix4, IDENTITY } from "../lib/mat3";
import { realEigenAxes } from "../lib/eigen";
import { Grid } from "./Grid";
import { Axes } from "./Axes";
import { Arrow } from "./Arrow";
import { UnitCube, EigenAxisLine, TipHandle } from "./Extras";
import { COLOR } from "./palette";

export function Scene() {
  const matrix = useLinAlg((s) => s.matrix);
  const t = useLinAlg((s) => s.t);
  const vectors = useLinAlg((s) => s.vectors);
  const setVector = useLinAlg((s) => s.setVector);

  const effective = useMemo(() => lerpMat(IDENTITY, matrix, t), [matrix, t]);
  const effectiveM4 = useMemo(() => toMatrix4(effective), [effective]);
  const transformed = !isIdentity(matrix);
  const eigenAxes = useMemo(() => realEigenAxes(matrix), [matrix]);
  // Dragging the displayed tip means pulling it back through the current map
  const effectiveInv = useMemo(() => invert(effective), [effective]);

  return (
    <>
      {/* reference frame: static axes + the floor, which never transforms */}
      <Axes />
      <Grid plane="xz" opacity={0.13} />

      {/* the blackboard plane (xy) is the space that dances — one matrix
          carries the whole grid; a faint untouched copy stays behind it */}
      {transformed && <Grid plane="xy" opacity={0.08} />}
      <Grid plane="xy" matrix={effectiveM4} opacity={transformed ? 0.32 : 0.16} />

      {/* the unit cube: volume = |det A|, revealed with the transformation */}
      {transformed && <UnitCube matrix={effectiveM4} />}

      {/* invariant directions of A — only the real ones exist to draw */}
      {transformed && eigenAxes.map((axis) => <EigenAxisLine key={axis.dir.join(",")} axis={axis} />)}

      {/* basis vectors: the columns of the effective matrix, by definition */}
      <Arrow to={column(effective, 0)} color={COLOR.iHat} label="î" labelClass="not-italic" />
      <Arrow to={column(effective, 1)} color={COLOR.jHat} label="ĵ" labelClass="not-italic" />
      <Arrow to={column(effective, 2)} color={COLOR.kHat} label="k̂" labelClass="not-italic" />

      {/* the user's vectors, carried by the same map — tips are grabbable */}
      {vectors.map((u) => {
        const tip = apply(effective, u.v);
        return (
          <group key={u.id}>
            <Arrow to={tip} color={COLOR.vector} label={u.label} thickness={0.032} />
            {effectiveInv && (
              <TipHandle tip={tip} onDrag={(p) => setVector(u.id, apply(effectiveInv, p))} />
            )}
          </group>
        );
      })}

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
