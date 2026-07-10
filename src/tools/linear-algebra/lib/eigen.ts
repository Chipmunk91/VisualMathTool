/**
 * Real eigenvector extraction — the directions that only stretch, never turn.
 * Complex pairs (rotation) are silently skipped; those directions don't exist
 * to draw.
 */
import { eigs } from "mathjs";
import { isIdentity, type Mat3, type Vec3 } from "./mat3";

export interface EigenAxis {
  value: number;
  dir: Vec3; // unit length, canonical sign
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
