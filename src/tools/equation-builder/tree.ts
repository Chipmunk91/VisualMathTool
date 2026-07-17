/**
 * The expression tree — the canonical equation model. It handles ordinary
 * school algebra and the shapes the legacy flat adapter cannot hold:
 * 1/(x+1), 2^x, √(x+1), x·y.
 *
 * The one architectural rule, enforced by construction:
 *
 *   The simplifier may only apply identities that are unconditionally true
 *   everywhere. Anything conditional (x/x → 1, (√u)² → u, e^(ln u) → u) is
 *   NOT a simplification — it is a player move, and every move must return
 *   its assumptions as pills. There is no code path here for a conditional
 *   rewrite to fire silently.
 */
import {
  EqTerm,
  FuncName,
  gcd,
  group,
  func,
  leaf,
  scaleDen,
  scaleNum,
  varOf,
  type Variable,
} from "./model";

/** Tree-only functions may exceed the legacy flat model's vocabulary. */
export type TFnName = FuncName | "sqrt" | "asin" | "acos" | "atan";
export type TNamedConstant = "pi";
export type TNodeId = string;

export interface TNodeMeta {
  /** Stable semantic identity. Never derived from a render position. */
  id: TNodeId;
}

export type TNode = TNodeMeta & (
  | { kind: "const"; num: number; den: number }
  | { kind: "named"; name: TNamedConstant }
  | { kind: "var"; name: Variable }
  | { kind: "add"; terms: TNode[] }
  | { kind: "mul"; factors: TNode[] }
  | { kind: "pow"; base: TNode; exp: TNode }
  | { kind: "fn"; fn: TFnName; arg: TNode }
);

export interface TreeEq {
  left: TNode;
  right: TNode;
}

/* --- constructors ------------------------------------------------------- */

const NODE_SESSION = Math.random().toString(36).slice(2, 8);
let nodeCounter = 0;
export const freshNodeId = (): TNodeId => `n_${NODE_SESSION}_${(nodeCounter++).toString(36)}`;

export const tc = (num: number, den = 1): TNode => normRat({ kind: "const", num, den });
export const tnamed = (name: TNamedConstant): TNode => ({ id: freshNodeId(), kind: "named", name });
export const tv = (name: Variable): TNode => ({ id: freshNodeId(), kind: "var", name });
export const tadd = (...terms: TNode[]): TNode => ({ id: freshNodeId(), kind: "add", terms });
export const tmul = (...factors: TNode[]): TNode => ({ id: freshNodeId(), kind: "mul", factors });
export const tpow = (base: TNode, exp: TNode | number): TNode => ({
  id: freshNodeId(),
  kind: "pow",
  base,
  exp: typeof exp === "number" ? tc(exp) : exp,
});
export const tfn = (fn: TFnName, arg: TNode): TNode => ({ id: freshNodeId(), kind: "fn", fn, arg });

/**
 * Old shared histories have no tree ids, and expression constructors may reuse
 * a subtree on both sides. Rehydrate them as a real tree of unique occurrences:
 * the first occurrence keeps its id; every duplicate receives a fresh one.
 */
export function ensureTreeIds(n: TNode, seen = new Set<TNodeId>()): TNode {
  const rawId = (n as Partial<TNodeMeta>).id;
  const id = typeof rawId === "string" && rawId.length > 0 && !seen.has(rawId) ? rawId : freshNodeId();
  seen.add(id);
  switch (n.kind) {
    case "const":
      return { id, kind: "const", num: n.num, den: n.den };
    case "named":
      return { id, kind: "named", name: n.name };
    case "var":
      return { id, kind: "var", name: n.name };
    case "add":
      return { id, kind: "add", terms: n.terms.map((term) => ensureTreeIds(term, seen)) };
    case "mul":
      return { id, kind: "mul", factors: n.factors.map((factor) => ensureTreeIds(factor, seen)) };
    case "pow":
      return { id, kind: "pow", base: ensureTreeIds(n.base, seen), exp: ensureTreeIds(n.exp, seen) };
    case "fn":
      return { id, kind: "fn", fn: n.fn, arg: ensureTreeIds(n.arg, seen) };
  }
}

export function ensureTreeEqIds(te: TreeEq): TreeEq {
  const seen = new Set<TNodeId>();
  return { left: ensureTreeIds(te.left, seen), right: ensureTreeIds(te.right, seen) };
}

export const cloneTree = (n: TNode): TNode => ensureTreeIds(JSON.parse(JSON.stringify(n)) as TNode);
export const cloneTreeEq = (te: TreeEq): TreeEq =>
  ensureTreeEqIds(JSON.parse(JSON.stringify(te)) as TreeEq);

function normRat(n: { id?: TNodeId; kind: "const"; num: number; den: number }): TNode {
  let { num, den } = n;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den) || 1;
  return { id: n.id ?? freshNodeId(), kind: "const", num: num / g, den: den / g };
}

/** Is this node exactly the integer `num`? (plain boolean — no narrowing) */
const isNum = (n: TNode, num: number): boolean => n.kind === "const" && n.num === num && n.den === 1;

/**
 * Can this expression provably never be zero? True for nonzero constants,
 * e^(anything) — always positive — and anything a move has declared ≠ 0.
 */
const nonzeroNode = (n: TNode, assume?: Set<string>): boolean => {
  if (assume?.has(keyOf(n))) return true;
  if (n.kind === "fn" && n.fn === "exp") return true;
  if (varsIn(n).size > 0) return false;
  const v = constValue(n);
  return v !== null && Math.abs(v) > 1e-12;
};

/* --- structure helpers --------------------------------------------------- */

export function varsIn(n: TNode): Set<Variable> {
  const out = new Set<Variable>();
  const walk = (m: TNode) => {
    switch (m.kind) {
      case "named":
        break;
      case "var":
        out.add(m.name);
        break;
      case "add":
        m.terms.forEach(walk);
        break;
      case "mul":
        m.factors.forEach(walk);
        break;
      case "pow":
        walk(m.base);
        walk(m.exp);
        break;
      case "fn":
        walk(m.arg);
        break;
    }
  };
  walk(n);
  return out;
}

/** Canonical structural key for matching — semantic ids are deliberately omitted. */
export function keyOf(n: TNode): string {
  switch (n.kind) {
    case "const":
      return JSON.stringify({ kind: n.kind, num: n.num, den: n.den });
    case "named":
      return JSON.stringify({ kind: n.kind, name: n.name });
    case "var":
      return JSON.stringify({ kind: n.kind, name: n.name });
    case "add":
      return `{"kind":"add","terms":[${n.terms.map(keyOf).join(",")}]}`;
    case "mul":
      return `{"kind":"mul","factors":[${n.factors.map(keyOf).join(",")}]}`;
    case "pow":
      return `{"kind":"pow","base":${keyOf(n.base)},"exp":${keyOf(n.exp)}}`;
    case "fn":
      return `{"kind":"fn","fn":${JSON.stringify(n.fn)},"arg":${keyOf(n.arg)}}`;
  }
}

/** Split a term into (rational coefficient, remaining factors sorted by key) */
export function splitCoef(n: TNode): { num: number; den: number; core: TNode[] } {
  const factors = n.kind === "mul" ? n.factors : [n];
  let num = 1;
  let den = 1;
  const core: TNode[] = [];
  for (const f of factors) {
    if (f.kind === "const") {
      num *= f.num;
      den *= f.den;
    } else {
      core.push(f);
    }
  }
  core.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
  return { num, den, core };
}

/** The top-level addends of a side (0 → none) */
export const addendsOf = (n: TNode): TNode[] =>
  n.kind === "add" ? n.terms : isNum(n, 0) ? [] : [n];

export const sideFromAddends = (terms: TNode[]): TNode =>
  terms.length === 0 ? tc(0) : terms.length === 1 ? terms[0] : tadd(...terms);

/**
 * The factors exactly as a product is displayed around a fraction bar.
 *
 * Rational coefficients are stored canonically as one exact `const` node,
 * but students read (1/3)e^5/x as e^5/(3x). Splitting the rational here keeps
 * rendering, factor selection and drag resolution on the same boundary.
 * Callers strip a leading sign first, so the returned units are magnitudes.
 */
export interface DisplayedProductUnit {
  /** The expression printed in this position (for example 3 from 1/3). */
  expr: TNode;
  /** The persistent AST occurrence that owns the printed unit. */
  sourceId: TNodeId;
}

/**
 * Display projection with semantic provenance. A rational or negative power
 * can create a synthetic printed expression, but its handle still belongs to
 * the persistent source node rather than to a render-time temporary node.
 */
export function displayedProductUnits(
  body: TNode
): { numerator: DisplayedProductUnit[]; denominator: DisplayedProductUnit[] } {
  const factors = body.kind === "mul" ? body.factors : [body];
  const numerator: DisplayedProductUnit[] = [];
  const denominator: DisplayedProductUnit[] = [];

  for (const factor of factors) {
    if (factor.kind === "const" && factor.den !== 1) {
      if (factor.num !== 1) numerator.push({ expr: tc(factor.num), sourceId: factor.id });
      denominator.push({ expr: tc(factor.den), sourceId: factor.id });
    } else if (factor.kind === "pow" && factor.exp.kind === "const" && factor.exp.num < 0) {
      denominator.push({
        expr: simplify(tpow(factor.base, tc(-factor.exp.num, factor.exp.den))),
        sourceId: factor.id,
      });
    } else {
      numerator.push({ expr: factor, sourceId: factor.id });
    }
  }

  return { numerator, denominator };
}

/** Expressions-only compatibility view used by the plain-text printer. */
export function displayedProductFactors(body: TNode): { numerator: TNode[]; denominator: TNode[] } {
  const projected = displayedProductUnits(body);
  return {
    numerator: projected.numerator.map((unit) => unit.expr),
    denominator: projected.denominator.map((unit) => unit.expr),
  };
}

/* --- the whitelist simplifier -------------------------------------------- */

/**
 * Only identities true on ALL of ℝ (or wherever the ORIGINAL expression is
 * defined, without enlarging that domain) may appear here. Same-base powers
 * merge only when both exponents share a sign: x²·x³ → x⁵ is unconditional,
 * but x·x⁻¹ stays x/x — cancelling it is a player move with an x ≠ 0 pill.
 *
 * `assume` carries the keys of expressions a MOVE has declared nonzero (its
 * pill is already emitted) — only then may opposite-sign powers of that
 * base cancel. Constant bases that are provably nonzero cancel freely.
 */
function simplifyPass(n: TNode, assume?: Set<string>): TNode {
  switch (n.kind) {
    case "const":
      return normRat(n);
    case "named":
    case "var":
      return n;
    case "fn": {
      const arg = simplifyPass(n.arg, assume);
      if (n.fn === "ln") {
        if (arg.kind === "fn" && arg.fn === "exp") return arg.arg; // ln(e^u) = u — e^u is always > 0
        if (isNum(arg, 1)) return tc(0);
      }
      if (n.fn === "exp" && isNum(arg, 0)) return tc(1);
      if (n.fn === "sqrt" && arg.kind === "const" && arg.num >= 0) {
        const rn = Math.sqrt(arg.num);
        const rd = Math.sqrt(arg.den);
        if (Number.isInteger(rn) && Number.isInteger(rd)) return tc(rn, rd); // √4 = 2 exactly
      }
      return { id: n.id, kind: "fn", fn: n.fn, arg };
    }
    case "pow": {
      const base = simplifyPass(n.base, assume);
      const exp = simplifyPass(n.exp, assume);
      if (isNum(exp, 1)) return base;
      if (base.kind === "const" && exp.kind === "const" && exp.den === 1) {
        const p = exp.num;
        if (p === 0 && base.num !== 0) return tc(1);
        if (p !== 0 && Math.abs(p) <= 9 && (base.num !== 0 || p > 0)) {
          const a = p > 0 ? base.num : base.den;
          const b = p > 0 ? base.den : base.num;
          const nn = Math.pow(a, Math.abs(p));
          const dd = Math.pow(b, Math.abs(p));
          if (Number.isFinite(nn) && Number.isFinite(dd) && dd !== 0) return tc(nn, dd);
        }
      }
      // perfect roots fold exactly: 8^(1/3) = 2, 9^(1/2) = 3. Odd roots of
      // negatives are fine ((−8)^(1/3) = −2); even roots need base ≥ 0
      if (base.kind === "const" && exp.kind === "const" && exp.num === 1 && exp.den > 1) {
        const q = exp.den;
        if (base.num >= 0 || q % 2 === 1) {
          const rn = Math.round(Math.sign(base.num) * Math.abs(base.num) ** (1 / q));
          const rd = Math.round(base.den ** (1 / q));
          if (Math.pow(rn, q) === base.num && Math.pow(rd, q) === base.den) return tc(rn, rd);
        }
      }
      // (b^m)^n = b^(mn) for integers m, n. Unconditional when m, n > 0, and
      // when mn < 0 (both sides then require b ≠ 0 — same domain). Both
      // negative would ENLARGE the domain ((b⁻²)⁻¹ = b² claims b = 0 works),
      // so that case needs b provably or declaredly nonzero. Fractional
      // exponents ((x²)^½ = |x|!) stay a move's business.
      if (
        base.kind === "pow" &&
        base.exp.kind === "const" &&
        exp.kind === "const" &&
        base.exp.den === 1 &&
        exp.den === 1
      ) {
        const m = base.exp.num;
        const p = exp.num;
        if ((m > 0 && p > 0) || m * p < 0 || nonzeroNode(base.base, assume)) {
          return simplifyPass(tpow(base.base, m * p), assume);
        }
      }
      // The reciprocal of a canonical root keeps the same real domain when
      // written as a negative reciprocal exponent. Normalizing this exact
      // shape lets denominator roots cancel against their matching factors:
      // (b^(1/n))^−1 → b^(−1/n). Broader fractional power chaining is not
      // safe (for example (√x)^2 would silently enlarge the domain).
      if (
        base.kind === "pow" &&
        base.exp.kind === "const" &&
        base.exp.num === 1 &&
        base.exp.den >= 2 &&
        exp.kind === "const" &&
        exp.num === -1 &&
        exp.den === 1
      ) {
        return simplifyPass(tpow(base.base, tc(-1, base.exp.den)), assume);
      }
      // (a·b)^n = a^n·b^n for integer n — equal wherever either side is
      // defined; without this, dividing by a product can never cancel it
      if (base.kind === "mul" && exp.kind === "const" && exp.den === 1) {
        return simplifyPass(tmul(...base.factors.map((f) => tpow(f, exp))), assume);
      }
      // roots distribute where SIGNS allow: an odd root of a product splits
      // freely (odd roots preserve sign — (ab)^(1/3) = a^(1/3)·b^(1/3) for
      // all reals); an even root pulls out only the provably nonnegative
      // factors (e^u, √, nonnegative constants, even powers) and leaves the
      // rest wrapped. This is what folds ((e³·x)/sin(x))^(1/3) down to
      // e · x^(1/3)/sin(x)^(1/3).
      if (base.kind === "mul" && exp.kind === "const" && exp.num === 1 && exp.den > 1) {
        const oddRoot = exp.den % 2 === 1;
        const nonneg = (f: TNode): boolean =>
          (f.kind === "fn" && (f.fn === "exp" || f.fn === "sqrt")) ||
          (f.kind === "const" && f.num >= 0) ||
          (f.kind === "named" && f.name === "pi") ||
          (f.kind === "pow" && f.exp.kind === "const" && f.exp.den === 1 && f.exp.num % 2 === 0);
        const pulled = base.factors.filter((f) => oddRoot || nonneg(f));
        const kept = base.factors.filter((f) => !(oddRoot || nonneg(f)));
        if (pulled.length > 0) {
          const factors = [
            ...pulled.map((f) => tpow(f, exp)),
            ...(kept.length > 0 ? [tpow(kept.length === 1 ? kept[0] : tmul(...kept), exp)] : []),
          ];
          return simplifyPass(tmul(...factors), assume);
        }
      }
      // an odd root of an ODD integer power folds by dividing exponents —
      // both operations preserve sign, so domains match: (b⁻¹)^(1/3) = b^(−1/3)
      if (
        base.kind === "pow" &&
        base.exp.kind === "const" &&
        base.exp.den === 1 &&
        Math.abs(base.exp.num) % 2 === 1 &&
        exp.kind === "const" &&
        exp.num === 1 &&
        exp.den > 1 &&
        exp.den % 2 === 1
      ) {
        return simplifyPass(tpow(base.base, tc(base.exp.num, exp.den)), assume);
      }
      // …and the reverse: an integer power of an odd-root power multiplies
      // exponents — (b^(1/3))³ = b. Odd roots preserve sign, domains match.
      if (
        base.kind === "pow" &&
        base.exp.kind === "const" &&
        base.exp.den > 1 &&
        base.exp.den % 2 === 1 &&
        exp.kind === "const" &&
        exp.den === 1
      ) {
        return simplifyPass(tpow(base.base, tc(base.exp.num * exp.num, base.exp.den)), assume);
      }
      // (e^u)^v = e^(uv) — e^u is positive for every real u, so this holds
      // unconditionally (no domain fine print like variable bases)
      if (base.kind === "fn" && base.fn === "exp") {
        return simplifyPass(tfn("exp", tmul(exp, base.arg)), assume);
      }
      return { id: n.id, kind: "pow", base, exp };
    }
    case "mul": {
      // flatten, fold rational constants
      const flat: TNode[] = [];
      const push = (m: TNode) => (m.kind === "mul" ? m.factors.forEach(push) : flat.push(m));
      n.factors.map((f) => simplifyPass(f, assume)).forEach(push);
      let num = 1;
      let den = 1;
      const rest: TNode[] = [];
      const constantInputs: TNode[] = [];
      for (const f of flat) {
        if (f.kind === "const") {
          constantInputs.push(f);
          num *= f.num;
          den *= f.den;
        } else rest.push(f);
      }
      if (num === 0) return tc(0);
      // Rebuilt power/exponential groups are matched back to these simplified
      // occurrences when their structure did not actually change.
      const originalRest = [...rest];
      // e^a · e^b · (e^c)^k … = e^(a + b + kc …): exponentials merge by
      // ADDING arguments. e^u is never zero or negative, so this needs no
      // sign-class guard — it's how e³/e² becomes plain e.
      {
        const expArgs: TNode[] = [];
        const kept: TNode[] = [];
        for (const f of rest) {
          if (f.kind === "fn" && f.fn === "exp") expArgs.push(f.arg);
          else if (f.kind === "pow" && f.base.kind === "fn" && f.base.fn === "exp") {
            expArgs.push(tmul(f.exp, f.base.arg));
          } else kept.push(f);
        }
        if (expArgs.length > 0) {
          const merged = simplifyPass(
            tfn("exp", expArgs.length === 1 ? expArgs[0] : tadd(...expArgs)),
            assume
          );
          if (!isNum(merged, 1)) kept.push(merged);
          rest.length = 0;
          rest.push(...kept);
        }
      }
      // same-base powers: merge only within a sign class (the x/x guard)
      const byBase = new Map<string, { base: TNode; pos: { n: number; d: number }; neg: { n: number; d: number }; other: TNode[] }>();
      const order: string[] = [];
      for (const f of rest) {
        const b = f.kind === "pow" ? f.base : f;
        const e: TNode = f.kind === "pow" ? f.exp : tc(1);
        const k = keyOf(b);
        if (!byBase.has(k)) {
          byBase.set(k, { base: b, pos: { n: 0, d: 1 }, neg: { n: 0, d: 1 }, other: [] });
          order.push(k);
        }
        const slot = byBase.get(k)!;
        if (e.kind === "const") {
          const acc = e.num > 0 ? slot.pos : slot.neg;
          acc.n = acc.n * e.den + e.num * acc.d;
          acc.d *= e.den;
        } else {
          slot.other.push(f);
        }
      }
      const out: TNode[] = [];
      // a base may cancel across sign classes only when it cannot be zero:
      // a provably nonzero constant, e^(anything), or a declared ≠ 0
      for (const k of order) {
        const { base, pos, neg, other } = byBase.get(k)!;
        let accs = [pos, neg].filter((a) => a.n !== 0);
        if (accs.length === 2 && nonzeroNode(base, assume)) {
          const merged = { n: pos.n * neg.d + neg.n * pos.d, d: pos.d * neg.d };
          accs = merged.n === 0 ? [] : [merged];
        }
        for (const acc of accs) {
          const e = normRat({ kind: "const", num: acc.n, den: acc.d });
          out.push(isNum(e, 1) ? base : simplifyPass(tpow(base, e), assume));
        }
        out.push(...other);
      }
      // A canonical pass must not replace an unchanged occurrence with a new
      // id merely because the grouping algorithm rebuilt the same shape.
      const originalsByKey = new Map<string, TNode[]>();
      for (const factor of originalRest) {
        const key = keyOf(factor);
        const bucket = originalsByKey.get(key) ?? [];
        bucket.push(factor);
        originalsByKey.set(key, bucket);
      }
      for (let i = 0; i < out.length; i++) {
        const bucket = originalsByKey.get(keyOf(out[i]));
        if (bucket?.length) out[i] = bucket.shift()!;
      }
      // constant-valued factors (ln 2, √2 …) read as coefficients — put them first
      const factorRank = (factor: TNode): number => {
        const constantValued = varsIn(factor).size === 0;
        if (constantValued) {
          if (factor.kind === "named") return 0;
          if (factor.kind === "fn" && factor.fn === "sqrt") return 1;
          if (
            factor.kind === "pow" &&
            factor.exp.kind === "const" &&
            factor.exp.num === 1 &&
            factor.exp.den >= 2
          ) return 1;
          if (factor.kind === "fn" && factor.fn === "exp") return 2;
          return 3;
        }
        const visibleBase = factor.kind === "pow" ? factor.base : factor;
        if (visibleBase.kind === "var") return 10;
        if (visibleBase.kind === "pow") return 11;
        if (visibleBase.kind === "add") return 12;
        if (visibleBase.kind === "fn") return 13;
        return 14;
      };
      out.sort((a, b) => factorRank(a) - factorRank(b) || keyOf(a).localeCompare(keyOf(b)));
      let coef = normRat({ kind: "const", num, den });
      const unchangedCoef = constantInputs.find(
        (factor) =>
          factor.kind === "const" &&
          coef.kind === "const" &&
          factor.num === coef.num &&
          factor.den === coef.den
      );
      if (unchangedCoef) coef = unchangedCoef;
      if (out.length === 0) return coef;
      if (isNum(coef, 1)) return out.length === 1 ? out[0] : { id: n.id, kind: "mul", factors: out };
      return { id: n.id, kind: "mul", factors: [coef, ...out] };
    }
    case "add": {
      const flat: TNode[] = [];
      const push = (m: TNode) => (m.kind === "add" ? m.terms.forEach(push) : flat.push(m));
      n.terms.map((t) => simplifyPass(t, assume)).forEach(push);
      let cn = 0;
      let cd = 1;
      const constantInputs: TNode[] = [];
      const groups = new Map<
        string,
        { id: TNodeId; num: number; den: number; core: TNode[]; source: TNode; count: number }
      >();
      const order: string[] = [];
      for (const t of flat) {
        if (t.kind === "const") {
          constantInputs.push(t);
          cn = cn * t.den + t.num * cd;
          cd *= t.den;
          continue;
        }
        const { num, den, core } = splitCoef(t);
        const k = core.map(keyOf).join("*");
        if (!groups.has(k)) {
          groups.set(k, { id: t.id, num: 0, den: 1, core, source: t, count: 0 });
          order.push(k);
        }
        const slot = groups.get(k)!;
        slot.count++;
        slot.num = slot.num * den + num * slot.den;
        slot.den *= den;
      }
      const terms: TNode[] = [];
      for (const k of order) {
        const { id, num, den, core, source, count } = groups.get(k)!;
        if (num === 0) continue;
        const coef = normRat({ kind: "const", num, den });
        const candidate: TNode =
          isNum(coef, 1)
            ? core.length === 1
              ? core[0]
              : { id, kind: "mul" as const, factors: core }
            : { id, kind: "mul" as const, factors: [coef, ...core] };
        // `source` was already recursively simplified above. With one member
        // there is no like-term arithmetic to perform, so keep the complete
        // occurrence (including every factor id and its pedagogical order).
        terms.push(count === 1 ? source : candidate);
      }
      if (cn !== 0) {
        let constant = normRat({ kind: "const", num: cn, den: cd });
        if (constantInputs.length === 1) {
          const original = constantInputs[0];
          if (keyOf(original) === keyOf(constant)) constant = original;
        }
        terms.push(constant);
      }
      if (terms.length === 0) return tc(0);
      if (terms.length === 1) return terms[0];
      return { id: n.id, kind: "add", terms };
    }
  }
}

/**
 * Canonical, idempotent normalization. `simplifyPass` is recursive and each
 * rewrite is directionally reducing; this outer fixed-point closes the few
 * cases where rebuilding a parent exposes a new canonical ordering.
 */
export function simplify(n: TNode, assume?: Set<string>): TNode {
  let current = n;
  const seen = new Set<string>();
  for (let pass = 0; pass < 8; pass++) {
    const before = keyOf(current);
    if (seen.has(before)) return current;
    seen.add(before);
    const next = simplifyPass(current, assume);
    if (keyOf(next) === before) return next;
    current = next;
  }
  return current;
}

/* --- evaluation ----------------------------------------------------------- */

const FN_EVAL: Record<TFnName, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  exp: Math.exp,
  sqrt: Math.sqrt,
};

export function evalNode(n: TNode, env: { x?: number; y?: number }): number {
  switch (n.kind) {
    case "const":
      return n.num / n.den;
    case "named":
      return n.name === "pi" ? Math.PI : NaN;
    case "var":
      return env[n.name] ?? NaN;
    case "add":
      return n.terms.reduce((a, t) => a + evalNode(t, env), 0);
    case "mul":
      return n.factors.reduce((a, f) => a * evalNode(f, env), 1);
    case "pow":
      {
        const base = evalNode(n.base, env);
        const exp = evalNode(n.exp, env);
        // JavaScript returns NaN for rational odd-root powers of a negative
        // base, although (-8)^(1/3) = -2 and (-8)^(2/3) = 4 over the reals.
        if (
          base < 0 &&
          n.exp.kind === "const" &&
          n.exp.den > 1 &&
          n.exp.den % 2 === 1
        ) {
          const root = Math.sign(base) * Math.abs(base) ** (1 / n.exp.den);
          return Math.pow(root, n.exp.num);
        }
        return Math.pow(base, exp);
      }
    case "fn":
      return FN_EVAL[n.fn](evalNode(n.arg, env));
  }
}

/** Exact-ish numeric value of a variable-free tree, else null */
export const constValue = (n: TNode): number | null => {
  if (varsIn(n).size > 0) return null;
  const v = evalNode(n, {});
  return Number.isFinite(v) ? v : null;
};

/* --- plain-text printing (history rows, previews, labels) ---------------- */

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const supInt = (p: number): string =>
  (p < 0 ? "⁻" : "") + String(Math.abs(p)).split("").map((d) => SUP[Number(d)]).join("");

const needsParens = (n: TNode): boolean => n.kind === "add" || (n.kind === "const" && n.num < 0);

export function printNode(n: TNode): string {
  switch (n.kind) {
    case "const":
      return n.den === 1 ? String(n.num).replace("-", "−") : `${String(n.num).replace("-", "−")}/${n.den}`;
    case "named":
      return "π";
    case "var":
      return n.name;
    case "add":
      return n.terms
        .map((t, i) => {
          const { neg, body } = signSplit(t);
          // a negated sum inside a sum keeps its parens: 5 − (x + 2), not
          // 5 − x + 2 (which drops the sign on the 2)
          const raw = printNode(body);
          const text = body.kind === "add" ? `(${raw})` : raw;
          if (i === 0) return neg ? `−${text}` : text;
          return ` ${neg ? "−" : "+"} ${text}`;
        })
        .join("");
    case "mul": {
      const split = signSplit(n);
      // a negated SUM needs parens: −(x + 2), never −x + 2 (which reads as a
      // different expression). Bare products/powers/vars need none.
      if (split.neg) {
        const b = printNode(split.body);
        return split.body.kind === "add" ? `−(${b})` : `−${b}`;
      }
      const { numerator: numer, denominator: denom } = displayedProductFactors(n);
      const part = (fs: TNode[]): string => {
        if (fs.length === 0) return "1";
        let out = "";
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          const text = needsParens(f) ? `(${printNode(f)})` : printNode(f);
          if (i === 0) out = text;
          else out += fs[i - 1].kind === "const" && f.kind !== "const" ? text : `·${text}`;
        }
        return out;
      };
      const top = part(numer);
      if (denom.length === 0) return top;
      const bottom = part(denom);
      const wrapTop = numer.length > 1 || (numer[0] && numer[0].kind === "add") ? `(${top})` : top;
      const onlyDenom = denom[0];
      const nestedFraction =
        onlyDenom.kind === "mul" ||
        (onlyDenom.kind === "const" && onlyDenom.den !== 1) ||
        (onlyDenom.kind === "pow" && onlyDenom.exp.kind === "const" && onlyDenom.exp.num < 0);
      const wrapBottom = denom.length > 1 || onlyDenom.kind === "add" || nestedFraction ? `(${bottom})` : bottom;
      return `${wrapTop}/${wrapBottom}`;
    }
    case "pow": {
      if (n.exp.kind === "const" && n.exp.num === 1 && n.exp.den >= 2) {
        const index = n.exp.den === 2 ? "" : supInt(n.exp.den);
        return `${index}√(${printNode(n.base)})`;
      }
      const base = needsParens(n.base) || n.base.kind === "mul" || n.base.kind === "pow" || n.base.kind === "fn"
        ? `(${printNode(n.base)})`
        : printNode(n.base);
      if (n.exp.kind === "const" && n.exp.den === 1) {
        if (n.exp.num < 0) return `1/${base}${n.exp.num === -1 ? "" : supInt(-n.exp.num)}`;
        return `${base}${supInt(n.exp.num)}`;
      }
      const e = printNode(n.exp);
      const bare = n.exp.kind === "var" || (n.exp.kind === "const" && n.exp.den === 1);
      return `${base}^${bare ? e : `(${e})`}`;
    }
    case "fn":
      if (n.fn === "exp" && isNum(n.arg, 1)) return "e"; // e^1 is just e
      if (n.fn === "exp") {
        // an exponent is safe bare ONLY as a variable or non-negative integer;
        // a fraction or negative needs parens or the text re-reads wrong —
        // e^5/2 would parse as (e^5)/2, e^−1/2 as (e^−1)/2
        const bare = n.arg.kind === "var" || (n.arg.kind === "const" && n.arg.den === 1 && n.arg.num >= 0);
        return `e^${bare ? printNode(n.arg) : `(${printNode(n.arg)})`}`;
      }
      if (n.fn === "sqrt") return `√(${printNode(n.arg)})`;
      return `${n.fn === "asin" ? "arcsin" : n.fn === "acos" ? "arccos" : n.fn === "atan" ? "arctan" : n.fn}(${printNode(n.arg)})`;
  }
}

export const printTreeEq = (te: TreeEq): string => `${printNode(te.left)} = ${printNode(te.right)}`;

/** Pull a leading negative out of a term, for display (−2x → "−", 2x) */
export function signSplit(n: TNode): { neg: boolean; body: TNode } {
  if (n.kind === "const" && n.num < 0) {
    return { neg: true, body: { id: n.id, kind: "const", num: -n.num, den: n.den } };
  }
  if (n.kind === "mul") {
    const first = n.factors[0];
    if (first && first.kind === "const" && first.num < 0) {
      const pos: TNode = { id: first.id, kind: "const", num: -first.num, den: first.den };
      const rest = n.factors.slice(1);
      const body = isNum(pos, 1)
        ? rest.length === 1
          ? rest[0]
          : { id: n.id, kind: "mul" as const, factors: rest }
        : { id: n.id, kind: "mul" as const, factors: [pos, ...rest] };
      return { neg: true, body };
    }
  }
  return { neg: false, body: n };
}

/* --- differentiation ------------------------------------------------------ */

/**
 * d/dv of a tree, or null when a rule is beyond the playground (u^v with
 * both parts variable). Only ever applied to identities y = f(x) — the move
 * layer enforces that; differentiating a conditional equation is invalid.
 */
export function derivative(n: TNode, v: Variable): TNode | null {
  switch (n.kind) {
    case "const":
    case "named":
      return tc(0);
    case "var":
      return tc(n.name === v ? 1 : 0);
    case "add": {
      const parts = n.terms.map((t) => derivative(t, v));
      if (parts.some((p) => p === null)) return null;
      return tadd(...(parts as TNode[]));
    }
    case "mul": {
      // product rule over all factors: Σᵢ fᵢ'·Πⱼ≠ᵢ fⱼ
      const terms: TNode[] = [];
      for (let i = 0; i < n.factors.length; i++) {
        const d = derivative(n.factors[i], v);
        if (d === null) return null;
        terms.push(tmul(d, ...n.factors.filter((_, j) => j !== i)));
      }
      return tadd(...terms);
    }
    case "pow": {
      const expConst = varsIn(n.exp).size === 0;
      const baseConst = varsIn(n.base).size === 0;
      if (expConst) {
        // (u^c)' = c·u^(c−1)·u'
        const du = derivative(n.base, v);
        if (du === null) return null;
        return tmul(n.exp, tpow(n.base, simplify(tadd(n.exp, tc(-1)))), du);
      }
      if (baseConst) {
        // (a^u)' = a^u·ln a·u' — a^u exists only for a > 0, where ln a does too
        const du = derivative(n.exp, v);
        if (du === null) return null;
        return tmul(n, tfn("ln", n.base), du);
      }
      return null; // u^v with both variable — beyond the playground, honestly
    }
    case "fn": {
      const du = derivative(n.arg, v);
      if (du === null) return null;
      const u = n.arg;
      const outer: TNode | null =
        n.fn === "sin"
          ? tfn("cos", u)
          : n.fn === "cos"
            ? tmul(tc(-1), tfn("sin", u))
            : n.fn === "tan"
              ? tpow(tfn("cos", u), -2)
              : n.fn === "ln"
                ? tpow(u, -1)
                : n.fn === "exp"
                  ? tfn("exp", u)
                  : n.fn === "sqrt"
                    ? tmul(tc(1, 2), tpow(tfn("sqrt", u), -1))
                    : n.fn === "asin"
                      ? tpow(tadd(tc(1), tmul(tc(-1), tpow(u, 2))), tc(-1, 2))
                      : n.fn === "acos"
                        ? tmul(tc(-1), tpow(tadd(tc(1), tmul(tc(-1), tpow(u, 2))), tc(-1, 2)))
                        : n.fn === "atan"
                          ? tpow(tadd(tc(1), tpow(u, 2)), -1)
                    : null;
      if (!outer) return null;
      return tmul(outer, du);
    }
  }
}

/* --- antidifferentiation --------------------------------------------------- */

/** n as (a·v + b) with rational a ≠ 0 and b free of v, or null */
function linearIn(n: TNode, v: Variable): { aNum: number; aDen: number } | null {
  let aNum = 0;
  let aDen = 1;
  for (const t of addendsOf(simplify(n))) {
    if (!varsIn(t).has(v)) continue; // a constant (or other-variable) offset
    const { num, den, core } = splitCoef(t);
    if (core.length !== 1 || core[0].kind !== "var" || core[0].name !== v) return null;
    aNum = aNum * den + num * aDen;
    aDen *= den;
  }
  if (aNum === 0) return null;
  const g = gcd(aNum, aDen) || 1;
  return { aNum: aNum / g, aDen: aDen / g };
}

/**
 * ∫ n dv by rules, or null where the rules end. Unlike differentiation this
 * CANNOT be total: some integrands (e^(−x²)) provably have no elementary
 * antiderivative at all — refusal is the mathematics, not a shortcut.
 * Introduced ln's carry a positivity assumption; the MOVE pins the pill.
 */
export function antiderivative(n: TNode, v: Variable): TNode | null {
  switch (n.kind) {
    case "const":
    case "named":
      return tmul(n, tv(v));
    case "var":
      return n.name === v ? tmul(tc(1, 2), tpow(tv(v), 2)) : tmul(n, tv(v));
    case "add": {
      const parts = n.terms.map((t) => antiderivative(t, v));
      if (parts.some((p) => p === null)) return null;
      return tadd(...(parts as TNode[]));
    }
    case "mul": {
      // factors free of v ride along as constants; one v-core integrates
      const { num, den, core } = splitCoef(n);
      const constant = core.filter((f) => !varsIn(f).has(v));
      const living = core.filter((f) => varsIn(f).has(v));
      if (living.length === 0) return tmul(n, tv(v));
      if (living.length > 1) return null; // no product rule for integrals
      const inner = antiderivative(living[0], v);
      if (inner === null) return null;
      return tmul(tc(num, den), ...constant, inner);
    }
    case "pow": {
      // u^c for linear u: u^(c+1) / (a·(c+1)); c = −1 gives ln(u)/a
      if (n.exp.kind === "const" && varsIn(n.base).has(v)) {
        const lin = linearIn(n.base, v);
        if (!lin) return null;
        const { num: cn, den: cd } = n.exp;
        if (cn === -cd) {
          return tmul(tc(lin.aDen, lin.aNum), tfn("ln", n.base));
        }
        const upNum = cn + cd; // c + 1 as (cn + cd)/cd
        return tmul(tc(cd * lin.aDen, upNum * lin.aNum), tpow(n.base, tc(upNum, cd)));
      }
      // a^u for constant a > 0 and linear u: a^u / (a_lin·ln a)
      if (n.base.kind === "const" && n.base.num > 0 && varsIn(n.exp).has(v)) {
        const lin = linearIn(n.exp, v);
        if (!lin) return null;
        return tmul(tc(lin.aDen, lin.aNum), n, tpow(tfn("ln", n.base), -1));
      }
      return null;
    }
    case "fn": {
      if (!varsIn(n.arg).has(v)) return tmul(n, tv(v)); // a constant in disguise
      const lin = linearIn(n.arg, v);
      if (!lin) return null; // chain rule has no reverse gear beyond linear
      const inv = tc(lin.aDen, lin.aNum);
      switch (n.fn) {
        case "sin":
          return tmul(tc(-1), inv, tfn("cos", n.arg));
        case "cos":
          return tmul(inv, tfn("sin", n.arg));
        case "exp":
          return tmul(inv, tfn("exp", n.arg));
        case "sqrt":
          return tmul(tc(2, 3), inv, tpow(n.arg, tc(3, 2)));
        case "ln":
          // ∫ln(u) = (u·ln u − u)/a
          return tmul(inv, tadd(tmul(n.arg, tfn("ln", n.arg)), tmul(tc(-1), n.arg)));
        case "tan":
          return null; // −ln|cos| needs the |…| we don't have
        case "asin":
        case "acos":
        case "atan":
          return null; // inverse-trig antiderivatives need forms beyond this playground
      }
    }
  }
}

/** Does the tree contain ln(something mentioning v)? — the ∫ move's pill scan */
export function introducesLnOf(n: TNode, v: Variable): boolean {
  switch (n.kind) {
    case "fn":
      return (n.fn === "ln" && varsIn(n.arg).has(v)) || introducesLnOf(n.arg, v);
    case "add":
      return n.terms.some((t) => introducesLnOf(t, v));
    case "mul":
      return n.factors.some((f) => introducesLnOf(f, v));
    case "pow":
      return introducesLnOf(n.base, v) || introducesLnOf(n.exp, v);
    default:
      return false;
  }
}

/* --- the escape hatch: tree → flat model when representable --------------- */

const FLAT_FN: TFnName[] = ["sin", "cos", "tan", "ln", "exp"];

/** A whole side to flat terms, or null when the tree exceeds the flat model */
export function treeSideToFlat(n: TNode): EqTerm[] | null {
  const out: EqTerm[] = [];
  for (const t of addendsOf(n)) {
    const flat = termToFlat(t);
    if (!flat) return null;
    out.push(flat);
  }
  return out;
}

function termToFlat(t: TNode): EqTerm | null {
  const { num, den, core } = splitCoef(t);
  if (!Number.isInteger(num) || !Number.isInteger(den)) return null;
  if (core.length === 0) return leaf(num, 0, den);
  if (core.length !== 1) return null; // x·y and friends stay in the tree
  const f = core[0];
  if (f.kind === "var") return leaf(num, 1, den, f.name);
  if (f.kind === "pow" && f.base.kind === "var" && f.exp.kind === "const" && f.exp.den === 1) {
    const p = f.exp.num;
    if (p !== 0 && Math.abs(p) <= 9) return leaf(num, p, den, f.base.name);
    return null;
  }
  if (f.kind === "fn" && (FLAT_FN as string[]).includes(f.fn)) {
    const inner = treeSideToFlat(f.arg);
    if (!inner || inner.length === 0) return null;
    return scaleDen(scaleNum(func(f.fn as FuncName, 1, inner), num), den);
  }
  if (f.kind === "add") {
    const inner = treeSideToFlat(f);
    if (!inner || inner.length === 0) return null;
    return scaleDen(scaleNum(group(1, inner), num), den);
  }
  return null;
}

/** Flat terms → tree (for potential round-trips; kept total) */
export function flatToTree(terms: EqTerm[]): TNode {
  const conv = (t: EqTerm): TNode => {
    if (t.kind === "leaf") {
      // frozen values (±√, arc…) don't exist in the tree grammar — approximate
      // by their defining expression where possible
      let core: TNode | null = null;
      if (t.radical) core = tfn("sqrt", tc(t.num, t.den));
      else if (t.fnVal === "e^") core = tfn("exp", tc(t.num, t.den));
      else if (t.fnVal === "ln") core = tfn("ln", tc(t.num, t.den));
      if (core) return t.neg ? tmul(tc(-1), core) : core;
      const coef = tc(t.num, t.den);
      if (t.power === 0) return coef;
      const v = tpow(tv(varOf(t)), t.power);
      return t.num === 1 && t.den === 1 ? simplify(v) : tmul(coef, simplify(v));
    }
    const inner = sideFromAddends(t.inner.map(conv));
    const body = t.kind === "group" ? inner : tfn(t.fn, inner);
    return t.num === 1 && t.den === 1 ? body : tmul(tc(t.num, t.den), body);
  };
  return simplify(sideFromAddends(terms.map(conv)));
}
