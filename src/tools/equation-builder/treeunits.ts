/**
 * The multiplicative units exposed by the tree equation UI.
 *
 * Rendering and drag/drop must agree on these boundaries.  Keeping the split
 * here prevents a visible factor from resolving to a different expression
 * when it is dropped (notably the old `-2` / visible `2` mismatch).
 *
 * Only immediate factors of a top-level addend are units.  Interiors of a
 * power or function stay atomic: in `sin(x + 1) * e^5`, the movable units are
 * `sin(x + 1)` and `e^5`, not pieces of their internal syntax.
 */
import type { Side } from "./model";
import {
  type TNode,
  type TreeEq,
  addendsOf,
  signSplit,
  simplify,
  tc,
  tmul,
  tpow,
  varsIn,
} from "./tree";

export type TreeFactorZone = "n" | "d";
export type TreeFactorRole = "numer" | "den" | "coef";

export interface TreeFactorUnit {
  id: string;
  expr: TNode;
  zone: TreeFactorZone;
  index: number;
  role: TreeFactorRole;
}

export interface TreeFactorLayout {
  numerator: TreeFactorUnit[];
  denominator: TreeFactorUnit[];
  /** A product-level handle for the gaps and multiplication dots. */
  wholeNumerator: { id: string; expr: TNode; zone: "n" } | null;
}

/**
 * Split one displayed addend into numerator and denominator factors.
 *
 * A leading minus is rendered separately, so factor units are built from the
 * positive body.  A negative power is displayed below the fraction bar with
 * a positive exponent and must resolve to that same displayed expression.
 */
export function treeFactorLayout(addendId: string, addend: TNode): TreeFactorLayout {
  const { body } = signSplit(addend);
  const factors = body.kind === "mul" ? body.factors : [body];
  const numeratorExprs: TNode[] = [];
  const denominatorExprs: TNode[] = [];

  for (const factor of factors) {
    if (factor.kind === "pow" && factor.exp.kind === "const" && factor.exp.num < 0) {
      denominatorExprs.push(simplify(tpow(factor.base, tc(-factor.exp.num, factor.exp.den))));
    } else {
      numeratorExprs.push(factor);
    }
  }

  const numerator = numeratorExprs.map((expr, index): TreeFactorUnit => ({
    id: `${addendId}@n${index}`,
    expr,
    zone: "n",
    index,
    role: varsIn(expr).size === 0 ? "coef" : "numer",
  }));
  const denominator = denominatorExprs.map((expr, index): TreeFactorUnit => ({
    id: `${addendId}@d${index}`,
    expr,
    zone: "d",
    index,
    role: "den",
  }));

  // One factor already owns its complete glyph.  The product handle exists
  // only when there are gaps/dots that need a meaningful acquisition target.
  const wholeNumerator =
    numeratorExprs.length > 1
      ? {
          id: `${addendId}@N`,
          expr: simplify(tmul(...numeratorExprs)),
          zone: "n" as const,
        }
      : null;

  return { numerator, denominator, wholeNumerator };
}

/** Resolve a rendered factor handle back to the exact expression it shows. */
export function resolveTreeFactor(
  te: TreeEq,
  id: string
): { expr: TNode; zone: TreeFactorZone } | null {
  const match = id.match(/^([LR])(\d+)@(N|[nd]\d+)$/);
  if (!match) return null;

  const side: Side = match[1] === "L" ? "left" : "right";
  const addend = addendsOf(te[side])[Number(match[2])];
  if (!addend) return null;

  const layout = treeFactorLayout(`${match[1]}${match[2]}`, addend);
  if (match[3] === "N") return layout.wholeNumerator;

  const units = match[3][0] === "n" ? layout.numerator : layout.denominator;
  const unit = units[Number(match[3].slice(1))];
  return unit ? { expr: unit.expr, zone: unit.zone } : null;
}
