/**
 * The equation playground's term model.
 * Leaf terms are (num/den) · x^power with den > 0, reduced.
 * Group terms are (num/den) · (sum of leaves) — parentheses with a factor.
 * Func terms are (num/den) · fn(sum of leaves) — sin/cos/tan/ln/exp wrappers.
 */

export type Power = -1 | 0 | 1 | 2;

export interface LeafTerm {
  id: string;
  kind: "leaf";
  num: number;
  den: number;
  power: Power;
  /** Result of a square root: shown with a ± prefix (both roots kept) */
  pm?: boolean;
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
  inner: LeafTerm[];
}

export type FuncName = "sin" | "cos" | "tan" | "ln" | "exp";

/** A function wrapped around an argument, with a rational coefficient: a·fn(inner) */
export interface FuncTerm {
  id: string;
  kind: "func";
  num: number;
  den: number;
  fn: FuncName;
  inner: LeafTerm[];
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
export const leaf = (num: number, power: Power = 0, den = 1): LeafTerm => ({
  id: `t${termCounter++}`,
  kind: "leaf",
  ...reduce(num, den),
  power,
});
export const group = (num: number, inner: LeafTerm[], den = 1): GroupTerm => ({
  id: `t${termCounter++}`,
  kind: "group",
  ...reduce(num, den),
  inner: inner.map((l) => leaf(l.num, l.power, l.den)),
});
export const func = (fn: FuncName, num: number, inner: LeafTerm[], den = 1): FuncTerm => ({
  id: `t${termCounter++}`,
  kind: "func",
  ...reduce(num, den),
  fn,
  inner: inner.map((l) => leaf(l.num, l.power, l.den)),
});

// Scale a term's value: identical on leaves and group/function coefficients
export const scaleNum = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf"
    ? leaf(t.num * k, t.power, t.den)
    : t.kind === "group"
      ? group(t.num * k, t.inner, t.den)
      : func(t.fn, t.num * k, t.inner, t.den);
export const scaleDen = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf"
    ? leaf(t.num, t.power, t.den * k)
    : t.kind === "group"
      ? group(t.num, t.inner, t.den * k)
      : func(t.fn, t.num, t.inner, t.den * k);

export const cloneTerm = (t: EqTerm): EqTerm =>
  t.kind === "leaf" ? { ...t } : { ...t, inner: t.inner.map((l) => ({ ...l })) };

export const cloneState = (state: EquationState): EquationState => ({
  left: state.left.map(cloneTerm),
  right: state.right.map(cloneTerm),
});

/**
 * Normalize a side: unwrap groups whose factor became 1, drop zero terms,
 * and merge like leaf terms (grouped by power) with exact rational arithmetic.
 * Groups/functions and terminal values pass through — those are the player's moves.
 */
export function combine(terms: EqTerm[]): EqTerm[] {
  const passthrough: EqTerm[] = [];
  const leaves: LeafTerm[] = [];
  for (const t of terms) {
    if (t.kind === "group") {
      if (t.num === 0) continue;
      if (t.num === 1 && t.den === 1) leaves.push(...t.inner.map((l) => leaf(l.num, l.power, l.den)));
      else passthrough.push(group(t.num, t.inner, t.den));
    } else if (t.kind === "func") {
      if (t.num !== 0) passthrough.push(func(t.fn, t.num, t.inner, t.den));
    } else if (t.pm || t.radical || t.fnVal) {
      passthrough.push({ ...t }); // terminal values never merge
    } else {
      leaves.push(t);
    }
  }
  const sum = (list: LeafTerm[]) =>
    list.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const merged: LeafTerm[] = [];
  for (const power of [2, 1, 0, -1] as Power[]) {
    const s = sum(leaves.filter((t) => t.power === power));
    if (s.num !== 0) merged.push(leaf(s.num, power, s.den));
  }
  const result: EqTerm[] = [...passthrough, ...merged];
  if (result.length === 0) result.push(leaf(0));
  return result;
}
