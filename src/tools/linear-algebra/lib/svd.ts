/**
 * SVD as a story: every matrix is rotate (Vᵀ), then stretch along axes (Σ),
 * then rotate again (U). Computed from the eigendecomposition of AᵀA; V and
 * U are forced to be proper rotations, with any reflection pushed into Σ as
 * a negative singular value (an honest "stretch with a flip").
 */
import { eigs } from "mathjs";
import { apply, matMul, matTranspose, type Dim, type Mat3, type Vec3 } from "./mat3";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export interface SvdResult {
  /** stages in application order: rotate, stretch, rotate */
  Vt: Mat3;
  S: Mat3;
  U: Mat3;
  sigmas: number[];
}

/** Symmetric eigenpairs of AᵀA, largest first, as unit vectors */
function symmetricEigenpairs(S: Mat3, dim: Dim): { lam: number; v: Vec3 }[] | null {
  if (dim === 2) {
    const a = S[0];
    const b = S[3]; // = S[1] by symmetry
    const d = S[4];
    const mean = (a + d) / 2;
    const half = Math.sqrt(((a - d) / 2) ** 2 + b * b);
    const pairs: { lam: number; v: Vec3 }[] = [];
    for (const lam of [mean + half, mean - half]) {
      let v: Vec3;
      if (Math.abs(b) > 1e-12) v = [b, lam - a, 0];
      else v = Math.abs(a - lam) < Math.abs(d - lam) ? [1, 0, 0] : [0, 1, 0];
      const n = norm(v);
      if (n < 1e-12) return null;
      pairs.push({ lam, v: scale(v, 1 / n) });
    }
    return pairs;
  }
  try {
    const rows = [
      [S[0], S[3], S[6]],
      [S[1], S[4], S[7]],
      [S[2], S[5], S[8]],
    ];
    const res = eigs(rows) as { eigenvectors?: { value: unknown; vector: unknown }[] };
    const pairs: { lam: number; v: Vec3 }[] = [];
    for (const e of res.eigenvectors ?? []) {
      const raw = e.value as number | { re: number; im: number };
      const lam = typeof raw === "number" ? raw : raw.re;
      const vecRaw = e.vector as { toArray?: () => unknown[] } | unknown[];
      const comps = (Array.isArray(vecRaw) ? vecRaw : vecRaw.toArray!()) as (
        | number
        | { re: number }
      )[];
      const v = comps.map((c) => (typeof c === "number" ? c : c.re)) as Vec3;
      if (!isFinite(lam) || v.some((c) => !isFinite(c))) return null;
      pairs.push({ lam, v });
    }
    return pairs.length === 3 ? pairs : null;
  } catch {
    return null;
  }
}

export function svd(m: Mat3, dim: Dim): SvdResult | null {
  const S = matMul(matTranspose(m), m); // AᵀA — symmetric, PSD
  const pairs = symmetricEigenpairs(S, dim);
  if (!pairs) return null;
  pairs.sort((x, y) => y.lam - x.lam);

  // Right singular vectors: orthonormalize for safety (repeated eigenvalues)
  const vs: Vec3[] = [];
  for (const p of pairs) {
    let v = [...p.v] as Vec3;
    for (const q of vs) v = sub(v, scale(q, dot(v, q)));
    const n = norm(v);
    if (n < 1e-8) continue;
    vs.push(scale(v, 1 / n));
    if (vs.length === dim) break;
  }
  if (vs.length < dim) return null;
  const sigmas = pairs.slice(0, dim).map((p) => Math.sqrt(Math.max(0, p.lam)));

  // V must be a proper rotation
  if (dim === 3) {
    if (dot(cross(vs[0], vs[1]), vs[2]) < 0) vs[2] = scale(vs[2], -1);
  } else {
    if (vs[0][0] * vs[1][1] - vs[0][1] * vs[1][0] < 0) vs[1] = scale(vs[1], -1);
  }

  // Left singular vectors: u = Av/σ, completed orthonormally where σ = 0
  const us: (Vec3 | null)[] = vs.map((v, i) =>
    sigmas[i] > 1e-8 ? scale(apply(m, v), 1 / sigmas[i]) : null
  );
  const candidates: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < dim; i++) {
    if (us[i]) continue;
    for (const cand of candidates) {
      let u = [...cand] as Vec3;
      if (dim === 2) u[2] = 0;
      for (let j = 0; j < dim; j++) {
        const q = us[j];
        if (q && j !== i) u = sub(u, scale(q, dot(u, q)));
      }
      if (dim === 2) u[2] = 0;
      const n = norm(u);
      if (n > 1e-6) {
        us[i] = scale(u, 1 / n);
        break;
      }
    }
    if (!us[i]) return null;
  }
  const uu = us as Vec3[];

  // U must be a proper rotation too — push any reflection into Σ
  const detU =
    dim === 3 ? dot(cross(uu[0], uu[1]), uu[2]) : uu[0][0] * uu[1][1] - uu[0][1] * uu[1][0];
  if (detU < 0) {
    uu[dim - 1] = scale(uu[dim - 1], -1);
    sigmas[dim - 1] = -sigmas[dim - 1];
  }

  const colsToMat = (cols: Vec3[]): Mat3 => {
    const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    cols.forEach((c, i) => {
      out[3 * i] = c[0];
      out[3 * i + 1] = c[1];
      out[3 * i + 2] = c[2];
    });
    return out;
  };
  const V = colsToMat(dim === 3 ? vs : [...vs, [0, 0, 0]]);
  const U = colsToMat(dim === 3 ? uu : [...uu, [0, 0, 0]]);
  const Sm: Mat3 = [sigmas[0], 0, 0, 0, sigmas[1], 0, 0, 0, dim === 3 ? sigmas[2] : 0];
  const Vt = matTranspose(V);

  // Honesty check: U·Σ·Vᵀ must reproduce A
  const rebuilt = matMul(U, matMul(Sm, Vt));
  const ok = rebuilt.every((v, i) => Math.abs(v - m[i]) < 1e-6);
  return ok ? { Vt, S: Sm, U, sigmas } : null;
}
