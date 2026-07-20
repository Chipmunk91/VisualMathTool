/**
 * Contextual actions attached to mathematical operators, not drag hitboxes.
 *
 * A special glyph (the e in e^u, an exponent, sin, ln, a radical) is a tap
 * anchor for exactly one inverse operation. Dragging from the same pixels is
 * still owned by the surrounding addend/factor; the pointer layer decides tap
 * versus drag after movement slop.
 *
 * The organizing principle: EVERY special glyph offers the inverse that frees
 * IT. Tapping the base of 2^x takes ln (freeing the exponent); tapping the
 * exponent takes the x-th root (freeing the base); tapping sin unwraps to
 * arcsin. Where the operator isn't alone on its side, the action performs the
 * legal isolation first — moving co-addends across and dividing co-factors
 * out, with their pills — so a tap means "solve toward this glyph", not
 * "refuse until the user rearranges by hand".
 */
import type { Side } from "./model";
import {
  addendsOf,
  constValue,
  freshNodeId,
  keyOf,
  printNode,
  simplify,
  tadd,
  tc,
  tfn,
  tmul,
  tpow,
  type TFnName,
  type TNode,
  type TreeEq,
} from "./tree";
import {
  applyToolT,
  finalize,
  raiseBothT,
  rootBothT,
  type TreeMoveResult,
} from "./treemoves";

export type SpecialActionKind =
  | "ln"
  | "exp"
  | "root"
  | "raise"
  | "rootexpr"
  | "square"
  | "asin"
  | "acos"
  | "atan";

export interface SpecialActionRef {
  kind: SpecialActionKind;
  /** Integer root/power index, present for root and raise. */
  n?: number;
  /** Stable semantic owner that supplied the visible operator. */
  nodeId: string;
  /** The exact tree node the action unwinds (pow/fn), when one is needed. */
  targetId?: string;
  /** Display text of a symbolic exponent, for the bubble label. */
  exprText?: string;
  side: Side;
}

const ordinal = (n: number): string => {
  if (n === 2) return "square";
  if (n === 3) return "cube";
  const mod100 = n % 100;
  const suffix =
    n % 10 === 1 && mod100 !== 11
      ? "st"
      : n % 10 === 2 && mod100 !== 12
        ? "nd"
        : n % 10 === 3 && mod100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
};

export function specialActionLabel(action: SpecialActionRef): string {
  switch (action.kind) {
    case "ln":
      return "Take ln of both sides";
    case "exp":
      return "Exponentiate both sides";
    case "root":
      return `Take the ${ordinal(action.n ?? 2)} root of both sides`;
    case "raise":
      return `Raise both sides to the power ${action.n ?? 2}`;
    case "rootexpr": {
      const u = action.exprText ?? "u";
      return /^[a-zA-Z]\w*$/.test(u)
        ? `Take the ${u}-th root of both sides`
        : `Raise both sides to the power 1/(${u})`;
    }
    case "square":
      return "Square both sides";
    case "asin":
      return "Apply arcsin to both sides";
    case "acos":
      return "Apply arccos to both sides";
    case "atan":
      return "Apply arctan to both sides";
  }
}

type InverseTrigAction = "asin" | "acos" | "atan";

const INVERSE_TRIG: Record<
  InverseTrigAction,
  { direct: "sin" | "cos" | "tan"; inverse: TFnName; name: string }
> = {
  asin: { direct: "sin", inverse: "asin", name: "arcsin" },
  acos: { direct: "cos", inverse: "acos", name: "arccos" },
  atan: { direct: "tan", inverse: "atan", name: "arctan" },
};

/* --- isolate a tapped operator within its side ---------------------------- */

const containsId = (node: TNode, id: string): boolean => {
  if (node.id === id) return true;
  switch (node.kind) {
    case "add":
      return node.terms.some((term) => containsId(term, id));
    case "mul":
      return node.factors.some((factor) => containsId(factor, id));
    case "pow":
      return containsId(node.base, id) || containsId(node.exp, id);
    case "fn":
      return containsId(node.arg, id);
    case "derivative":
      return containsId(node.expression, id);
    case "integral":
      return containsId(node.integrand, id) ||
        (!!node.bounds && (containsId(node.bounds.lower, id) || containsId(node.bounds.upper, id)));
    default:
      return false;
  }
};

const findById = (node: TNode, id: string): TNode | null => {
  if (node.id === id) return node;
  switch (node.kind) {
    case "add":
      for (const term of node.terms) {
        const found = findById(term, id);
        if (found) return found;
      }
      return null;
    case "mul":
      for (const factor of node.factors) {
        const found = findById(factor, id);
        if (found) return found;
      }
      return null;
    case "pow":
      return findById(node.base, id) ?? findById(node.exp, id);
    case "fn":
      return findById(node.arg, id);
    case "derivative":
      return findById(node.expression, id);
    case "integral":
      return findById(node.integrand, id) ??
        (node.bounds ? findById(node.bounds.lower, id) ?? findById(node.bounds.upper, id) : null);
    default:
      return null;
  }
};

interface IsolationPlan {
  /** Sibling addends of the target's addend — they cross the equals sign. */
  coAddends: TNode[];
  /** Sibling factors within the target's addend — both sides divide by them. */
  coFactors: TNode[];
}

/**
 * How to make the target node stand alone on its side, using only the two
 * moves every student knows: subtract the other addends, divide the other
 * factors. Null when the target is buried deeper (inside a power, another
 * function, a denominator) — those need their own unwinding first.
 */
const isolationPlan = (side: TNode, targetId: string): IsolationPlan | null => {
  const addends = addendsOf(side);
  const index = addends.findIndex((addend) => containsId(addend, targetId));
  if (index < 0) return null;
  const owner = addends[index];
  const coAddends = addends.filter((_, i) => i !== index);
  if (owner.id === targetId) return { coAddends, coFactors: [] };
  if (owner.kind !== "mul") return null;
  const factorIndex = owner.factors.findIndex((factor) => factor.id === targetId);
  if (factorIndex < 0) return null; // nested inside a factor, not an immediate one
  return { coAddends, coFactors: owner.factors.filter((_, i) => i !== factorIndex) };
};

/** "expr ≠ 0" as simplifier licenses — every factor of a nonzero product. */
const nonzeroKeys = (expr: TNode): Set<string> => {
  const s = simplify(expr);
  const keys = new Set([keyOf(s)]);
  const factors = s.kind === "mul" ? s.factors : [s];
  for (const f of factors) keys.add(keyOf(f.kind === "pow" ? f.base : f));
  return keys;
};

/** The other side after the isolation moves: (other − coAddends) / coFactors */
const counterparted = (other: TNode, plan: IsolationPlan): TNode => {
  const moved = plan.coAddends.map((addend) =>
    tmul(tc(-1), { ...addend, id: freshNodeId() })
  );
  const shifted = moved.length > 0 ? tadd(...addendsOf(other), ...moved) : other;
  if (plan.coFactors.length === 0) return shifted;
  const divisor = plan.coFactors.length === 1 ? plan.coFactors[0] : tmul(...plan.coFactors);
  return tmul(shifted, tpow({ ...divisor, id: freshNodeId() }, -1));
};

const isolationPills = (plan: IsolationPlan): { note?: string; pill?: string } => {
  if (plan.coFactors.length === 0) return {};
  const text = plan.coFactors.map((factor) => printNode(factor)).join("·");
  return {
    note: `divided both sides by ${text}`,
    pill: `${text} ≠ 0`,
  };
};

/** Tapping a symbolic EXPONENT frees the base: a^u = R → a = R^(1/u). */
const rootexprAction = (te: TreeEq, action: SpecialActionRef): TreeMoveResult => {
  const source = te[action.side];
  const other = te[action.side === "left" ? "right" : "left"];
  const target = action.targetId ? findById(source, action.targetId) : null;
  if (!target || (target.kind !== "pow" && !(target.kind === "fn" && target.fn === "exp"))) {
    return "tap the power whose exponent should unwind";
  }
  const u = target.kind === "pow" ? target.exp : target.arg;
  if (constValue(simplify(u)) === 0) return "an exponent of zero has no root to take";
  const plan = isolationPlan(source, target.id);
  if (!plan) return "that power is buried inside another operator — unwind the outer one first";
  const base = target.kind === "pow" ? target.base : tfn("exp", tc(1));
  const counter = counterparted(other, plan);
  const unwound = tpow({ ...counter, id: freshNodeId() }, tpow({ ...u, id: freshNodeId() }, -1));
  const iso = isolationPills(plan);
  const uText = printNode(u);
  const assume = nonzeroKeys(u);
  if (plan.coFactors.length > 0) {
    for (const key of Array.from(nonzeroKeys(tmul(...plan.coFactors)))) assume.add(key);
  }
  const result = finalize(
    action.side === "left" ? base : unwound,
    action.side === "left" ? unwound : base,
    `took the ${uText}-th root of both sides`,
    {
      dangerous: true,
      note: [
        iso.note,
        `principal branch of the 1/(${uText}) power — other roots are dropped`,
      ]
        .filter(Boolean)
        .join("; "),
      pill: [iso.pill, `${uText} ≠ 0`].filter(Boolean).join(" · "),
      assume,
    }
  );
  return withIsolationIntermediate(result, action.side, target, counter, plan);
};

/** Tapping sin/cos/tan solves toward the shell, isolating it first if needed. */
const inverseTrigAction = (kind: InverseTrigAction) => (te: TreeEq, action: SpecialActionRef): TreeMoveResult => {
  const spec = INVERSE_TRIG[kind];
  const source = te[action.side];
  const other = te[action.side === "left" ? "right" : "left"];
  // Locate the tapped shell precisely when the anchor names it; fall back
  // to the whole side for pre-target callers (older shared links).
  const target = action.targetId
    ? findById(source, action.targetId)
    : source.kind === "fn" && source.fn === spec.direct
      ? source
      : null;
  if (!target || target.kind !== "fn" || target.fn !== spec.direct) {
    return `isolate ${spec.direct}(…) on its side before applying ${spec.name}`;
  }
  const plan = isolationPlan(source, target.id);
  if (!plan) {
    return `${spec.direct}(…) is buried inside another operator — unwind the outer one first`;
  }
  const counter = simplify(counterparted(other, plan), plan.coFactors.length > 0 ? nonzeroKeys(tmul(...plan.coFactors)) : undefined);
  const value = constValue(counter);
  if (kind !== "atan" && value !== null && Math.abs(value) > 1) {
    return `${spec.name} is only real between −1 and 1 — ${spec.direct}(…) would have to equal ${printNode(counter)}`;
  }
  const unwrapped = tfn(spec.inverse, { ...counter, id: freshNodeId() });
  const iso = isolationPills(plan);
  const left = action.side === "left" ? target.arg : unwrapped;
  const right = action.side === "left" ? unwrapped : target.arg;
  const result = finalize(left, right, `applied ${spec.name} to both sides`, {
    dangerous: true,
    note: [
      iso.note,
      `${spec.name} keeps its principal branch — check solutions in the original equation`,
    ]
      .filter(Boolean)
      .join("; "),
    pill: [iso.pill, "check branches"].filter(Boolean).join(" · "),
  });
  return withIsolationIntermediate(result, action.side, target, counter, plan);
};

/**
 * One executor per action kind — the SAME function objects the operations
 * registry rows reference, so "the engine executes rows" holds whichever
 * door a caller comes through.
 */
export const SPECIAL_EXECUTORS: Record<
  SpecialActionKind,
  (te: TreeEq, action: SpecialActionRef) => TreeMoveResult
> = {
  ln: (te) => applyToolT("ln", te),
  exp: (te) => applyToolT("exp", te),
  root: (te, action) => rootBothT(te, action.n ?? 2),
  raise: (te, action) => raiseBothT(te, action.n ?? 2),
  square: (te) => applyToolT("square", te),
  rootexpr: rootexprAction,
  asin: inverseTrigAction("asin"),
  acos: inverseTrigAction("acos"),
  atan: inverseTrigAction("atan"),
};

/** Execute the single operation advertised by a special-symbol bubble. */
export function applySpecialActionT(te: TreeEq, action: SpecialActionRef): TreeMoveResult {
  return SPECIAL_EXECUTORS[action.kind](te, action);
}

/**
 * When the tap performed isolation moves first, the replay's intermediate
 * paper state is the ISOLATED equation (sin(u) = R′), not the raw unsimplified
 * result — so the film reads "move the rest away, then unwrap".
 */
const withIsolationIntermediate = (
  result: TreeMoveResult,
  side: Side,
  target: TNode,
  counter: TNode,
  plan: IsolationPlan
): TreeMoveResult => {
  if (typeof result === "string" || result === null) return result;
  if (plan.coAddends.length === 0 && plan.coFactors.length === 0) return result;
  const isolatedSource = { ...target, id: freshNodeId() };
  const isolatedCounter = { ...simplify(counter), id: freshNodeId() };
  return {
    ...result,
    treeIntermediate: {
      left: side === "left" ? isolatedSource : isolatedCounter,
      right: side === "left" ? isolatedCounter : isolatedSource,
    },
  };
};
