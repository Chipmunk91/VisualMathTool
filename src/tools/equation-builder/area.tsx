/**
 * The area pane — the definite integral, felt. The function's curve with two
 * draggable bounds; the signed area between them is shaded and measured live.
 * The bounds are also drop targets: drag a constant term from the equation
 * onto a handle to pin that bound exactly.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const W = 680;
const H = 250;
const PAD = 12;
const X_MIN = -6;
const X_MAX = 6;
const SAMPLES = 241;

const fmt = (v: number): string => {
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  const r = Math.round(v * 100) / 100;
  return String(r).replace("-", "−");
};

export function AreaPane({
  f,
  depKey,
  inputVar,
  bounds,
  onBounds,
}: {
  f: (x: number) => number;
  depKey: string;
  inputVar: string;
  bounds: { lo: number; hi: number };
  onBounds: (b: { lo: number; hi: number }) => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<"lo" | "hi" | null>(null);

  const plot = useMemo(() => {
    const xs: number[] = [];
    for (let i = 0; i < SAMPLES; i++) xs.push(X_MIN + ((X_MAX - X_MIN) * i) / (SAMPLES - 1));
    const ys = xs.map(f);
    const vals = ys.filter((v) => isFinite(v) && Math.abs(v) < 1e6).sort((a, b) => a - b);
    let lo = vals.length ? vals[Math.floor(vals.length * 0.03)] : -5;
    let hi = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.97))] : 5;
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
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
    return { paths, lo, hi, px, py };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const { paths, lo, hi, px, py } = plot;

  // signed area by midpoint rule, skipping undefined stretches. Infinite
  // bounds are IMPROPER integrals: computed at two growing cutoffs — if the
  // values agree it converged; if they don't, the honest answer is "diverges"
  const { area, diverges, fill } = useMemo(() => {
    const clampLo = (v: number, cutoff: number) => (v === -Infinity ? -cutoff : v);
    const clampHi = (v: number, cutoff: number) => (v === Infinity ? cutoff : v);
    const improper = !isFinite(bounds.lo) || !isFinite(bounds.hi);
    const integrate = (cutoff: number): number => {
      const a = Math.min(clampLo(bounds.lo, cutoff), clampHi(bounds.hi, cutoff));
      const b = Math.max(clampLo(bounds.lo, cutoff), clampHi(bounds.hi, cutoff));
      const N = 800;
      const dx = (b - a) / N;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const m = f(a + (i + 0.5) * dx);
        if (isFinite(m)) sum += m * dx;
      }
      return bounds.hi >= bounds.lo || improper ? sum : -sum;
    };
    let value: number;
    let div = false;
    if (improper) {
      const i1 = integrate(40);
      const i2 = integrate(80);
      div = !isFinite(i2) || Math.abs(i2 - i1) > Math.max(1e-3, Math.abs(i2) * 1e-3);
      value = i2;
    } else {
      value = integrate(0);
    }
    // the shaded region: curve clamped to the window, down to the x-axis
    const da = Math.max(X_MIN, Math.min(bounds.lo, bounds.hi));
    const db = Math.min(X_MAX, Math.max(bounds.lo, bounds.hi));
    const pts: string[] = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const x = da + ((db - da) * i) / steps;
      let y = f(x);
      if (!isFinite(y)) y = 0;
      y = Math.max(lo, Math.min(hi, y));
      pts.push(`${px(x).toFixed(1)},${py(y).toFixed(1)}`);
    }
    pts.push(`${px(db).toFixed(1)},${py(0).toFixed(1)}`);
    pts.push(`${px(da).toFixed(1)},${py(0).toFixed(1)}`);
    return { area: value, diverges: div, fill: pts.join(" ") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.lo, bounds.hi, depKey, lo, hi]);

  const clientToX = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const x = X_MIN + ((sx - PAD) / (W - 2 * PAD)) * (X_MAX - X_MIN);
    // dragged to (or past) the edge → the bound goes improper
    if (x >= X_MAX - 0.1) return Infinity;
    if (x <= X_MIN + 0.1) return -Infinity;
    return Math.round(Math.min(X_MAX, Math.max(X_MIN, x)) * 20) / 20;
  };
  const down = (which: "lo" | "hi") => (e: ReactPointerEvent) => {
    e.stopPropagation();
    dragging.current = which;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    onBounds({ ...bounds, [dragging.current]: clientToX(e) });
  };
  const up = () => {
    dragging.current = null;
  };

  const y0 = py(0);
  const handle = (which: "lo" | "hi", x: number) => {
    const hx = px(Math.max(X_MIN, Math.min(X_MAX, x))); // ±∞ pins to the edge
    return (
      <g key={which}>
        <line x1={hx} y1={PAD} x2={hx} y2={H - PAD} className="stroke-amber-500/60" strokeWidth="1" strokeDasharray="3 3" />
        <circle
          cx={hx}
          cy={y0}
          r="6"
          data-bound={which}
          onPointerDown={down(which)}
          className="cursor-ew-resize fill-amber-500 stroke-background"
          strokeWidth="2"
        />
        <text x={hx} y={H - 2} textAnchor="middle" className="fill-amber-600 text-[10px]">
          {which === "lo" ? "a" : "b"} = {fmt(x)}
        </text>
      </g>
    );
  };

  return (
    <div
      className={`mt-10 flex select-none flex-col items-center gap-1.5 transition-opacity duration-700 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      data-ui
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-[min(680px,85vw)] touch-none"
        role="img"
        aria-label="The signed area under the curve between two draggable bounds"
        onPointerMove={move}
        onPointerUp={up}
      >
        <defs>
          <clipPath id="area-clip">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx={6} />
          </clipPath>
        </defs>
        {0 >= lo && 0 <= hi && (
          <line x1={PAD} y1={y0} x2={W - PAD} y2={y0} className="stroke-muted-foreground/30" strokeWidth="1" />
        )}
        <line x1={px(0)} y1={PAD} x2={px(0)} y2={H - PAD} className="stroke-muted-foreground/30" strokeWidth="1" />
        {[-6, -4, -2, 2, 4, 6].map((v) => (
          <text
            key={v}
            x={px(v)}
            y={Math.min(H - PAD - 2, Math.max(PAD + 10, y0 + 14))}
            textAnchor="middle"
            className="fill-muted-foreground/60 text-[9px]"
          >
            {v}
          </text>
        ))}
        <g clipPath="url(#area-clip)">
          <polygon points={fill} className="fill-amber-400/25" />
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-foreground/70" strokeWidth="1.6" />
          ))}
        </g>
        {handle("lo", bounds.lo)}
        {handle("hi", bounds.hi)}
      </svg>
      <div className="text-[10px] text-muted-foreground">
        ∫ from {inputVar} = {fmt(bounds.lo)} to {fmt(bounds.hi)}{" "}
        {diverges ? (
          <span className="text-rose-500">diverges — the area grows without bound</span>
        ) : (
          <>
            ≈ <span className="text-amber-600">{isFinite(area) ? fmt(area) : "undefined"}</span>
          </>
        )}{" "}
        — drag the bounds (to the edge for ±∞), or drop a number from the equation onto one
      </div>
    </div>
  );
}
