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
  type TNodeId,
  type TreeEq,
  addendsOf,
  displayedProductUnits,
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

const FACTOR_PREFIX = "factor:";
const PRODUCT_PREFIX = "product:";

export const factorHandleId = (ownerId: TNodeId, zone: TreeFactorZone, nodeId: TNodeId): string =>
  `${FACTOR_PREFIX}${ownerId}:${zone}:${nodeId}`;

export const wholeNumeratorHandleId = (ownerId: TNodeId): string => `${PRODUCT_PREFIX}${ownerId}:n`;

export function parseFactorHandleId(
  id: string
): { ownerId: TNodeId; zone: TreeFactorZone; nodeId: TNodeId } | null {
  if (!id.startsWith(FACTOR_PREFIX)) return null;
  const [ownerId, zone, nodeId, ...extra] = id.slice(FACTOR_PREFIX.length).split(":");
  if (!ownerId || (zone !== "n" && zone !== "d") || !nodeId || extra.length > 0) return null;
  return { ownerId, zone, nodeId };
}

export function ownerOfTreeHandleId(id: string): TNodeId {
  const factor = parseFactorHandleId(id);
  if (factor) return factor.ownerId;
  if (id.startsWith(PRODUCT_PREFIX)) return id.slice(PRODUCT_PREFIX.length).split(":")[0] || id;
  return id;
}

/** Exact semantic factor handles can participate in a multi-factor selection. */
export const isAtomicTreeFactorId = (id: string): boolean => parseFactorHandleId(id) !== null;

export function treeAddendById(
  te: TreeEq,
  id: TNodeId
): { node: TNode; side: Side; index: number } | null {
  for (const side of ["left", "right"] as const) {
    const index = addendsOf(te[side]).findIndex((addend) => addend.id === id);
    if (index >= 0) return { node: addendsOf(te[side])[index], side, index };
  }
  return null;
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
  const { numerator: numeratorUnits, denominator: denominatorUnits } = displayedProductUnits(body);
  const numeratorExprs = numeratorUnits.map((unit) => unit.expr);

  const numerator = numeratorUnits.map((unit, index): TreeFactorUnit => ({
    id: factorHandleId(addendId, "n", unit.sourceId),
    expr: unit.expr,
    zone: "n",
    index,
    role: varsIn(unit.expr).size === 0 ? "coef" : "numer",
  }));
  const denominator = denominatorUnits.map((unit, index): TreeFactorUnit => ({
    id: factorHandleId(addendId, "d", unit.sourceId),
    expr: unit.expr,
    zone: "d",
    index,
    role: "den",
  }));

  // One factor already owns its complete glyph.  The product handle exists
  // only when there are gaps/dots that need a meaningful acquisition target.
  const wholeNumerator =
    numeratorExprs.length > 1
      ? {
          id: wholeNumeratorHandleId(addendId),
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
): { expr: TNode; zone: TreeFactorZone; ownerId: TNodeId; side: Side } | null {
  const factor = parseFactorHandleId(id);
  const wholeOwner = id.startsWith(PRODUCT_PREFIX)
    ? id.slice(PRODUCT_PREFIX.length).split(":")[0]
    : null;
  const ownerId = factor?.ownerId ?? wholeOwner;
  if (!ownerId) return null;
  const found = treeAddendById(te, ownerId);
  if (!found) return null;
  const layout = treeFactorLayout(ownerId, found.node);
  if (wholeOwner) {
    return layout.wholeNumerator?.id === id
      ? { expr: layout.wholeNumerator.expr, zone: "n", ownerId, side: found.side }
      : null;
  }
  const unit = [...layout.numerator, ...layout.denominator].find((candidate) => candidate.id === id);
  return unit ? { expr: unit.expr, zone: unit.zone, ownerId, side: found.side } : null;
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
    const handle = parseFactorHandleId(id);
    if (!handle) return null;
    const resolved = resolveTreeFactor(te, id);
    return resolved
      ? {
          id,
          ownerId: handle.ownerId,
          zone: handle.zone,
          index: treeFactorLayout(handle.ownerId, treeAddendById(te, handle.ownerId)!.node)[
            handle.zone === "n" ? "numerator" : "denominator"
          ].findIndex((unit) => unit.id === id),
          expr: resolved.expr,
        }
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
  return Array.from(new Set([...addendIds, ...factorIds.map(ownerOfTreeHandleId)]));
}
