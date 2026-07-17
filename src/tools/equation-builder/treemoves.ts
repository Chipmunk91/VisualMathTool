/**
 * Moves on tree equations. Each move is a pure rewrite typed to return its
 * assumptions: { …, pill } — the type is the guardrail. A conditional
 * identity (cancel x/x, undo a √ by squaring, e^(ln u) → u) can ONLY happen
 * here, never in the simplifier, and never without declaring itself.
 *
 * Every move returns the canonical tree model. Legacy flat equations are
 * converted at the input/share boundary and never re-enter runtime dispatch.
 */
import type { Side } from "./model";
import type { MoveStory } from "./share";
import { treeAddendById } from "./treeunits";
import {
  TNode,
  TreeEq,
  addendsOf,
  constValue,
  ensureTreeEqIds,
  freshNodeId,
  keyOf,
  printNode,
  sideFromAddends,
  simplify,
  tadd,
  tc,
  tfn,
  tmul,
  tpow,
  varsIn,
} from "./tree";

export interface TreeOutcome {
  treeNext: TreeEq;
  /**
   * The literal paper state immediately after applying the operation, before
   * canonical simplification. Replay renders this first so students can see
   * what moved and only then see what cancelled or combined.
   */
  treeIntermediate?: TreeEq;
  label: string;
  dangerous?: boolean;
  note?: string;
  pill?: string;
  /** replay choreography — set by the drop dispatcher, not the pure move */
  story?: MoveStory;
}

export type TreeMoveResult = TreeOutcome | string | null;

/** Simplify both sides and return one uniquely identified canonical tree. */
export function finalize(
  left: TNode,
  right: TNode,
  label: string,
  extra?: { dangerous?: boolean; note?: string; pill?: string; assume?: Set<string> }
): TreeOutcome {
  const intermediate = ensureTreeEqIds({ left, right });
  const assume = extra?.assume;
  let outcomeExtra: Omit<NonNullable<typeof extra>, "assume"> = {
    dangerous: extra?.dangerous,
    note: extra?.note,
    pill: extra?.pill,
  };
  // every move-produced state thaws e^(ln u) — with the assumption reported
  const tl = thawExpLn(simplify(intermediate.left, assume));
  const tr = thawExpLn(simplify(intermediate.right, assume));
  const thawed = Array.from(new Set([...tl.thawed, ...tr.thawed]));
  if (thawed.length > 0) {
    const thawNote = `e^(ln u) = u used — ${thawed.join(", ")} > 0 assumed`;
    outcomeExtra = {
      dangerous: true,
      note: outcomeExtra.note ? `${outcomeExtra.note}; ${thawNote}` : thawNote,
      pill: outcomeExtra.pill ?? `${thawed.join(", ")} > 0`,
    };
  }
  const l = simplify(tl.node, assume);
  const r = simplify(tr.node, assume);
  return {
    treeNext: ensureTreeEqIds({ left: l, right: r }),
    treeIntermediate: intermediate,
    label,
    ...outcomeExtra,
  };
}

const addendAt = (te: TreeEq, id: string): { node: TNode; side: Side; index: number } | null =>
  treeAddendById(te, id);

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
  // Keep the moved addend's semantic id at the new location. Its inner copy
  // receives a fresh root id so the intermediate remains a valid tree with no
  // duplicate occurrences. This is the actor link used by replay.
  const moved = picks.map((p) => ({
    id: p.node.id,
    kind: "mul" as const,
    factors: [tc(-1), { ...p.node, id: freshNodeId() }],
  }));
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
    sideFromAddends(addendsOf(side).map((a) => tmul(a, tpow(expr, -1))));
  const dividedZero = (side: TNode): TNode => (addendsOf(side).length === 0 ? tc(0) : divide(side));
  return finalize(dividedZero(te.left), dividedZero(te.right), `divided both sides by ${exprText}`, {
    dangerous: hasVars,
    note: hasVars ? `only valid where ${exprText} ≠ 0 — a solution could hide there` : undefined,
    pill: hasVars ? `${exprText} ≠ 0` : undefined,
    assume,
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
      : sideFromAddends(addendsOf(side).map((a) => tmul(a, expr)));
  return finalize(times(te.left), times(te.right), `multiplied both sides by ${exprText}`, { assume });
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

/**
 * e^(ln u + rest) → u·e^rest — the conditional identity (u > 0). It lives in
 * the MOVE layer (never the simplifier) and reports every argument it thawed
 * so the step can carry the assumption.
 */
export function thawExpLn(n: TNode): { node: TNode; thawed: string[] } {
  const thawed: string[] = [];
  const walk = (m: TNode): TNode => {
    switch (m.kind) {
      case "const":
      case "named":
      case "var":
        return m;
      case "add":
        return { id: m.id, kind: "add", terms: m.terms.map(walk) };
      case "mul":
        return { id: m.id, kind: "mul", factors: m.factors.map(walk) };
      case "pow":
        return { id: m.id, kind: "pow", base: walk(m.base), exp: walk(m.exp) };
      case "fn": {
        const arg = walk(m.arg);
        if (m.fn === "exp") {
          const addends = arg.kind === "add" ? arg.terms : [arg];
          const lnArgs: TNode[] = [];
          const rest: TNode[] = [];
          for (const t of addends) {
            if (t.kind === "fn" && t.fn === "ln") lnArgs.push(t.arg);
            else rest.push(t);
          }
          if (lnArgs.length > 0) {
            lnArgs.forEach((u) => thawed.push(printNode(u)));
            const factors: TNode[] = [...lnArgs];
            if (rest.length > 0) {
              factors.push(tfn("exp", rest.length === 1 ? rest[0] : tadd(...rest)));
            }
            return factors.length === 1 ? factors[0] : tmul(...factors);
          }
        }
        return { id: m.id, kind: "fn", fn: m.fn, arg };
      }
    }
  };
  return { node: walk(n), thawed };
}

/**
 * sympy-style input normalization — what cancel() would do, but with the
 * assumptions RECORDED instead of assumed generically: identical var-bearing
 * factor pairs across a fraction bar cancel at load, and e^(ln u) thaws,
 * each stamping the step-0 pill.
 */
export function normalizeOnLoad(te: TreeEq): { te: TreeEq; pill?: string; note?: string; changed: boolean } {
  const pills: string[] = [];
  const cancelSide = (side: TNode): TNode =>
    sideFromAddends(
      addendsOf(side).map((a) => {
        const factors = a.kind === "mul" ? a.factors : [a];
        const pos = new Map<string, TNode>();
        const neg = new Map<string, TNode>();
        for (const f of factors) {
          const isNeg = f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0;
          const base = f.kind === "pow" ? f.base : f;
          if (varsIn(base).size === 0) continue;
          (isNeg ? neg : pos).set(keyOf(base), base);
        }
        const shared = Array.from(pos.keys()).filter((k) => neg.has(k));
        if (shared.length === 0) return a;
        const out = simplify(a, new Set(shared));
        if (keyOf(out) === keyOf(simplify(a))) return a;
        shared.forEach((k) => pills.push(`${printNode(pos.get(k)!)} ≠ 0`));
        return out;
      })
    );
  const tl = thawExpLn(simplify(cancelSide(te.left)));
  const tr = thawExpLn(simplify(cancelSide(te.right)));
  const thawed = Array.from(new Set([...tl.thawed, ...tr.thawed]));
  if (thawed.length > 0) pills.push(`${thawed.join(", ")} > 0`);
  const unique = Array.from(new Set(pills));
  return {
    te: ensureTreeEqIds({ left: simplify(tl.node), right: simplify(tr.node) }),
    pill: unique.length ? unique.join(", ") : undefined,
    note: unique.length ? "simplified on load — the assumptions it needs are recorded on this step" : undefined,
    changed: unique.length > 0,
  };
}

/**
 * Cancel a factor against its own reciprocal inside ONE addend — the gesture
 * of dropping a numerator unit onto the matching denominator (or the
 * reverse). This is exactly the conditional identity the simplifier refuses
 * silently: (x+2)/(x+2) is 1 only where x+2 ≠ 0, so the MOVE declares it.
 */
export function cancelFactorT(te: TreeEq, addendId: string, expr: TNode, exprText: string): TreeMoveResult {
  const at = addendAt(te, addendId);
  if (!at) return null;
  const cancelled = simplify(at.node, nonzeroKeys(expr));
  if (keyOf(cancelled) === keyOf(simplify(at.node))) return "nothing cancels here — the pair must match exactly";
  const list = addendsOf(te[at.side]).map((a, i) => (i === at.index ? cancelled : a));
  const next: TreeEq = { ...te, [at.side]: sideFromAddends(list) };
  const hasVars = varsIn(expr).size > 0;
  return finalize(next.left, next.right, `cancelled ${exprText} against ${exprText}`, {
    dangerous: hasVars,
    note: hasVars ? `only valid where ${exprText} ≠ 0 — a solution could hide there` : undefined,
    pill: hasVars ? `${exprText} ≠ 0` : undefined,
  });
}

/**
 * Raise both sides to the n-th power — the fractional exponent handle's move
 * (dragging the 1/n across the equals sign), the root's inverse. Odd powers
 * are unconditional; even powers can introduce extraneous solutions.
 */
export function raiseBothT(te: TreeEq, n: number): TreeMoveResult {
  if (!Number.isInteger(n) || n < 2) return null;
  const raise = (side: TNode): TNode => {
    const s = simplify(side);
    // (b^(1/n))ⁿ folds to b outright — for even n this is the move's
    // business (it carries the check-roots pill), not the simplifier's
    if (s.kind === "pow" && s.exp.kind === "const" && s.exp.num === 1 && s.exp.den === n) {
      return simplify(s.base);
    }
    return simplify(tpow(s, tc(n)));
  };
  const even = n % 2 === 0;
  return finalize(raise(te.left), raise(te.right), `raised both sides to the power ${n}`, {
    dangerous: even,
    note: even ? "an even power can introduce extraneous solutions — check any answer in the original equation" : undefined,
    pill: even ? "check roots" : undefined,
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
    if (f.kind === "named" && f.name === "pi") {
      parts.push(tfn("ln", f));
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
