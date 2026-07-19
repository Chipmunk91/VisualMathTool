/**
 * The equation playground's term model.
 * Leaf terms are (num/den) · x^power with den > 0, reduced.
 * Group terms are (num/den) · (sum of leaves) — parentheses with a factor.
 * Func terms are (num/den) · fn(sum of leaves) — sin/cos/tan/ln/exp wrappers.
 */

/** Any integer power of the variable — x⁻³ … x⁰ … x⁷ all welcome */
export type Power = number;

/** A mathematical identifier. The legacy renderer used to restrict this to
 * x/y; the canonical tree and symbol book accept any parser-safe name. */
export type Variable = string;

/** The variable a powered leaf refers to; constants default to x (irrelevant) */
export const varOf = (l: { variable?: Variable }): Variable => l.variable ?? "x";

export interface LeafTerm {
  id: string;
  kind: "leaf";
  num: number;
  den: number;
  power: Power;
  /** which symbol the power applies to; omitted means x */
  variable?: Variable;
  /** Result of a square root: shown with a ± prefix (both roots kept) */
  pm?: boolean;
  /** A chosen negative branch of a terminal value: −√5, −arcsin(…) */
  neg?: boolean;
  /** num/den is a radicand: the value is √(num/den), display-only */
  radical?: boolean;
  /** An inverse-function value: fnVal applied to num/den (e.g. arcsin(1/2)), display-only */
  fnVal?: string;
}

export interface GroupTerm {
  id: string;
  kind: "group";
  num: number; // the factor's numerator (signed)
  den: number; // the factor's denominator
  inner: EqTerm[];
}

export type FuncName = "sin" | "cos" | "tan" | "ln" | "exp";

/** A function wrapped around an argument, with a rational coefficient: a·fn(inner).
 *  The argument is a full sum of terms — functions and parentheses nest. */
export interface FuncTerm {
  id: string;
  kind: "func";
  num: number;
  den: number;
  fn: FuncName;
  inner: EqTerm[];
}

export type EqTerm = LeafTerm | GroupTerm | FuncTerm;

export type Side = "left" | "right";

export const opposite = (side: Side): Side => (side === "left" ? "right" : "left");

export interface EquationState {
  left: EqTerm[];
  right: EqTerm[];
}

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function reduce(num: number, den: number): { num: number; den: number } {
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(Math.abs(num), den) || 1;
  return { num: num / g, den: den / g };
}

let termCounter = 0;
export const leaf = (num: number, power: Power = 0, den = 1, variable?: Variable): LeafTerm => ({
  id: `t${termCounter++}`,
  kind: "leaf",
  ...reduce(num, den),
  power,
  ...(variable && variable !== "x" ? { variable } : {}),
});
/** Deep copy with fresh ids, preserving terminal flags */
export const reTerm = (t: EqTerm): EqTerm =>
  t.kind === "leaf"
    ? {
        ...leaf(t.num, t.power, t.den, varOf(t)),
        ...(t.pm ? { pm: true } : {}),
        ...(t.radical ? { radical: true } : {}),
        ...(t.fnVal ? { fnVal: t.fnVal } : {}),
        ...(t.neg ? { neg: true } : {}),
      }
    : t.kind === "group"
      ? group(t.num, t.inner, t.den)
      : func(t.fn, t.num, t.inner, t.den);
export const group = (num: number, inner: EqTerm[], den = 1): GroupTerm => ({
  id: `t${termCounter++}`,
  kind: "group",
  ...reduce(num, den),
  inner: inner.map(reTerm),
});
export const func = (fn: FuncName, num: number, inner: EqTerm[], den = 1): FuncTerm => ({
  id: `t${termCounter++}`,
  kind: "func",
  ...reduce(num, den),
  fn,
  inner: inner.map(reTerm),
});

// Scale a term's value: identical on leaves and group/function coefficients.
// Terminal leaves (±/√/arc values) hold a VALUE in num/den, not a coefficient:
// only sign flips are meaningful — ± absorbs them, others toggle `neg`.
// IDENTITY: scaling is a 1:1 mutation of a SURVIVING term, so the id is
// preserved — the animation layer keys on it to move the term, not remint it.
export const scaleNum = (t: EqTerm, k: number): EqTerm => {
  if (t.kind === "leaf" && (t.pm || t.radical || t.fnVal)) {
    if (k === 1) return { ...t };
    if (k === -1) return t.pm ? { ...t } : { ...t, neg: !t.neg };
    return { ...t }; // guarded upstream; never scale a frozen value silently
  }
  return t.kind === "leaf"
    ? { ...t, ...reduce(t.num * k, t.den) }
    : { ...t, ...reduce(t.num * k, t.den), inner: t.inner.map(cloneTerm) };
};
export const scaleDen = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf"
    ? { ...t, ...reduce(t.num, t.den * k) }
    : { ...t, ...reduce(t.num, t.den * k), inner: t.inner.map(cloneTerm) };

export const cloneTerm = (t: EqTerm): EqTerm =>
  t.kind === "leaf" ? { ...t } : { ...t, inner: t.inner.map(cloneTerm) };

export const cloneState = (state: EquationState): EquationState => ({
  left: state.left.map(cloneTerm),
  right: state.right.map(cloneTerm),
});

/**
 * Normalize a side: unwrap groups whose factor became 1, drop zero terms,
 * and merge like leaf terms (grouped by power) with exact rational arithmetic.
 * Groups/functions and terminal values pass through — those are the player's moves.
 *
 * IDENTITY: every surviving term keeps its id. A merge bucket keeps the id of
 * its FIRST contributor — list order puts residents before arrivals, so the
 * resident is the sink the animation layer merges the movers into. Only a
 * genuinely born term (the lone 0 of an emptied side) mints a fresh id.
 */
export function combine(terms: EqTerm[]): EqTerm[] {
  const passthrough: EqTerm[] = [];
  const leaves: LeafTerm[] = [];
  const consume = (t: EqTerm) => {
    if (t.kind === "group") {
      if (t.num === 0) return;
      if (t.num === 1 && t.den === 1) t.inner.forEach((i) => consume(cloneTerm(i)));
      else passthrough.push({ ...t, ...reduce(t.num, t.den), inner: t.inner.map(cloneTerm) });
    } else if (t.kind === "func") {
      if (t.num !== 0) passthrough.push({ ...t, ...reduce(t.num, t.den), inner: t.inner.map(cloneTerm) });
    } else if (t.pm || t.radical || t.fnVal) {
      passthrough.push({ ...t }); // terminal values never merge
    } else {
      leaves.push(t);
    }
  };
  terms.forEach(consume);
  const sum = (list: LeafTerm[]) =>
    list.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const merged: LeafTerm[] = [];
  const bucket = (list: LeafTerm[], power: Power, variable?: Variable) => {
    if (!list.length) return;
    const s = sum(list);
    if (s.num !== 0) merged.push({ ...leaf(s.num, power, s.den, variable), id: list[0].id });
  };
  // like terms merge per variable and power; constants merge regardless of variable
  const variables = Array.from(new Set(leaves.filter((term) => term.power !== 0).map(varOf))).sort((a, b) =>
    a === "y" ? -1 : b === "y" ? 1 : a === "x" ? -1 : b === "x" ? 1 : a.localeCompare(b)
  );
  for (const variable of variables) {
    const powers = Array.from(
      new Set(leaves.filter((t) => t.power !== 0 && varOf(t) === variable).map((t) => t.power))
    ).sort((a, b) => b - a);
    for (const power of powers) {
      bucket(leaves.filter((t) => t.power === power && varOf(t) === variable), power, variable);
    }
  }
  bucket(leaves.filter((t) => t.power === 0), 0);
  const result: EqTerm[] = [...passthrough, ...merged];
  if (result.length === 0) result.push(leaf(0));
  return result;
}
