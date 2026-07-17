/**
 * The rewrite-suggestion engine behind opt-in algebra assistance.
 *
 * The simplifier deliberately leaves things factored (2(x+3) stays, products
 * don't FOIL, log/trig identities don't auto-apply) because those directions
 * are the STUDENT's choice, not a canonical form. This engine is the other
 * half: given a state, it DETECTS the rewrites available at each subtree —
 * expand ⇄ factor, and the conditional identity rewrites — and returns them as
 * candidates. Product UI can expose a focused subset (currently
 * factorization detection); the user takes a rewrite or leaves it alone.
 *
 * Every candidate is value-preserving on its stated domain: the conditional
 * ones (log laws) carry a pill, exactly like the moves. `verifyRewrite` below
 * checks a candidate numerically — the engine's own honesty guard.
 */
import { Variable } from "./model";
import {
  TNode,
  TreeEq,
  addendsOf,
  cloneTree,
  constValue,
  ensureTreeIds,
  evalNode,
  keyOf,
  printNode,
  signSplit,
  simplify,
  splitCoef,
  tadd,
  tc,
  tfn,
  tmul,
  tpow,
  tv,
  varsIn,
} from "./tree";

export type RewriteKind = "expand" | "factor" | "identity";

export interface Rewrite {
  kind: RewriteKind;
  /** a short human label, e.g. "distribute", "factor out 2", "ln(x·y) = ln x + ln y" */
  label: string;
  /** the subtree this rewrite matched (located by structural key) */
  before: TNode;
  /** its rewritten form */
  after: TNode;
  /** a domain assumption the rewrite needs (log laws), else undefined */
  pill?: string;
}

const gcd2 = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd2(b, a % b));

/* ── expansion: distribute / FOIL ─────────────────────────────────────────
   A product with a sum among its factors multiplies out. Powers of a sum,
   (x+1)^2, become repeated products first. Value-preserving, unconditional. */

function asRepeatedProduct(n: TNode): TNode[] | null {
  // (sum)^k, small positive integer k → [sum, sum, …]
  if (n.kind === "pow" && n.exp.kind === "const" && n.exp.den === 1) {
    const k = n.exp.num;
    if (k >= 2 && k <= 6 && n.base.kind === "add") return Array(k).fill(n.base);
  }
  return null;
}

function expandProduct(n: TNode): TNode | null {
  // gather the flat list of factors, unrolling a (sum)^k into repeats
  let factors: TNode[] = [];
  if (n.kind === "mul") {
    for (const f of n.factors) {
      const rep = asRepeatedProduct(f);
      if (rep) factors.push(...rep);
      else factors.push(f);
    }
  } else {
    const rep = asRepeatedProduct(n);
    if (!rep) return null;
    factors = rep;
  }
  if (!factors.some((f) => f.kind === "add")) return null; // nothing to distribute
  // multiply the running set of addends by each factor
  let acc: TNode[] = [tc(1)];
  for (const f of factors) {
    const terms = f.kind === "add" ? f.terms : [f];
    const next: TNode[] = [];
    for (const a of acc) for (const t of terms) next.push(tmul(a, t));
    acc = next;
  }
  const expanded = simplify(tadd(...acc));
  // offer only if it actually changed shape (a real expansion)
  return keyOf(expanded) === keyOf(simplify(n)) ? null : expanded;
}

/* ── factoring: pull out a common factor ───────────────────────────────────
   A sum whose terms share a numeric GCD (>1) and/or a common variable power
   factors as g·(reduced sum). Value-preserving, unconditional. */

function termParts(t: TNode): { num: number; den: number; core: TNode[] } {
  return splitCoef(t);
}

function factorCommon(n: TNode): TNode | null {
  if (n.kind !== "add" || n.terms.length < 2) return null;
  const parts = n.terms.map(termParts);
  // numeric GCD of the (integer) numerators, and common denominator handling:
  // keep it simple — only factor an integer GCD when all dens are 1
  if (!parts.every((p) => p.den === 1 && Number.isInteger(p.num))) return null;
  let g = 0;
  for (const p of parts) g = gcd2(g, p.num);
  g = Math.abs(g);
  // common variable powers: for each variable, the minimum power across terms
  const varPow: Record<string, number> = {};
  for (const v of ["x", "y"] as Variable[]) {
    let min = Infinity;
    for (const p of parts) {
      let pw = 0;
      for (const c of p.core) {
        if (c.kind === "var" && c.name === v) pw += 1;
        else if (c.kind === "pow" && c.base.kind === "var" && c.base.name === v && c.exp.kind === "const" && c.exp.den === 1)
          pw += c.exp.num;
      }
      min = Math.min(min, pw);
    }
    if (min !== Infinity && min > 0) varPow[v] = min;
  }
  const hasVarCommon = Object.keys(varPow).length > 0;
  if (g <= 1 && !hasVarCommon) return null;
  if (g === 0) return null;
  // build the common factor and divide each term by it
  const commonFactors: TNode[] = [];
  if (g !== 1) commonFactors.push(tc(g));
  for (const [v, p] of Object.entries(varPow)) commonFactors.push(p === 1 ? tv(v as Variable) : tpow(tv(v as Variable), tc(p)));
  const common = commonFactors.length === 1 ? commonFactors[0] : tmul(...commonFactors);
  const reduced = n.terms.map((t) => simplify(tmul(t, tpow(common, -1))));
  const factored = simplify(tmul(common, tadd(...reduced)));
  return keyOf(factored) === keyOf(simplify(n)) ? null : factored;
}

/* ── factoring: a quadratic with rational roots ────────────────────────────
   a x² + b x + c (single variable) → a(x − r₁)(x − r₂) when the roots are
   rational. Value-preserving, unconditional. */

function quadCoeffs(n: TNode, v: Variable): [number, number, number] | null {
  if (n.kind !== "add") return null;
  let a = 0, b = 0, c = 0;
  for (const t of addendsOf(n)) {
    const { num, den, core } = splitCoef(t);
    if (den !== 1) return null;
    if (core.length === 0) { c += num; continue; }
    if (core.length !== 1) return null;
    const f = core[0];
    if (f.kind === "var" && f.name === v) b += num;
    else if (f.kind === "pow" && f.base.kind === "var" && f.base.name === v && f.exp.kind === "const" && f.exp.den === 1 && f.exp.num === 2)
      a += num;
    else return null; // some other variable / power — not a pure quadratic in v
  }
  return a !== 0 ? [a, b, c] : null;
}

function factorQuadratic(n: TNode): TNode | null {
  const vars = Array.from(varsIn(n));
  if (vars.length !== 1) return null;
  const v = vars[0];
  const q = quadCoeffs(n, v);
  if (!q) return null;
  const [a, b, c] = q;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.round(Math.sqrt(disc));
  if (sq * sq !== disc) return null; // irrational roots — leave it
  // roots (−b ± √disc) / 2a ; keep only rational (they are, disc a perfect square)
  const r1n = -b + sq, r2n = -b - sq, dd = 2 * a;
  // a(x − r₁)(x − r₂) with r = rn/dd → a·(x − r1n/dd)·(x − r2n/dd)
  const factorFor = (rn: number): TNode => simplify(tadd(tv(v), tc(-rn, dd)));
  const factored = simplify(tmul(tc(a), factorFor(r1n), factorFor(r2n)));
  return keyOf(factored) === keyOf(simplify(n)) ? null : factored;
}

/* ── identity rewrites (conditional — carry a pill) ────────────────────────── */

// ln(a·b) = ln a + ln b holds ONLY where each factor is positive. A const
// factor must be > 0 for the split to stay in the reals; a variable factor
// is pilled "> 0". A non-positive const kills the whole rewrite (ln(−2)+ln(−1)
// ≠ ln 2), so we don't offer it.
function logProduct(n: TNode): Rewrite | null {
  if (n.kind !== "fn" || n.fn !== "ln" || n.arg.kind !== "mul") return null;
  const terms: TNode[] = [];
  const pillParts: string[] = [];
  for (const f of n.arg.factors) {
    const base = f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0
      ? simplify(tpow(f.base, tc(-(f.exp.num), f.exp.den)))
      : f;
    const cv = constValue(base);
    if (cv !== null) {
      if (cv <= 0) return null; // ln of a non-positive constant isn't a real split
    } else {
      pillParts.push(printNode(base)); // variable factor: needs its own > 0
    }
    const lnBase = tfn("ln", base);
    terms.push(f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0 ? tmul(tc(-1), lnBase) : lnBase);
  }
  if (terms.length < 2) return null;
  return {
    kind: "identity",
    label: "ln(a·b) = ln a + ln b",
    before: n,
    after: simplify(tadd(...terms)),
    pill: pillParts.length ? `${pillParts.join(", ")} > 0` : undefined,
  };
}

// ln(uⁿ) = n·ln u needs u > 0 (for even n this drops the negative-base branch,
// which needs |u| the grammar doesn't have — so u > 0 is the honest offer). A
// non-positive CONSTANT base can never satisfy that, so skip it.
function logPower(n: TNode): Rewrite | null {
  if (n.kind !== "fn" || n.fn !== "ln" || n.arg.kind !== "pow") return null;
  const { base, exp } = n.arg;
  if (exp.kind !== "const") return null;
  const cv = constValue(base);
  if (cv !== null && cv <= 0) return null;
  return {
    kind: "identity",
    label: "ln(uⁿ) = n·ln u",
    before: n,
    after: simplify(tmul(exp, tfn("ln", base))),
    pill: cv === null ? `${printNode(base)} > 0` : undefined,
  };
}

function trigNegate(n: TNode): Rewrite | null {
  if (n.kind !== "fn" || (n.fn !== "sin" && n.fn !== "cos" && n.fn !== "tan")) return null;
  const { neg, body } = signSplit(n.arg);
  if (!neg) return null;
  // sin(−u) = −sin u ; tan(−u) = −tan u ; cos(−u) = cos u
  const inner = tfn(n.fn, body);
  const after = n.fn === "cos" ? inner : simplify(tmul(tc(-1), inner));
  return {
    kind: "identity",
    label: n.fn === "cos" ? "cos(−u) = cos u" : `${n.fn}(−u) = −${n.fn} u`,
    before: n,
    after: simplify(after),
    pill: undefined,
  };
}

/* ── the walk: collect every candidate over the whole tree ─────────────────── */

const STRUCTURAL: ((n: TNode) => TNode | null)[] = [expandProduct, factorCommon, factorQuadratic];
const STRUCTURAL_KIND: RewriteKind[] = ["expand", "factor", "factor"];
const STRUCTURAL_LABEL: string[] = ["distribute", "factor out the common term", "factor the quadratic"];
const IDENTITY: ((n: TNode) => Rewrite | null)[] = [logProduct, logPower, trigNegate];

function walk(n: TNode, visit: (m: TNode) => void): void {
  visit(n);
  switch (n.kind) {
    case "add":
      n.terms.forEach((t) => walk(t, visit));
      break;
    case "mul":
      n.factors.forEach((f) => walk(f, visit));
      break;
    case "pow":
      walk(n.base, visit);
      walk(n.exp, visit);
      break;
    case "fn":
      walk(n.arg, visit);
      break;
  }
}

/** Every rewrite available anywhere in the expression, de-duplicated. */
export function detectRewrites(root: TNode): Rewrite[] {
  const out: Rewrite[] = [];
  const seen = new Set<string>();
  const add = (r: Rewrite) => {
    const k = `${r.kind}|${r.before.id}|${keyOf(r.after)}`;
    if (seen.has(k) || keyOf(r.before) === keyOf(r.after)) return;
    seen.add(k);
    out.push(r);
  };
  walk(root, (n) => {
    STRUCTURAL.forEach((fn, i) => {
      const after = fn(n);
      if (after) add({ kind: STRUCTURAL_KIND[i], label: STRUCTURAL_LABEL[i], before: n, after });
    });
    IDENTITY.forEach((fn) => {
      const r = fn(n);
      if (r) add(r);
    });
  });
  return out;
}

/** Detect over a whole equation, tagging which side each rewrite lives on. */
export function detectRewritesEq(te: TreeEq): { side: "left" | "right"; rewrite: Rewrite }[] {
  return [
    ...detectRewrites(te.left).map((rewrite) => ({ side: "left" as const, rewrite })),
    ...detectRewrites(te.right).map((rewrite) => ({ side: "right" as const, rewrite })),
  ];
}

/** The focused product surface: detect factorable groups, not every rewrite. */
export function detectFactorizationsEq(te: TreeEq): { side: "left" | "right"; rewrite: Rewrite }[] {
  return detectRewritesEq(te).filter(({ rewrite }) => rewrite.kind === "factor");
}

/** Apply a candidate: replace the exact semantic occurrence that was offered. */
export function applyRewrite(root: TNode, r: Rewrite): TNode {
  const target = r.before.id;
  let done = false;
  const rec = (n: TNode): TNode => {
    if (!done && n.id === target) {
      done = true;
      return cloneTree(r.after);
    }
    switch (n.kind) {
      case "add":
        return { id: n.id, kind: "add", terms: n.terms.map(rec) };
      case "mul":
        return { id: n.id, kind: "mul", factors: n.factors.map(rec) };
      case "pow":
        return { id: n.id, kind: "pow", base: rec(n.base), exp: rec(n.exp) };
      case "fn":
        return { id: n.id, kind: "fn", fn: n.fn, arg: rec(n.arg) };
      default:
        return n;
    }
  };
  // A candidate can reuse ids from the matched subtree. Rehydrate the whole
  // result once so the replacement cannot alias a surviving occurrence.
  return ensureTreeIds(rec(root));
}

/**
 * The engine's honesty guard, three-valued:
 *   "ok"           — before ≡ after at ≥3 points where both are defined
 *   "violated"     — they DISAGREE at a point where both are defined (a bug)
 *   "unverifiable" — too few shared-defined points to judge (e.g. a pilled
 *                    rewrite sampled outside its domain, or a NaN-everywhere arg)
 * A rewrite is never "violated" if it's genuinely value-preserving; the fuzz
 * fails only on "violated", while the curated tests sample in-domain and get "ok".
 */
export function verifyRewrite(r: Rewrite): "ok" | "violated" | "unverifiable" {
  const pts: [number, number][] = [
    [1.3, 2.1], [0.7, 3.4], [2.9, 1.2], [4.1, 0.6], [1.9, 2.7], [3.3, 4.2],
    [0.4, 1.1], [2.2, 3.9],
  ];
  let shared = 0;
  for (const [x, y] of pts) {
    const a = evalNode(r.before, { x, y });
    const b = evalNode(r.after, { x, y });
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    shared++;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > 1e-6 * scale) return "violated";
  }
  return shared >= 3 ? "ok" : "unverifiable";
}

/** For debugging / tests: a compact printable summary of a candidate. */
export function describeRewrite(r: Rewrite): string {
  return `[${r.kind}] ${printNode(r.before)} → ${printNode(r.after)}${r.pill ? `  (${r.pill})` : ""}  «${r.label}»`;
}
