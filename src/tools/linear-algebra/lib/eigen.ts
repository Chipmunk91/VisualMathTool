/**
 * Real eigenvector extraction — the directions that only stretch, never turn.
 * Complex pairs don't give a drawable axis, but they aren't nothing: they are
 * the map's rotation, and complexRotation() recovers the invariant plane it
 * spins so the scene can show that instead of a silent blank.
 */
import { eigs } from "mathjs";
import { apply, entryIndex, isIdentity, type Mat3, type Vec3 } from "./mat3";

export interface EigenAxis {
  value: number;
  dir: Vec3; // unit length, canonical sign
}

/** A complex eigen-pair λ = re ± im·i, seen as rotate-and-scale of a plane */
export interface ComplexRotation {
  re: number;
  im: number; // > 0 by construction
  /** |λ| — how lengths in the plane scale per application */
  scale: number;
  /** signed rotation per application (radians), sign = direction in the u,w frame */
  angle: number;
  /** orthonormal basis of the invariant plane */
  u: Vec3;
  w: Vec3;
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Assemble the rotation record once the invariant plane's raw span is known */
function planeRotation(m: Mat3, re: number, im: number, p: Vec3, q: Vec3): ComplexRotation | null {
  const pl = Math.hypot(p[0], p[1], p[2]);
  if (!isFinite(pl) || pl < 1e-9) return null;
  const u: Vec3 = [p[0] / pl, p[1] / pl, p[2] / pl];
  const qu = dot3(q, u);
  const w0: Vec3 = [q[0] - qu * u[0], q[1] - qu * u[1], q[2] - qu * u[2]];
  const wl = Math.hypot(w0[0], w0[1], w0[2]);
  if (!isFinite(wl) || wl < 1e-9) return null; // degenerate span — effectively real
  const w: Vec3 = [w0[0] / wl, w0[1] / wl, w0[2] / wl];
  // the true turn magnitude is arg λ; its direction in the (u, w) frame comes
  // from where the map actually sends u
  const s = apply(m, u);
  const spin = Math.atan2(dot3(s, w), dot3(s, u)) >= 0 ? 1 : -1;
  return { re, im, scale: Math.hypot(re, im), angle: spin * Math.atan2(im, re), u, w };
}

/** The complex pair of a 2×2 map — the whole plane rotates (closed form) */
export function complexRotation2(m: Mat3): ComplexRotation | null {
  const a = m[entryIndex(0, 0)];
  const b = m[entryIndex(0, 1)];
  const c = m[entryIndex(1, 0)];
  const d = m[entryIndex(1, 1)];
  const tr = a + d;
  const disc = tr * tr - 4 * (a * d - b * c);
  if (disc >= -1e-12) return null;
  return planeRotation(m, tr / 2, Math.sqrt(-disc) / 2, [1, 0, 0], [0, 1, 0]);
}

/** The complex pair of a 3×3 map, with its invariant plane span{Re v, Im v} */
export function complexRotation3(m: Mat3): ComplexRotation | null {
  const rows = [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
  try {
    const result = eigs(rows) as { eigenvectors?: { value: unknown; vector: unknown }[] };
    for (const entry of result.eigenvectors ?? []) {
      const raw = entry.value as number | { re: number; im: number };
      if (typeof raw === "number" || !isFinite(raw.re) || raw.im <= 1e-9) continue;
      const vecRaw = entry.vector as { toArray?: () => unknown[] } | unknown[];
      const comps = (Array.isArray(vecRaw) ? vecRaw : vecRaw.toArray!()) as (
        | number
        | { re: number; im: number }
      )[];
      const p = comps.map((x) => (typeof x === "number" ? x : x.re)) as Vec3;
      const q = comps.map((x) => (typeof x === "number" ? 0 : x.im)) as Vec3;
      const rot = planeRotation(m, raw.re, raw.im, p, q);
      if (rot) return rot;
    }
    return null;
  } catch {
    return null;
  }
}

export function realEigenAxes(m: Mat3): EigenAxis[] {
  if (isIdentity(m)) return [];
  const rows = [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
  try {
    const result = eigs(rows) as { eigenvectors?: { value: unknown; vector: unknown }[] };
    const out: EigenAxis[] = [];
    for (const entry of result.eigenvectors ?? []) {
      const raw = entry.value as number | { re: number; im: number };
      const value = typeof raw === "number" ? raw : raw.re;
      const im = typeof raw === "number" ? 0 : raw.im;
      if (!isFinite(value) || Math.abs(im) > 1e-9) continue;
      const vecRaw = entry.vector as { toArray?: () => unknown[] } | unknown[];
      const comps = (Array.isArray(vecRaw) ? vecRaw : vecRaw.toArray!()) as (
        | number
        | { re: number; im: number }
      )[];
      if (comps.some((c) => typeof c !== "number" && Math.abs(c.im) > 1e-9)) continue;
      const v = comps.map((c) => (typeof c === "number" ? c : c.re));
      const len = Math.hypot(v[0], v[1], v[2]);
      if (!isFinite(len) || len < 1e-9) continue;
      let dir: Vec3 = [v[0] / len, v[1] / len, v[2] / len];
      const biggest = dir.reduce((p, c, i, arr) => (Math.abs(c) > Math.abs(arr[p]) ? i : p), 0);
      if (dir[biggest] < 0) dir = [-dir[0], -dir[1], -dir[2]];
      // collinear with one we already have → same axis, skip
      const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (out.some((e) => Math.abs(dot(e.dir, dir)) > 0.9999)) continue;
      out.push({ value, dir });
    }
    return out;
  } catch {
    return []; // defective / non-convergent matrices simply show no axes
  }
}

/** Closed-form 2×2 eigen for the plane case — axes live in z = 0. */
export function realEigenAxes2(m: Mat3): EigenAxis[] {
  const a = m[entryIndex(0, 0)];
  const b = m[entryIndex(0, 1)];
  const c = m[entryIndex(1, 0)];
  const d = m[entryIndex(1, 1)];
  if (Math.abs(a - 1) < 1e-9 && Math.abs(d - 1) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9) return [];
  const tr = a + d;
  const det2 = a * d - b * c;
  const disc = tr * tr - 4 * det2;
  if (disc < -1e-12) return []; // complex pair — pure rotation-like, nothing to draw
  const sq = Math.sqrt(Math.max(0, disc));
  const out: EigenAxis[] = [];
  for (const value of [(tr + sq) / 2, (tr - sq) / 2]) {
    let dx: number;
    let dy: number;
    if (Math.abs(b) > 1e-9) {
      dx = b;
      dy = value - a;
    } else if (Math.abs(c) > 1e-9) {
      dx = value - d;
      dy = c;
    } else {
      // diagonal matrix: eigenvectors are the axes themselves
      if (Math.abs(a - value) < 1e-9) [dx, dy] = [1, 0];
      else [dx, dy] = [0, 1];
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    let dir: Vec3 = [dx / len, dy / len, 0];
    if ((Math.abs(dir[0]) >= Math.abs(dir[1]) ? dir[0] : dir[1]) < 0) dir = [-dir[0], -dir[1], 0];
    const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1];
    if (out.some((e) => Math.abs(dot(e.dir, dir)) > 0.9999)) continue;
    out.push({ value, dir });
  }
  return out;
}
