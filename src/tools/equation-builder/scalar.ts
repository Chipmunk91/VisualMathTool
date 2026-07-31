/**
 * Serializable scalar values for the equation engine.
 *
 * Do not put mathjs `Complex` instances (or any other class instance) in the
 * equation document/protocol.  These plain tagged objects survive JSON,
 * sharing, worker boundaries, and MCP without a custom reviver.
 */
export type ScalarRealm = "real" | "complex";

export type ScalarValue =
  | { kind: "real"; value: number }
  | { kind: "complex"; re: number; im: number };

export type ScalarEvalErrorCode =
  | "unbound_symbol"
  | "undefined"
  | "symbolic_operator";

export type EvalResult =
  | {
      ok: true;
      value: ScalarValue;
      /** Realm needed to perform the evaluation, not necessarily the result's carrier. */
      realm: ScalarRealm;
      /** True when real evaluation failed and principal-complex evaluation succeeded. */
      usedComplexFallback: boolean;
    }
  | {
      ok: false;
      code: ScalarEvalErrorCode;
      message: string;
    };

export type ScalarInput = number | ScalarValue;
export type ScalarEnvironment = Readonly<Record<string, ScalarInput | undefined>>;

const EPSILON = 1e-12;

const clean = (value: number): number => {
  if (Object.is(value, -0)) return 0;
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= EPSILON
    ? rounded
    : value;
};

export const realScalar = (value: number): ScalarValue => ({
  kind: "real",
  value: clean(value),
});

/**
 * Canonicalize a numerically real result back to the real carrier.  The
 * evaluation result separately records whether complex arithmetic was needed.
 */
export const complexScalar = (re: number, im: number): ScalarValue =>
  Math.abs(im) <= EPSILON
    ? realScalar(re)
    : { kind: "complex", re: clean(re), im: clean(im) };

export const isFiniteScalar = (value: ScalarValue): boolean =>
  value.kind === "real"
    ? Number.isFinite(value.value)
    : Number.isFinite(value.re) && Number.isFinite(value.im);

export const scalarParts = (value: ScalarValue): { re: number; im: number } =>
  value.kind === "real"
    ? { re: value.value, im: 0 }
    : { re: value.re, im: value.im };

export const scalarFromInput = (value: ScalarInput): ScalarValue =>
  typeof value === "number" ? realScalar(value) : value;

export const scalarIsZero = (value: ScalarValue): boolean => {
  const { re, im } = scalarParts(value);
  return re === 0 && im === 0;
};

export const scalarAdd = (left: ScalarValue, right: ScalarValue): ScalarValue => {
  const a = scalarParts(left);
  const b = scalarParts(right);
  return complexScalar(a.re + b.re, a.im + b.im);
};

export const scalarMultiply = (left: ScalarValue, right: ScalarValue): ScalarValue => {
  const a = scalarParts(left);
  const b = scalarParts(right);
  return complexScalar(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
};

export const scalarDivide = (left: ScalarValue, right: ScalarValue): ScalarValue | null => {
  const a = scalarParts(left);
  const b = scalarParts(right);
  const denominator = b.re * b.re + b.im * b.im;
  if (denominator === 0) return null;
  return complexScalar(
    (a.re * b.re + a.im * b.im) / denominator,
    (a.im * b.re - a.re * b.im) / denominator
  );
};

export const scalarExp = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  const magnitude = Math.exp(re);
  return complexScalar(magnitude * Math.cos(im), magnitude * Math.sin(im));
};

/** Principal logarithm, with argument in (−π, π]. */
export const scalarLog = (value: ScalarValue): ScalarValue | null => {
  const { re, im } = scalarParts(value);
  if (re === 0 && im === 0) return null;
  return complexScalar(Math.log(Math.hypot(re, im)), Math.atan2(im, re));
};

/** Principal square root: the root with non-negative real part. */
export const scalarSqrt = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  if (im === 0) {
    if (re >= 0) return realScalar(Math.sqrt(re));
    return complexScalar(0, Math.sqrt(-re));
  }
  const magnitude = Math.hypot(re, im);
  const rootRe = Math.sqrt(Math.max(0, (magnitude + re) / 2));
  const rootIm = Math.sign(im) * Math.sqrt(Math.max(0, (magnitude - re) / 2));
  return complexScalar(rootRe, rootIm);
};

/**
 * Principal complex power, z^w = exp(w Log(z)).  Integer powers are handled
 * separately so zero and exact real/imaginary cycles retain their usual
 * algebraic meaning without consulting a logarithm.
 */
export const scalarPower = (base: ScalarValue, exponent: ScalarValue): ScalarValue | null => {
  const z = scalarParts(base);
  const w = scalarParts(exponent);

  if (w.im === 0 && Number.isInteger(w.re)) {
    if (w.re === 0) return realScalar(1);
    if (z.re === 0 && z.im === 0 && w.re < 0) return null;
    let result = realScalar(1);
    let factor = base;
    let power = Math.abs(w.re);
    while (power > 0) {
      if (power % 2 === 1) result = scalarMultiply(result, factor);
      power = Math.floor(power / 2);
      if (power > 0) factor = scalarMultiply(factor, factor);
    }
    return w.re < 0 ? scalarDivide(realScalar(1), result) : result;
  }

  if (z.re === 0 && z.im === 0) {
    if (w.im === 0 && w.re > 0) return realScalar(0);
    return null;
  }
  const logarithm = scalarLog(base);
  return logarithm ? scalarExp(scalarMultiply(exponent, logarithm)) : null;
};

export const scalarSin = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  return complexScalar(Math.sin(re) * Math.cosh(im), Math.cos(re) * Math.sinh(im));
};

export const scalarCos = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  return complexScalar(Math.cos(re) * Math.cosh(im), -Math.sin(re) * Math.sinh(im));
};

export const scalarTan = (value: ScalarValue): ScalarValue | null =>
  scalarDivide(scalarSin(value), scalarCos(value));

export const scalarAsin = (value: ScalarValue): ScalarValue | null => {
  // asin(z) = -i Log(iz + sqrt(1-z²))
  const i = complexScalar(0, 1);
  const zSquared = scalarMultiply(value, value);
  const radicand = scalarAdd(realScalar(1), scalarMultiply(realScalar(-1), zSquared));
  const inside = scalarAdd(scalarMultiply(i, value), scalarSqrt(radicand));
  const logarithm = scalarLog(inside);
  return logarithm ? scalarMultiply(complexScalar(0, -1), logarithm) : null;
};

export const scalarAcos = (value: ScalarValue): ScalarValue | null => {
  const asin = scalarAsin(value);
  return asin
    ? scalarAdd(realScalar(Math.PI / 2), scalarMultiply(realScalar(-1), asin))
    : null;
};

export const scalarAtan = (value: ScalarValue): ScalarValue | null => {
  // atan(z) = i/2 [Log(1-iz) - Log(1+iz)]
  const iz = scalarMultiply(complexScalar(0, 1), value);
  const oneMinus = scalarAdd(realScalar(1), scalarMultiply(realScalar(-1), iz));
  const onePlus = scalarAdd(realScalar(1), iz);
  const left = scalarLog(oneMinus);
  const right = scalarLog(onePlus);
  if (!left || !right) return null;
  return scalarMultiply(
    complexScalar(0, 0.5),
    scalarAdd(left, scalarMultiply(realScalar(-1), right))
  );
};

export const scalarRealPart = (value: ScalarValue): ScalarValue =>
  realScalar(scalarParts(value).re);

export const scalarImaginaryPart = (value: ScalarValue): ScalarValue =>
  realScalar(scalarParts(value).im);

export const scalarConjugate = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  return complexScalar(re, -im);
};

export const scalarAbs = (value: ScalarValue): ScalarValue => {
  const { re, im } = scalarParts(value);
  return realScalar(Math.hypot(re, im));
};

export const scalarArg = (value: ScalarValue): ScalarValue | null => {
  const { re, im } = scalarParts(value);
  return re === 0 && im === 0 ? null : realScalar(Math.atan2(im, re));
};
