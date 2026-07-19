/**
 * The graph pane — part of the playground's "open world": it stays hidden
 * for constant/linear equations and appears only once a function enters the
 * equation. Each side is plotted as a function of x; the solutions are
 * literally the intersections, and every committed move re-shapes the curves.
 */
import { useEffect, useMemo, useState } from "react";
import type { EqTerm, EquationState, LeafTerm } from "./model";

const FN: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  exp: Math.exp,
};

const evalLeaf = (l: LeafTerm, x: number): number => {
  let v = l.num / l.den;
  if (l.radical) v = Math.sqrt(v);
  else if (l.fnVal) {
    const a = l.num / l.den;
    v =
      l.fnVal === "arcsin"
        ? Math.asin(a)
        : l.fnVal === "arccos"
          ? Math.acos(a)
          : l.fnVal === "arctan"
            ? Math.atan(a)
            : l.fnVal === "e^"
              ? Math.exp(a)
              : Math.log(a);
  }
  if (l.neg) v = -v; // a chosen negative branch
  // ± values plot their principal (+) branch
  return v * Math.pow(x, l.power);
};

const evalTerm = (t: EqTerm, x: number): number => {
  if (t.kind === "leaf") return evalLeaf(t, x);
  const inner = t.inner.reduce((acc, l) => acc + evalTerm(l, x), 0);
  const coef = t.num / t.den;
  return t.kind === "group" ? coef * inner : coef * FN[t.fn](inner);
};

export const evalSide = (terms: EqTerm[], x: number): number =>
  terms.reduce((acc, t) => acc + evalTerm(t, x), 0);

/** Does this equation deserve a graph? Anything beyond constant/linear terms. */
export const isFunctionEquation = ({ left, right }: EquationState): boolean => {
  const nonlinear = (t: EqTerm): boolean =>
    t.kind === "func" ||
    (t.kind === "leaf" ? t.power !== 0 && t.power !== 1 : t.inner.some(nonlinear));
  return [...left, ...right].some(nonlinear);
};

const W = 680;
const H = 260;
const PAD = 10;
const X_MIN = -7;
const X_MAX = 7;
const SAMPLES = 281;

interface Curve {
  paths: string[];
}

const fmt = (v: number): string => {
  const r = Math.round(v);
  const text = Math.abs(v - r) < 1e-6 ? String(r) : v.toFixed(2).replace(/\.?0+$/, "");
  return text.replace("-", "−");
};

/** Flat-model wrapper: plot both sides of an EquationState */
export function GraphPane({ left, right }: EquationState) {
  return (
    <GraphView
      fl={(x) => evalSide(left, x)}
      fr={(x) => evalSide(right, x)}
      depKey={JSON.stringify([left, right])}
      inputVar="x"
    />
  );
}

/** The pane itself, over two plain evaluators — tree equations plot here too */
export function GraphView({
  fl,
  fr,
  depKey,
  inputVar,
}: {
  fl: (x: number) => number;
  fr: (x: number) => number;
  depKey: string;
  inputVar: string;
}) {
  // Fade in on first mount — the "something new appeared" moment
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const plot = useMemo(() => {
    const xs: number[] = [];
    for (let i = 0; i < SAMPLES; i++) xs.push(X_MIN + ((X_MAX - X_MIN) * i) / (SAMPLES - 1));
    const ls = xs.map(fl);
    const rs = xs.map(fr);

    // Intersections: sign changes of (L − R), refined by bisection
    const roots: { x: number; y: number }[] = [];
    for (let i = 1; i < SAMPLES; i++) {
      const d0 = ls[i - 1] - rs[i - 1];
      const d1 = ls[i] - rs[i];
      if (!isFinite(d0) || !isFinite(d1)) continue;
      if (d0 === 0) {
        roots.push({ x: xs[i - 1], y: ls[i - 1] });
        continue;
      }
      if (d0 * d1 < 0) {
        let a = xs[i - 1];
        let b = xs[i];
        let fa = d0;
        for (let k = 0; k < 40; k++) {
          const m = (a + b) / 2;
          const fm = fl(m) - fr(m);
          if (!isFinite(fm)) break;
          if (fa * fm <= 0) b = m;
          else {
            a = m;
            fa = fm;
          }
        }
        const rx = (a + b) / 2;
        // A genuine crossing stays small at the midpoint; a tan-style pole does not
        if (Math.abs(fl(rx) - fr(rx)) < 0.5) {
          roots.push({ x: rx, y: fl(rx) });
        }
      }
    }
    const dedup = roots.filter((r, i) => i === 0 || Math.abs(r.x - roots[i - 1].x) > 1e-3);

    // Y window: robust range of both curves (clipping tan-style blowups), plus 0 and the roots
    const vals = [...ls, ...rs].filter((v) => isFinite(v) && Math.abs(v) < 1e6).sort((a, b) => a - b);
    let lo = vals.length ? vals[Math.floor(vals.length * 0.03)] : -5;
    let hi = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.97))] : 5;
    lo = Math.min(lo, 0, ...dedup.map((r) => r.y));
    hi = Math.max(hi, 0, ...dedup.map((r) => r.y));
    if (hi - lo < 4) {
      const mid = (hi + lo) / 2;
      lo = mid - 2;
      hi = mid + 2;
    }
    const padY = (hi - lo) * 0.12;
    lo -= padY;
    hi += padY;

    const px = (x: number) => PAD + ((x - X_MIN) / (X_MAX - X_MIN)) * (W - 2 * PAD);
    const py = (y: number) => H - PAD - ((y - lo) / (hi - lo)) * (H - 2 * PAD);

    // Build each curve as segments, breaking at gaps/poles
    const toCurve = (ys: number[]): Curve => {
      const margin = (hi - lo) * 1.5;
      const paths: string[] = [];
      let seg: string[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const y = ys[i];
        const ok = isFinite(y) && y > lo - margin && y < hi + margin;
        const jump = i > 0 && isFinite(ys[i - 1]) && Math.abs(y - ys[i - 1]) > margin;
        if (ok && !jump) {
          seg.push(`${seg.length ? "L" : "M"}${px(xs[i]).toFixed(1)} ${py(y).toFixed(1)}`);
        } else {
          if (seg.length > 1) paths.push(seg.join(""));
          seg = ok ? [`M${px(xs[i]).toFixed(1)} ${py(y).toFixed(1)}`] : [];
        }
      }
      if (seg.length > 1) paths.push(seg.join(""));
      return { paths };
    };

    // Nice y-axis tick step: 1/2/5 · 10^k giving ~4 labels
    const rawStep = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => (hi - lo) / s <= 5) ?? 10 * mag;
    const yTicks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      if (Math.abs(v) > step / 100) yTicks.push(v);
    }

    return { curveL: toCurve(ls), curveR: toCurve(rs), roots: dedup, lo, hi, px, py, yTicks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const { curveL, curveR, roots, lo, hi, px, py, yTicks } = plot;
  const y0 = py(0);
  const x0 = px(0);

  return (
    <div
      className={`mt-10 flex flex-col items-center gap-1.5 transition-opacity duration-700 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      data-ui
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-[min(680px,85vw)]"
        role="img"
        aria-label={`Both sides of the equation plotted against ${inputVar}`}
      >
        <defs>
          <clipPath id="graph-clip">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx={6} />
          </clipPath>
        </defs>
        {/* axes */}
        {0 >= lo && 0 <= hi && (
          <line x1={PAD} y1={y0} x2={W - PAD} y2={y0} className="stroke-muted-foreground/30" strokeWidth="1" />
        )}
        <line x1={x0} y1={PAD} x2={x0} y2={H - PAD} className="stroke-muted-foreground/30" strokeWidth="1" />
        <text
          x={W - PAD + 2}
          y={Math.min(H - PAD - 2, Math.max(PAD + 10, y0 + 14))}
          className="fill-muted-foreground text-[11px] italic"
          fontFamily="serif"
        >
          {inputVar}
        </text>
        {/* x ticks every 2 */}
        {[-6, -4, -2, 2, 4, 6].map((v) => (
          <g key={`x${v}`}>
            {0 >= lo && 0 <= hi && (
              <line x1={px(v)} y1={y0 - 2.5} x2={px(v)} y2={y0 + 2.5} className="stroke-muted-foreground/40" strokeWidth="1" />
            )}
            <text
              x={px(v)}
              y={Math.min(H - PAD - 2, Math.max(PAD + 10, y0 + 14))}
              textAnchor="middle"
              className="fill-muted-foreground/60 text-[9px]"
            >
              {v}
            </text>
          </g>
        ))}
        {/* y ticks */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={x0 - 2.5} y1={py(v)} x2={x0 + 2.5} y2={py(v)} className="stroke-muted-foreground/40" strokeWidth="1" />
            <text x={x0 - 6} y={py(v) + 3} textAnchor="end" className="fill-muted-foreground/60 text-[9px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        {/* the two sides */}
        <g clipPath="url(#graph-clip)">
          {curveL.paths.map((d, i) => (
            <path key={`l${i}`} d={d} fill="none" className="stroke-foreground/70" strokeWidth="1.6" />
          ))}
          {curveR.paths.map((d, i) => (
            <path key={`r${i}`} d={d} fill="none" className="stroke-amber-500" strokeWidth="1.6" />
          ))}
        </g>
        {/* solutions = intersections */}
        {roots.map((r) => (
          <g key={r.x}>
            <circle cx={px(r.x)} cy={py(r.y)} r="3.5" className="fill-amber-500 stroke-background" strokeWidth="1.5" />
            <text x={px(r.x)} y={py(r.y) - 8} textAnchor="middle" className="fill-amber-600 text-[10px]">
              {fmt(r.x)}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 bg-foreground/70" /> left side
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4 bg-amber-500" /> right side
        </span>
        {roots.length > 0 && (
          <span>
            {roots.length === 1 ? "crossing at" : "crossings at"} {inputVar} = {roots.map((r) => fmt(r.x)).join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
