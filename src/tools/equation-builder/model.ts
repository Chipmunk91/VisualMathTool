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
