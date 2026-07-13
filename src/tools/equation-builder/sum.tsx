/**
 * The sum pane — Σ, felt. The function sampled at the integers: a stem at
 * every k, with the ones between two draggable integer bounds highlighted and
 * added up live. Dragging a bound off the edge makes the sum an infinite
 * SERIES — evaluated honestly at two growing cutoffs, so a series that
 * diverges says so instead of showing a made-up number.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const W = 680;
const H = 250;
const PAD = 12;
const X_MIN = -6;
const X_MAX = 6;

const fmt = (v: number): string => {
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  const r = Math.round(v * 1000) / 1000;
  return String(r).replace("-", "−");
};

export function SumPane({
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

  // vertical window from the visible integer samples
  const scale = useMemo(() => {
    const ys: number[] = [];
    for (let k = X_MIN; k <= X_MAX; k++) {
      const y = f(k);
      if (isFinite(y) && Math.abs(y) < 1e6) ys.push(y);
    }
    let lo = ys.length ? Math.min(...ys) : -5;
    let hi = ys.length ? Math.max(...ys) : 5;
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
    return { lo, hi, px, py };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const { lo, hi, px, py } = scale;

  // the sum itself. Finite bounds add the terms exactly; an infinite bound is
  // a SERIES, summed at two growing cutoffs — if the partial sums agree it
  // converged, if they don't the honest answer is "diverges"
  const verdict = useMemo(() => {
    const a = Math.min(bounds.lo, bounds.hi);
    const b = Math.max(bounds.lo, bounds.hi);
    const improper = !isFinite(a) || !isFinite(b);
    const partial = (cutoff: number): { sum: number; badK: number | null } => {
      const from = Math.max(a, -cutoff);
      const to = Math.min(b, cutoff);
      let sum = 0;
      for (let k = Math.ceil(from); k <= Math.floor(to); k++) {
        const t = f(k);
        if (!isFinite(t)) return { sum: NaN, badK: k };
        sum += t;
      }
      return { sum, badK: null };
    };
    if (!improper) {
      const { sum, badK } = partial(1e9);
      return badK !== null
        ? { kind: "undefined" as const, badK }
        : { kind: "value" as const, sum };
    }
    const p1 = partial(1500);
    const p2 = partial(3000);
    if (p1.badK !== null || p2.badK !== null) {
      return { kind: "undefined" as const, badK: (p1.badK ?? p2.badK)! };
    }
    const settled = isFinite(p2.sum) && Math.abs(p2.sum - p1.sum) <= Math.max(1e-3, Math.abs(p2.sum) * 1e-3);
    return settled
      ? { kind: "converges" as const, sum: p2.sum }
      : { kind: "diverges" as const };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.lo, bounds.hi, depKey]);

  const clientToK = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const x = X_MIN + ((sx - PAD) / (W - 2 * PAD)) * (X_MAX - X_MIN);
    // dragged to (or past) the edge → the bound goes improper: a series
    if (x >= X_MAX - 0.1) return Infinity;
    if (x <= X_MIN + 0.1) return -Infinity;
    return Math.round(Math.min(X_MAX, Math.max(X_MIN, x)));
  };
  const down = (which: "lo" | "hi") => (e: ReactPointerEvent) => {
    e.stopPropagation();
    dragging.current = which;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    onBounds({ ...bounds, [dragging.current]: clientToK(e) });
  };
  const up = () => {
    dragging.current = null;
  };

  const y0 = py(0);
  const a = Math.min(bounds.lo, bounds.hi);
  const b = Math.max(bounds.lo, bounds.hi);

  const stems: { k: number; y: number; inRange: boolean }[] = [];
  for (let k = X_MIN; k <= X_MAX; k++) {
    const y = f(k);
    if (!isFinite(y)) continue;
    stems.push({ k, y: Math.max(lo, Math.min(hi, y)), inRange: k >= a && k <= b });
  }

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
        aria-label="The function sampled at the integers, summed between two draggable bounds"
        onPointerMove={move}
        onPointerUp={up}
      >
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
        {stems.map(({ k, y, inRange }) => (
          <g key={k}>
            <line
              x1={px(k)}
              y1={y0}
              x2={px(k)}
              y2={py(y)}
              className={inRange ? "stroke-amber-500/70" : "stroke-muted-foreground/25"}
              strokeWidth={inRange ? 2.5 : 1.5}
            />
            <circle
              cx={px(k)}
              cy={py(y)}
              r={inRange ? 3.5 : 2.5}
              className={inRange ? "fill-amber-500" : "fill-muted-foreground/40"}
            />
          </g>
        ))}
        {handle("lo", bounds.lo)}
        {handle("hi", bounds.hi)}
      </svg>
      <div className="text-[10px] text-muted-foreground">
        Σ of the terms at {inputVar} = k, from k = {fmt(a)} to {fmt(b)}{" "}
        {verdict.kind === "undefined" ? (
          <span className="text-rose-500">is undefined — the term at k = {verdict.badK} has no value</span>
        ) : verdict.kind === "diverges" ? (
          <span className="text-rose-500">diverges — the partial sums never settle</span>
        ) : verdict.kind === "converges" ? (
          <>
            converges ≈ <span className="text-amber-600">{fmt(verdict.sum)}</span>
          </>
        ) : (
          <>
            = <span className="text-amber-600">{fmt(verdict.sum)}</span>
          </>
        )}{" "}
        — drag the bounds (to the edge for an infinite series), or drop a number from the equation onto one
      </div>
    </div>
  );
}
