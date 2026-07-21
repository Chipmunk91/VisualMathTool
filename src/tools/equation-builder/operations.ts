/**
 * Pure symbol-operation dispatch for the canonical expression tree.
 *
 * The React surface reports a semantic payload and target; this module is the
 * only place that translates that gesture into an algebraic move. Geometry,
 * pointer state and rendering stay outside, which makes the operation grammar
 * independently testable.
 */
import type { Side, Variable } from "./model";
import {
  type TNode,
  type TreeEq,
  keyOf,
  printNode,
  simplify,
  splitCoef,
  tc,
  tmul,
  tv,
  varsIn,
} from "./tree";
import {
  applyToolT,
  cancelFactorT,
  divideBothT,
  moveTermsT,
  multiplyBothT,
  raiseBothT,
  rootBothT,
  type TreeMoveResult,
  type TreeToolKind,
} from "./treemoves";
import {
  ownerOfTreeHandleId,
  resolveTreeFactor,
  resolveTreeFactorGroup,
  treeAddendById,
} from "./treeunits";

export type ToolKind = TreeToolKind;

export type DragPayload =
  | { kind: "terms"; ids: string[]; from: Side }
  | { kind: "factorGroup"; ids: string[]; from: Side }
  | { kind: "coef"; termId: string; from: Side }
  | { kind: "den"; termId: string; from: Side }
  | { kind: "xdiv"; termId: string; from: Side }
  | { kind: "numer"; termId: string; from: Side }
  | { kind: "lnbase"; termId: string; from: Side }
  | { kind: "root"; termId: string; n: number; from: Side }
  | { kind: "raise"; termId: string; n: number; from: Side }
  | { kind: "tool"; tool: ToolKind };

export type DropTarget =
  | { kind: "side"; side: Side }
  | { kind: "parens"; termId: string; side: Side }
  | { kind: "under"; termId: string; side: Side }
  | { kind: "onexp"; termId: string; side: Side }
  | { kind: "onterm"; termId: string; side: Side }
  | { kind: "funcparens"; termId: string; side: Side }
  | { kind: "bound"; which: "lo" | "hi" | "at" }
  | { kind: "unit"; unitId: string; side: Side };

export const treeAddendExpression = (te: TreeEq, id: string): TNode | null =>
  treeAddendById(te, ownerOfTreeHandleId(id))?.node ?? null;

/** The exact constant-valued factor represented by a coefficient handle. */
export function treeCoefficientExpression(te: TreeEq, id: string): TNode | null {
  const exact = resolveTreeFactor(te, id);
  if (exact) return exact.expr;
  const addend = treeAddendExpression(te, id);
  if (!addend) return null;
  const { num, den, core } = splitCoef(addend);
  const constantParts = core.filter((factor) => varsIn(factor).size === 0);
  const parts: TNode[] = [
    ...(Math.abs(num) === 1 && den === 1 ? [] : [tc(Math.abs(num), den)]),
    ...constantParts,
  ];
  if (parts.length === 0) return null;
  return simplify(parts.length === 1 ? parts[0] : tmul(...parts));
}

/**
 * The equation-wide visual that accompanies a valid tree operation.
 *
 * This intentionally consumes the same semantic payload and drop target as
 * `computeTreeOperation`. Keeping it here prevents the renderer from guessing
 * that an additive x and a multiplicative x are different operations: both
 * become an exact divide preview when their target is a denominator zone.
 */
export type TreeOperationPreview =
  | { kind: "divide"; text: string }
  | { kind: "multiply"; text: string }
  | { kind: "wrap"; before: string; after: string };

export function previewTreeOperation(
  te: TreeEq,
  payload: DragPayload,
  target: DropTarget
): TreeOperationPreview | null {
  const onStage = target.kind === "under" || target.kind === "side";
  if (!onStage) return null;

  switch (payload.kind) {
    case "factorGroup": {
      const group = resolveTreeFactorGroup(te, payload.ids);
      if (!group) return null;
      if (group.zone === "n") return { kind: "divide", text: printNode(group.expr) };
      return target.kind === "side" ? { kind: "multiply", text: printNode(group.expr) } : null;
    }
    case "coef": {
      const expr = treeCoefficientExpression(te, payload.termId);
      return expr ? { kind: "divide", text: printNode(expr) } : null;
    }
    case "numer": {
      const factor = resolveTreeFactor(te, payload.termId);
      return factor ? { kind: "divide", text: printNode(factor.expr) } : null;
    }
    case "den": {
      if (target.kind !== "side") return null;
      const factor = resolveTreeFactor(te, payload.termId);
      return factor ? { kind: "multiply", text: printNode(factor.expr) } : null;
    }
    case "terms": {
      if (target.kind !== "under") return null;
      const addend = treeAddendExpression(te, payload.ids[0]);
      return addend ? { kind: "divide", text: printNode(addend) } : null;
    }
    case "xdiv":
      return { kind: "divide", text: payload.termId.match(/@(x|y)$/)?.[1] ?? "x" };
    case "lnbase":
      return { kind: "wrap", before: "ln(", after: ")" };
    case "root":
      return {
        kind: "wrap",
        before: payload.n === 2 ? "√(" : payload.n === 3 ? "∛(" : `${payload.n}√(`,
        after: ")",
      };
    case "raise":
      return { kind: "wrap", before: "(", after: `)^${payload.n}` };
    default:
      return null;
  }
}

/** Translate one semantic tree gesture into one pure algebraic operation. */
export function computeTreeOperation(
  te: TreeEq,
  payload: DragPayload,
  target: DropTarget
): TreeMoveResult {
  if (target.kind === "bound") return null;
  if (payload.kind === "tool") {
    if (target.kind === "onterm") {
      return "rebuilding single terms arrives with the full tree grammar — click the symbol to apply it to both sides";
    }
    return applyToolT(payload.tool, te);
  }
  if (payload.kind === "factorGroup") {
    const group = resolveTreeFactorGroup(te, payload.ids);
    if (!group) return "select factors from one product row — numerator and denominator chunks move separately";
    const text = printNode(group.expr);
    if (group.zone === "n") {
      return target.kind === "under" || target.kind === "side" ? divideBothT(te, group.expr, text) : null;
    }
    if (target.kind === "under") return "a denominator group multiplies — drop it beside the other side";
    return target.kind === "side" ? multiplyBothT(te, group.expr, text) : null;
  }
  if (target.kind === "unit" && (payload.kind === "numer" || payload.kind === "den" || payload.kind === "coef")) {
    const mine = resolveTreeFactor(te, payload.termId);
    const theirs = resolveTreeFactor(te, target.unitId);
    if (!mine || !theirs) return null;
    if (keyOf(simplify(mine.expr)) !== keyOf(simplify(theirs.expr))) {
      return "only an identical pair cancels — these factors don't match";
    }
    if (mine.ownerId !== theirs.ownerId) return "cancel within one term — these factors live in different terms";
    return cancelFactorT(te, mine.ownerId, mine.expr, printNode(mine.expr));
  }
  if (payload.kind === "coef") {
    const expr = treeCoefficientExpression(te, payload.termId);
    return expr ? divideBothT(te, expr, printNode(expr)) : null;
  }
  if (payload.kind === "xdiv") {
    // Compatibility for pre-tree handles restored from an old shared link.
    const legacy = payload.termId.match(/@(x|y)$/)?.[1] as Variable | undefined;
    if (!legacy) return null;
    return target.kind === "under" || target.kind === "side" ? divideBothT(te, tv(legacy), legacy) : null;
  }
  if (payload.kind === "numer") {
    const factor = resolveTreeFactor(te, payload.termId);
    return factor && (target.kind === "under" || target.kind === "side")
      ? divideBothT(te, factor.expr, printNode(factor.expr))
      : null;
  }
  if (payload.kind === "lnbase") {
    return target.kind === "under" || target.kind === "side" ? applyToolT("ln", te) : null;
  }
  if (payload.kind === "root") {
    return payload.n >= 2 && (target.kind === "under" || target.kind === "side") ? rootBothT(te, payload.n) : null;
  }
  if (payload.kind === "raise") {
    return payload.n >= 2 && (target.kind === "under" || target.kind === "side") ? raiseBothT(te, payload.n) : null;
  }
  if (payload.kind === "den") {
    const factor = resolveTreeFactor(te, payload.termId);
    if (!factor) return null;
    if (target.kind === "under") return "a denominator multiplies — drop it beside the other side";
    return target.kind === "side" ? multiplyBothT(te, factor.expr, printNode(factor.expr)) : null;
  }
  if (payload.kind === "terms") {
    if (target.kind === "under") {
      const addend = treeAddendExpression(te, payload.ids[0]);
      return addend ? divideBothT(te, addend, printNode(addend)) : null;
    }
    return target.kind === "side" ? moveTermsT(te, payload.ids, payload.from, target.side) : null;
  }
  return null;
}
