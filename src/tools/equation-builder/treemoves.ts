/**
 * Moves on tree equations. Each move is a pure rewrite typed to return its
 * assumptions: { …, pill } — the type is the guardrail. A conditional
 * identity (cancel x/x, undo a √ by squaring, e^(ln u) → u) can ONLY happen
 * here, never in the simplifier, and never without declaring itself.
 *
 * After every move the result tries to re-enter the flat model (flatNext):
 * the moment an equation becomes flat-representable it drops back into the
 * full flat game with all its moves.
 */
import { combine, leaf, type EquationState, type Side } from "./model";
import {
  TNode,
  TreeEq,
  addendsOf,
  constValue,
  keyOf,
  printNode,
  sideFromAddends,
  simplify,
  tc,
  tfn,
  tmul,
  tpow,
  treeSideToFlat,
  varsIn,
} from "./tree";

export interface TreeOutcome {
  treeNext: TreeEq | null;
  flatNext: EquationState | null;
  label: string;
  dangerous?: boolean;
  note?: string;
  pill?: string;
}

export type TreeMoveResult = TreeOutcome | string | null;

/** Simplify both sides, then try the escape hatch back to the flat model */
export function finalize(
  left: TNode,
  right: TNode,
  label: string,
  extra?: { dangerous?: boolean; note?: string; pill?: string }
): TreeOutcome {
  const l = simplify(left);
  const r = simplify(right);
  const fl = treeSideToFlat(l);
  const fr = treeSideToFlat(r);
  if (fl && fr) {
    return {
      treeNext: null,
      flatNext: { left: combine(fl.length ? fl : [leaf(0)]), right: combine(fr.length ? fr : [leaf(0)]) },
      label,
      ...extra,
    };
  }
  return { treeNext: { left: l, right: r }, flatNext: null, label, ...extra };
}

const addendAt = (te: TreeEq, id: string): { node: TNode; side: Side; index: number } | null => {
  const side: Side = id.startsWith("L") ? "left" : "right";
  const index = parseInt(id.slice(1), 10); // ids may carry a handle suffix (L0@x)
  const list = addendsOf(te[side]);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return { node: list[index], side, index };
};

/** Move addends across the equals sign — negate and carry. Unconditional. */
export function moveTermsT(te: TreeEq, ids: string[], from: Side, to: Side): TreeMoveResult {
  if (from === to) return null;
  const picks = ids
    .map((id) => addendAt(te, id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.side === from)
    .filter((p, i, arr) => arr.findIndex((q) => q.index === p.index) === i)
    .sort((a, b) => a.index - b.index);
  if (picks.length === 0) return null;
  const fromList = addendsOf(te[from]).filter((_, i) => !picks.some((p) => p.index === i));
  const moved = picks.map((p) => simplify(tmul(tc(-1), p.node)));
  const toList = [...addendsOf(te[to]), ...moved];
  const text = picks.map((p) => printNode(p.node)).join(", ");
  const next: TreeEq = { ...te, [from]: sideFromAddends(fromList), [to]: sideFromAddends(toList) };
  return finalize(next.left, next.right, `moved ${text} across`);
}

/**
 * "expr ≠ 0" as simplifier licenses: a nonzero product means every factor is
 * nonzero, so each factor's base may cancel — not just the whole expression.
 */
const nonzeroKeys = (expr: TNode): Set<string> => {
  const s = simplify(expr);
  const keys = new Set([keyOf(s)]);
  const factors = s.kind === "mul" ? s.factors : [s];
  for (const f of factors) keys.add(keyOf(f.kind === "pow" ? f.base : f));
  return keys;
};

/** Divide both sides by an expression — term by term, with the ≠ 0 pill. */
export function divideBothT(te: TreeEq, expr: TNode, exprText: string): TreeMoveResult {
  const value = constValue(expr);
  if (value === 0) return "can't divide by zero";
  if (value === 1) return null;
  const hasVars = varsIn(expr).size > 0;
  // the pill below DECLARES expr ≠ 0 — which licenses the simplifier to
  // cancel opposite powers of exactly its factors, and nothing else
  const assume = hasVars ? nonzeroKeys(expr) : undefined;
  const divide = (side: TNode): TNode =>
    sideFromAddends(addendsOf(side).map((a) => simplify(tmul(a, tpow(expr, -1)), assume)));
  const dividedZero = (side: TNode): TNode => (addendsOf(side).length === 0 ? tc(0) : divide(side));
  return finalize(dividedZero(te.left), dividedZero(te.right), `divided both sides by ${exprText}`, {
    dangerous: hasVars,
    note: hasVars ? `only valid where ${exprText} ≠ 0 — a solution could hide there` : undefined,
    pill: hasVars ? `${exprText} ≠ 0` : undefined,
  });
}

/**
 * Multiply both sides by an expression. Reached from a DENOMINATOR handle,
 * so expr's nonzero-ness is already part of the equation's own domain —
 * this is the flat model's "the denominator multiplies both sides", and
 * like there it is a clean move, not a pilled one.
 */
export function multiplyBothT(te: TreeEq, expr: TNode, exprText: string): TreeMoveResult {
  if (constValue(expr) === 1) return null;
  const assume = nonzeroKeys(expr);
  const times = (side: TNode): TNode =>
    addendsOf(side).length === 0
      ? tc(0)
      : sideFromAddends(addendsOf(side).map((a) => simplify(tmul(a, expr), assume)));
  return finalize(times(te.left), times(te.right), `multiplied both sides by ${exprText}`);
}

/**
 * Take the n-th root of both sides — the exponent handle's move (dragging
 * the 3 of x³ or e³ across the equals sign). Odd roots are unconditional;
 * even roots keep only the principal branch, and say so.
 */
export function rootBothT(te: TreeEq, n: number): TreeMoveResult {
  if (!Number.isInteger(n) || n < 2) return null;
  const root = (side: TNode): TNode => {
    const s = simplify(side);
    // (xⁿ)^(1/n) → x directly — the fractional-exponent fold is deliberately
    // NOT in simplify (x² → |x| territory), so the move does it here, where
    // the even case is pilled as principal-branch
    if (s.kind === "pow" && s.exp.kind === "const" && s.exp.den === 1 && s.exp.num === n) {
      return simplify(s.base);
    }
    return simplify(tpow(s, tc(1, n)));
  };
  const even = n % 2 === 0;
  const ord = n === 2 ? "square" : n === 3 ? "cube" : `${n}th`;
  return finalize(root(te.left), root(te.right), `took the ${ord} root of both sides`, {
    dangerous: even,
    note: even ? "an even root keeps the principal branch — a negative branch may be lost" : undefined,
    pill: even ? "principal root" : undefined,
  });
}

/* --- toolbox operations on tree equations -------------------------------- */

type SideResult = { node: TNode; pill?: string; dangerous?: boolean; note?: string } | string;

/** ln of one side: thaws e^u and a^u exactly; wraps the rest with sides > 0 */
function lnOfNode(side: TNode): SideResult {
  const factors = side.kind === "mul" ? side.factors : [side];
  const parts: TNode[] = [];
  for (const f of factors) {
    if (f.kind === "const") {
      if (f.num <= 0) return "ln is only defined for positive numbers — one side isn't positive";
      if (f.num !== f.den) parts.push(tfn("ln", f));
      continue;
    }
    if (f.kind === "fn" && f.fn === "exp") {
      parts.push(f.arg); // ln(e^u) = u — e^u is always positive
      continue;
    }
    if (f.kind === "pow" && f.base.kind === "const" && f.base.num > 0 && f.base.den > 0) {
      // ln(a^u) = u·ln a for a positive constant a — a^u is always positive
      if (f.base.num !== f.base.den) parts.push(tmul(f.exp, tfn("ln", f.base)));
      continue;
    }
    // an opaque factor: wrap the whole side instead, with the assumption
    return {
      node: tfn("ln", side),
      dangerous: true,
      note: "ln is only defined where both sides are positive — solutions elsewhere are lost",
      pill: "sides > 0",
    };
  }
  return { node: sideFromAddends(parts) };
}

/** e^( ) of one side: unwraps ln u to u; wraps anything else */
function expOfNode(side: TNode): SideResult {
  if (side.kind === "fn" && side.fn === "ln") return { node: side.arg };
  return { node: tfn("exp", side) };
}

/** ( )² of one side: resolves √ exactly (the pill lives on the move) */
function squareOfNode(side: TNode): TNode {
  if (side.kind === "fn" && side.fn === "sqrt") return side.arg;
  if (side.kind === "mul") {
    // (c·√u)² = c²·u
    const factors = side.factors.map((f) => (f.kind === "fn" && f.fn === "sqrt" ? f.arg : tpow(f, 2)));
    return tmul(...factors);
  }
  return tpow(side, 2);
}

/** 1/( ) of one side — the pow-cancel here is exactly the conditional rewrite */
function recipOfNode(side: TNode): SideResult {
  if (side.kind === "const") {
    if (side.num === 0) return "can't take the reciprocal of 0";
    return { node: tc(side.den, side.num) };
  }
  if (side.kind === "pow" && side.exp.kind === "const") {
    return { node: tpow(side.base, tc(-side.exp.num, side.exp.den)) };
  }
  if (side.kind === "mul") {
    const inverted = side.factors.map((f) =>
      f.kind === "pow" && f.exp.kind === "const" ? tpow(f.base, tc(-f.exp.num, f.exp.den)) : tpow(f, -1)
    );
    return { node: tmul(...inverted) };
  }
  return { node: tpow(side, -1) };
}

export type TreeToolKind = "ln" | "exp" | "sin" | "cos" | "tan" | "sqrt" | "square" | "recip";

export function applyToolT(tool: TreeToolKind, te: TreeEq): TreeMoveResult {
  if (tool === "ln" || tool === "exp") {
    const of = tool === "ln" ? lnOfNode : expOfNode;
    const l = of(te.left);
    if (typeof l === "string") return l;
    const r = of(te.right);
    if (typeof r === "string") return r;
    const withPill = [l, r].find((s) => s.pill);
    return finalize(
      l.node,
      r.node,
      tool === "ln" ? "took the natural log of both sides" : "exponentiated both sides (e to each side)",
      withPill ? { dangerous: true, note: withPill.note, pill: withPill.pill } : undefined
    );
  }
  if (tool === "square") {
    return finalize(squareOfNode(te.left), squareOfNode(te.right), "squared both sides", {
      dangerous: true,
      note: "squaring can introduce extraneous solutions — check any answer in the original equation",
      pill: "check roots",
    });
  }
  if (tool === "sqrt") {
    return finalize(tfn("sqrt", te.left), tfn("sqrt", te.right), "took the square root of both sides", {
      dangerous: true,
      note: "principal (+) root only — a negative branch is dropped",
      pill: "branch +",
    });
  }
  if (tool === "recip") {
    const l = recipOfNode(te.left);
    if (typeof l === "string") return l;
    const r = recipOfNode(te.right);
    if (typeof r === "string") return r;
    const involves = varsIn(te.left).size > 0 || varsIn(te.right).size > 0;
    return finalize(l.node, r.node, "took the reciprocal of both sides", {
      dangerous: involves,
      note: involves ? "assumes both sides ≠ 0 — nothing can flip zero" : undefined,
      pill: involves ? "sides ≠ 0" : undefined,
    });
  }
  // sin / cos / tan wrap both sides
  return finalize(tfn(tool, te.left), tfn(tool, te.right), `took ${tool} of both sides`, {
    dangerous: true,
    note: `${tool} isn't one-to-one — new false solutions can appear; check answers`,
    pill: "check solutions",
  });
}
