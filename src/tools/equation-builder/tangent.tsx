/**
 * The curve & slope pane — the geometric meaning of d/dx, revealed in
 * function mode. The function's curve with a draggable point; the tangent
 * line at that point IS what differentiation measures, felt before (or
 * after) the symbolic d/dx move produces the formula.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const W = 680;
const H = 250;
const PAD = 12;
const X_MIN = -6;
const X_MAX = 6;
const SAMPLES = 241;

const fmt = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return String(r).replace("-", "−");
};

export function TangentPane({
  f,
  depKey,
  inputVar,
  outputVar,
  probeValue,
  onProbeValue,
}: {
  f: (x: number) => number;
  depKey: string;
  inputVar: string;
  outputVar: string;
  probeValue: number;
  onProbeValue: (value: number) => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const x0 = probeValue;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const plot = useMemo(() => {
    const xs: number[] = [];
    for (let i = 0; i < SAMPLES; i++) xs.push(X_MIN + ((X_MAX - X_MIN) * i) / (SAMPLES - 1));
    const ys = xs.map(f);
    const vals = ys.filter((v) => isFinite(v) && Math.abs(v) < 1e6).sort((a, b) => a - b);
    let lo = vals.length ? vals[Math.floor(vals.length * 0.03)] : -5;
    let hi = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.97))] : 5;
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
    // curve as segments, breaking at gaps and poles
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

  // the tangent, measured numerically — the geometry needs no symbols
  const h = 1e-3;
  const y0 = f(x0);
  const slope = (f(x0 + h) - f(x0 - h)) / (2 * h);
  const defined = isFinite(y0) && isFinite(slope) && y0 > lo && y0 < hi;
  const tx1 = X_MIN;
  const tx2 = X_MAX;
  const ty1 = y0 + slope * (tx1 - x0);
  const ty2 = y0 + slope * (tx2 - x0);

  const clientToX = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = X_MIN + (((e.clientX - rect.left) / rect.width) * W - PAD) / ((W - 2 * PAD) / (X_MAX - X_MIN));
    return Math.min(X_MAX, Math.max(X_MIN, x));
  };
  const down = (e: ReactPointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    onProbeValue(clientToX(e));
  };
  const move = (e: ReactPointerEvent) => {
    if (dragging.current) onProbeValue(clientToX(e));
  };
  const up = () => {
    dragging.current = false;
  };

  const yAxis0 = py(0);
  const xAxis0 = px(0);

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
        aria-label="The function's curve with a draggable tangent line"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        <defs>
          <clipPath id="tangent-clip">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx={6} />
          </clipPath>
        </defs>
        {/* axes */}
        {0 >= lo && 0 <= hi && (
          <line x1={PAD} y1={yAxis0} x2={W - PAD} y2={yAxis0} className="stroke-muted-foreground/30" strokeWidth="1" />
        )}
        <line x1={xAxis0} y1={PAD} x2={xAxis0} y2={H - PAD} className="stroke-muted-foreground/30" strokeWidth="1" />
        {[-6, -4, -2, 2, 4, 6].map((v) => (
          <text
            key={v}
            x={px(v)}
            y={Math.min(H - PAD - 2, Math.max(PAD + 10, yAxis0 + 14))}
            textAnchor="middle"
            className="fill-muted-foreground/60 text-[9px]"
          >
            {v}
          </text>
        ))}
        {/* the curve */}
        <g clipPath="url(#tangent-clip)">
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-foreground/70" strokeWidth="1.6" />
          ))}
          {/* the tangent line */}
          {defined && (
            <line
              x1={px(tx1)}
              y1={py(ty1)}
              x2={px(tx2)}
              y2={py(ty2)}
              className="stroke-amber-500"
              strokeWidth="1.4"
            />
          )}
        </g>
        {/* the point of tangency */}
        {defined && (
          <g>
            <circle cx={px(x0)} cy={py(y0)} r="5" className="cursor-grab fill-amber-500 stroke-background" strokeWidth="1.5" />
            <text x={px(x0)} y={py(y0) - 10} textAnchor="middle" className="fill-amber-600 text-[10px]">
              slope ≈ {fmt(slope)}
            </text>
          </g>
        )}
        {!defined && (
          <text x={px(x0)} y={H / 2} textAnchor="middle" className="fill-rose-400 text-[10px]">
            {outputVar} is undefined here
          </text>
        )}
      </svg>
      <div className="text-[10px] text-muted-foreground">
        d{outputVar}/d{inputVar} at {inputVar} = {fmt(x0)} is the tangent's slope — drag the point along the curve
      </div>
    </div>
  );
}
