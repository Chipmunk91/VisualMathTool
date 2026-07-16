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
  displayedProductFactors,
  signSplit,
  simplify,
  tmul,
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

export interface TreeFactorGroup {
  ids: string[];
  ownerId: string;
  expr: TNode;
  zone: TreeFactorZone;
}

/** Exact factor ids can participate in a multi-factor selection. */
export const isAtomicTreeFactorId = (id: string): boolean => /^[LR]\d+@[nd]\d+$/.test(id);

/**
 * Split one displayed addend into numerator and denominator factors.
 *
 * A leading minus is rendered separately, so factor units are built from the
 * positive body.  A negative power is displayed below the fraction bar with
 * a positive exponent and must resolve to that same displayed expression.
 */
export function treeFactorLayout(addendId: string, addend: TNode): TreeFactorLayout {
  const { body } = signSplit(addend);
  const { numerator: numeratorExprs, denominator: denominatorExprs } = displayedProductFactors(body);

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

/**
 * Resolve a marquee-selected multiplicative chunk into one exact product.
 * A group must live inside one addend and one side of its fraction bar;
 * mixing numerator and denominator units would make the gesture ambiguous.
 */
export function resolveTreeFactorGroup(te: TreeEq, ids: string[]): TreeFactorGroup | null {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0 || unique.some((id) => !isAtomicTreeFactorId(id))) return null;

  const parsed = unique.map((id) => {
    const match = id.match(/^([LR]\d+)@([nd])(\d+)$/);
    if (!match) return null;
    const resolved = resolveTreeFactor(te, id);
    return resolved
      ? { id, ownerId: match[1], zone: match[2] as TreeFactorZone, index: Number(match[3]), expr: resolved.expr }
      : null;
  });
  if (parsed.some((item) => item === null)) return null;
  const units = parsed as NonNullable<(typeof parsed)[number]>[];
  const ownerId = units[0].ownerId;
  const zone = units[0].zone;
  if (units.some((unit) => unit.ownerId !== ownerId || unit.zone !== zone)) return null;

  units.sort((a, b) => a.index - b.index);
  const expr = simplify(units.length === 1 ? units[0].expr : tmul(...units.map((unit) => unit.expr)));
  return { ids: units.map((unit) => unit.id), ownerId, expr, zone };
}

/** Pure marquee policy: prefer one valid factor chunk, otherwise addends. */
export function treeMarqueeSelection(te: TreeEq, factorIds: string[], addendIds: string[]): string[] {
  const group = resolveTreeFactorGroup(te, factorIds);
  if (group) return group.ids;
  return Array.from(new Set([...addendIds, ...factorIds.map((id) => id.split("@")[0])]));
}
