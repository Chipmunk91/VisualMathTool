/**
 * Everything inside the canvas. The one idea that organizes the scene:
 * the space you are looking at is lerp(base, A, t) — the effective matrix,
 * where "base" is the untransformed domain (all of R³, or the xy-plane
 * sitting in place when the input space is 2D).
 *
 * Dimensions decide what exists: a 2×3 flattens the cube onto the plane,
 * a 3×2 tilts the blackboard out into space, and k̂ only exists when the
 * domain has a third direction.
 */
import { useMemo } from "react";
import { OrbitControls } from "@react-three/drei";
import { useLinAlg } from "../store";
import {
  apply,
  baseFor,
  column,
  invert,
  invert2,
  lerpMat,
  matEquals,
  toMatrix4,
} from "../lib/mat3";
import { realEigenAxes, realEigenAxes2 } from "../lib/eigen";
import { Grid } from "./Grid";
import { Axes } from "./Axes";
import { Arrow } from "./Arrow";
import { UnitCube, UnitSquare, EigenAxisLine, TipHandle } from "./Extras";
import { COLOR } from "./palette";

export function Scene() {
  const matrix = useLinAlg((s) => s.matrix);
  const rows = useLinAlg((s) => s.rows);
  const cols = useLinAlg((s) => s.cols);
  const t = useLinAlg((s) => s.t);
  const vectors = useLinAlg((s) => s.vectors);
  const setVector = useLinAlg((s) => s.setVector);

  const base = useMemo(() => baseFor(cols), [cols]);
  const effective = useMemo(() => lerpMat(base, matrix, t), [base, matrix, t]);
  const effectiveM4 = useMemo(() => toMatrix4(effective), [effective]);
  const transformed = !matEquals(matrix, base);
  const eigenAxes = useMemo(() => {
    if (rows !== cols) return []; // eigen only exists for maps of a space to itself
    return rows === 3 ? realEigenAxes(matrix) : realEigenAxes2(matrix);
  }, [matrix, rows, cols]);

  // Dragging the displayed tip means pulling it back through the current map
  const pullback = useMemo(() => {
    if (rows === 3 && cols === 3) {
      const inv = invert(effective);
      return inv ? (p: [number, number, number]) => apply(inv, p) : null;
    }
    if (rows === 2 && cols === 2) {
      const inv = invert2(effective);
      return inv ? (p: [number, number, number]) => apply(inv, [p[0], p[1], 0]) : null;
    }
    return null; // between different spaces there is no unique pre-image
  }, [effective, rows, cols]);

  return (
    <>
      {/* reference frame: static axes + the floor, which never transforms */}
      <Axes />
      <Grid plane="xz" opacity={0.13} />

      {/* the blackboard plane (xy) is the space that dances — one matrix
          carries the whole grid; a faint untouched copy stays behind it */}
      {transformed && <Grid plane="xy" opacity={0.08} />}
      <Grid plane="xy" matrix={effectiveM4} opacity={transformed ? 0.32 : 0.16} />

      {/* the volume/area witness: cube for a 3D domain, square for a 2D one */}
      {transformed && (cols === 3 ? <UnitCube matrix={effectiveM4} /> : <UnitSquare matrix={effectiveM4} />)}

      {/* invariant directions of A — only the real ones exist to draw */}
      {transformed && eigenAxes.map((axis) => <EigenAxisLine key={axis.dir.join(",")} axis={axis} />)}

      {/* basis vectors: the columns of the effective matrix, by definition;
          k̂ only exists when the domain is three-dimensional */}
      <Arrow to={column(effective, 0)} color={COLOR.iHat} label="î" labelClass="not-italic" />
      <Arrow to={column(effective, 1)} color={COLOR.jHat} label="ĵ" labelClass="not-italic" />
      {cols === 3 && <Arrow to={column(effective, 2)} color={COLOR.kHat} label="k̂" labelClass="not-italic" />}

      {/* the user's vectors, carried by the same map — tips are grabbable
          whenever the map can be undone */}
      {vectors.map((u) => {
        const tip = apply(effective, u.v);
        return (
          <group key={u.id}>
            <Arrow to={tip} color={COLOR.vector} label={u.label} thickness={0.032} />
            {pullback && (
              <TipHandle
                tip={tip}
                planeNormal={rows === 2 && cols === 2 ? [0, 0, 1] : undefined}
                onDrag={(p) => setVector(u.id, pullback(p))}
              />
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
