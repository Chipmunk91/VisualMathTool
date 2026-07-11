/**
 * The expression tree — the model behind "frontier" equations that the flat
 * term model can't hold: 1/(x+1), 2^x, √(x+1), x·y.
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

export type TFnName = FuncName | "sqrt";

export type TNode =
  | { kind: "const"; num: number; den: number }
  | { kind: "var"; name: Variable }
  | { kind: "add"; terms: TNode[] }
  | { kind: "mul"; factors: TNode[] }
  | { kind: "pow"; base: TNode; exp: TNode }
  | { kind: "fn"; fn: TFnName; arg: TNode };

export interface TreeEq {
  left: TNode;
  right: TNode;
}

/* --- constructors ------------------------------------------------------- */

export const tc = (num: number, den = 1): TNode => normRat({ kind: "const", num, den });
export const tv = (name: Variable): TNode => ({ kind: "var", name });
export const tadd = (...terms: TNode[]): TNode => ({ kind: "add", terms });
export const tmul = (...factors: TNode[]): TNode => ({ kind: "mul", factors });
export const tpow = (base: TNode, exp: TNode | number): TNode => ({
  kind: "pow",
  base,
  exp: typeof exp === "number" ? tc(exp) : exp,
});
export const tfn = (fn: TFnName, arg: TNode): TNode => ({ kind: "fn", fn, arg });

export const cloneTree = (n: TNode): TNode => JSON.parse(JSON.stringify(n));
export const cloneTreeEq = (te: TreeEq): TreeEq => ({ left: cloneTree(te.left), right: cloneTree(te.right) });

function normRat(n: { kind: "const"; num: number; den: number }): TNode {
  let { num, den } = n;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den) || 1;
  return { kind: "const", num: num / g, den: den / g };
}

/** Is this node exactly the integer `num`? (plain boolean — no narrowing) */
const isNum = (n: TNode, num: number): boolean => n.kind === "const" && n.num === num && n.den === 1;

/* --- structure helpers --------------------------------------------------- */

export function varsIn(n: TNode): Set<Variable> {
  const out = new Set<Variable>();
  const walk = (m: TNode) => {
    switch (m.kind) {
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

/** Canonical key for like-term matching — pure structure, no ids to strip */
export const keyOf = (n: TNode): string => JSON.stringify(n);

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
export function simplify(n: TNode, assume?: Set<string>): TNode {
  switch (n.kind) {
    case "const":
      return normRat(n);
    case "var":
      return n;
    case "fn": {
      const arg = simplify(n.arg, assume);
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
      return { kind: "fn", fn: n.fn, arg };
    }
    case "pow": {
      const base = simplify(n.base, assume);
      const exp = simplify(n.exp, assume);
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
      // (x^a)^b for positive integers a, b is unconditional; anything else
      // ((x²)^½ = |x|!) is a move's business, not ours
      if (
        base.kind === "pow" &&
        base.exp.kind === "const" &&
        exp.kind === "const" &&
        base.exp.den === 1 &&
        exp.den === 1 &&
        base.exp.num > 0 &&
        exp.num > 0
      ) {
        return simplify(tpow(base.base, base.exp.num * exp.num));
      }
      return { kind: "pow", base, exp };
    }
    case "mul": {
      // flatten, fold rational constants
      const flat: TNode[] = [];
      const push = (m: TNode) => (m.kind === "mul" ? m.factors.forEach(push) : flat.push(m));
      n.factors.map((f) => simplify(f, assume)).forEach(push);
      let num = 1;
      let den = 1;
      const rest: TNode[] = [];
      for (const f of flat) {
        if (f.kind === "const") {
          num *= f.num;
          den *= f.den;
        } else rest.push(f);
      }
      if (num === 0) return tc(0);
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
      // a provably nonzero constant, or an expression a move has declared ≠ 0
      const knownNonzero = (base: TNode): boolean => {
        if (assume?.has(keyOf(base))) return true;
        if (varsIn(base).size > 0) return false;
        const v = constValue(base);
        return v !== null && Math.abs(v) > 1e-12;
      };
      for (const k of order) {
        const { base, pos, neg, other } = byBase.get(k)!;
        let accs = [pos, neg].filter((a) => a.n !== 0);
        if (accs.length === 2 && knownNonzero(base)) {
          const merged = { n: pos.n * neg.d + neg.n * pos.d, d: pos.d * neg.d };
          accs = merged.n === 0 ? [] : [merged];
        }
        for (const acc of accs) {
          const e = normRat({ kind: "const", num: acc.n, den: acc.d });
          out.push(isNum(e, 1) ? base : simplify(tpow(base, e)));
        }
        out.push(...other);
      }
      // constant-valued factors (ln 2, √2 …) read as coefficients — put them first
      out.sort((a, b) => Number(varsIn(a).size > 0) - Number(varsIn(b).size > 0));
      const coef = normRat({ kind: "const", num, den });
      if (out.length === 0) return coef;
      if (isNum(coef, 1)) return out.length === 1 ? out[0] : { kind: "mul", factors: out };
      return { kind: "mul", factors: [coef, ...out] };
    }
    case "add": {
      const flat: TNode[] = [];
      const push = (m: TNode) => (m.kind === "add" ? m.terms.forEach(push) : flat.push(m));
      n.terms.map((t) => simplify(t, assume)).forEach(push);
      let cn = 0;
      let cd = 1;
      const groups = new Map<string, { num: number; den: number; core: TNode[] }>();
      const order: string[] = [];
      for (const t of flat) {
        if (t.kind === "const") {
          cn = cn * t.den + t.num * cd;
          cd *= t.den;
          continue;
        }
        const { num, den, core } = splitCoef(t);
        const k = core.map(keyOf).join("*");
        if (!groups.has(k)) {
          groups.set(k, { num: 0, den: 1, core });
          order.push(k);
        }
        const slot = groups.get(k)!;
        slot.num = slot.num * den + num * slot.den;
        slot.den *= den;
      }
      const terms: TNode[] = [];
      for (const k of order) {
        const { num, den, core } = groups.get(k)!;
        if (num === 0) continue;
        const coef = normRat({ kind: "const", num, den });
        terms.push(
          isNum(coef, 1)
            ? core.length === 1
              ? core[0]
              : { kind: "mul", factors: core }
            : { kind: "mul", factors: [coef, ...core] }
        );
      }
      if (cn !== 0) terms.push(normRat({ kind: "const", num: cn, den: cd }));
      return sideFromAddends(terms);
    }
  }
}

/* --- evaluation ----------------------------------------------------------- */

const FN_EVAL: Record<TFnName, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  exp: Math.exp,
  sqrt: Math.sqrt,
};

export function evalNode(n: TNode, env: { x?: number; y?: number }): number {
  switch (n.kind) {
    case "const":
      return n.num / n.den;
    case "var":
      return env[n.name] ?? NaN;
    case "add":
      return n.terms.reduce((a, t) => a + evalNode(t, env), 0);
    case "mul":
      return n.factors.reduce((a, f) => a * evalNode(f, env), 1);
    case "pow":
      return Math.pow(evalNode(n.base, env), evalNode(n.exp, env));
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
    case "var":
      return n.name;
    case "add":
      return n.terms
        .map((t, i) => {
          const { neg, body } = signSplit(t);
          const text = printNode(body);
          if (i === 0) return neg ? `−${text}` : text;
          return ` ${neg ? "−" : "+"} ${text}`;
        })
        .join("");
    case "mul": {
      const numer: TNode[] = [];
      const denom: TNode[] = [];
      for (const f of n.factors) {
        if (f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0) {
          denom.push(simplify(tpow(f.base, tc(-f.exp.num, f.exp.den))));
        } else numer.push(f);
      }
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
      const wrapBottom = denom.length > 1 || denom[0].kind === "add" ? `(${bottom})` : bottom;
      return `${wrapTop}/${wrapBottom}`;
    }
    case "pow": {
      const base = needsParens(n.base) || n.base.kind === "mul" || n.base.kind === "pow" || n.base.kind === "fn"
        ? `(${printNode(n.base)})`
        : printNode(n.base);
      if (n.exp.kind === "const" && n.exp.den === 1) {
        if (n.exp.num < 0) return `1/${base}${n.exp.num === -1 ? "" : supInt(-n.exp.num)}`;
        return `${base}${supInt(n.exp.num)}`;
      }
      const e = printNode(n.exp);
      return `${base}^${n.exp.kind === "var" || n.exp.kind === "const" ? e : `(${e})`}`;
    }
    case "fn":
      if (n.fn === "exp") return `e^${n.arg.kind === "var" || n.arg.kind === "const" ? printNode(n.arg) : `(${printNode(n.arg)})`}`;
      if (n.fn === "sqrt") return `√(${printNode(n.arg)})`;
      return `${n.fn}(${printNode(n.arg)})`;
  }
}

export const printTreeEq = (te: TreeEq): string => `${printNode(te.left)} = ${printNode(te.right)}`;

/** Pull a leading negative out of a term, for display (−2x → "−", 2x) */
export function signSplit(n: TNode): { neg: boolean; body: TNode } {
  if (n.kind === "const" && n.num < 0) return { neg: true, body: tc(-n.num, n.den) };
  if (n.kind === "mul") {
    const first = n.factors[0];
    if (first && first.kind === "const" && first.num < 0) {
      const pos = tc(-first.num, first.den);
      const rest = n.factors.slice(1);
      const body = isNum(pos, 1)
        ? rest.length === 1
          ? rest[0]
          : { kind: "mul" as const, factors: rest }
        : { kind: "mul" as const, factors: [pos, ...rest] };
      return { neg: true, body };
    }
  }
  return { neg: false, body: n };
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
