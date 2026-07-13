/**
 * The limit pane — lim, felt. The curve with one draggable approach point;
 * the function is probed from both sides at shrinking distances and the pane
 * says honestly what it finds: a two-sided limit, a hole the limit jumps
 * over, a left/right disagreement, a blow-up, or values that never settle.
 * Dragging the point off the edge asks for the limit at ±∞.
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
  const r = Math.round(v * 1000) / 1000;
  return String(r).replace("-", "−");
};

/** What one side of the approach found */
type SideProbe =
  | { kind: "value"; v: number }
  | { kind: "inf"; sign: 1 | -1 }
  | { kind: "unsettled" };

/** Probe f as x → c from one side (dir = +1 right, −1 left) */
function probeSide(f: (x: number) => number, c: number, dir: 1 | -1): SideProbe {
  const hs = [1e-2, 1e-3, 1e-4, 1e-5];
  const vs = hs.map((h) => f(c + dir * h));
  const last = vs[vs.length - 1];
  const prev = vs[vs.length - 2];
  const blowing = vs.every((v) => !isFinite(v) || Math.abs(v) > 1e7) || (isFinite(last) && Math.abs(last) > 1e7);
  if (blowing) {
    const signs = vs.filter((v) => Math.abs(v) > 1e5).map((v) => Math.sign(v));
    if (signs.length && signs.every((s) => s === signs[0])) return { kind: "inf", sign: signs[0] as 1 | -1 };
    return { kind: "unsettled" };
  }
  if (!isFinite(last) || !isFinite(prev)) return { kind: "unsettled" };
  // steadily exploding as h shrinks, all one sign → a one-sided blow-up
  const growing = vs.every((v, i) => i === 0 || Math.abs(v) > Math.abs(vs[i - 1]) * 2);
  if (growing && Math.abs(last) > 100 && vs.every((v) => Math.sign(v) === Math.sign(last))) {
    return { kind: "inf", sign: Math.sign(last) as 1 | -1 };
  }
  const settled = Math.abs(last - prev) <= Math.max(1e-4, Math.abs(last) * 1e-3);
  return settled ? { kind: "value", v: last } : { kind: "unsettled" };
}

/**
 * Probe f as x → ±∞ over three doubling windows. A single far sample lies
 * (an oscillation can hit any value), so each window is summarized by the
 * midpoint and spread of many samples: a steady drift of the midpoints is
 * ±∞, a shrinking spread converges (the value extrapolated geometrically),
 * and a spread that never shrinks is honestly "never settles".
 */
function probeInfinity(f: (x: number) => number, sign: 1 | -1): SideProbe {
  const windows = [
    [100, 200],
    [200, 400],
    [400, 800],
  ].map(([a, b]) => {
    const vs: number[] = [];
    for (let i = 0; i < 48; i++) {
      const v = f(sign * (a + ((b - a) * i) / 47));
      if (isFinite(v)) vs.push(v);
    }
    if (vs.length < 24) return null;
    const max = Math.max(...vs);
    const min = Math.min(...vs);
    return { mid: (max + min) / 2, range: max - min, oneSign: min > 0 ? 1 : max < 0 ? -1 : 0 };
  });
  if (windows.some((w) => w === null)) {
    // f mostly blows past float range — same-signed and huge means ±∞
    const finite = windows.filter((w) => w !== null);
    const lastW = finite[finite.length - 1];
    if (lastW && lastW.oneSign !== 0 && Math.abs(lastW.mid) > 1e3) return { kind: "inf", sign: lastW.oneSign as 1 | -1 };
    return { kind: "unsettled" };
  }
  const [w1, w2, w3] = windows as { mid: number; range: number }[];
  const d1 = w2.mid - w1.mid;
  const d2 = w3.mid - w2.mid;
  // a steady or accelerating drift in one direction never levels off: ±∞
  const drifting =
    Math.abs(d2) > Math.max(0.05, Math.abs(w3.mid) * 1e-3) &&
    Math.sign(d2) === Math.sign(d1) &&
    Math.abs(d2) >= Math.abs(d1) * 0.95;
  if (drifting || Math.abs(w3.mid) > 1e6) return { kind: "inf", sign: Math.sign(w3.mid + d2) as 1 | -1 };
  const settling =
    w3.range < Math.max(2e-2, Math.abs(w3.mid) * 0.05) || (w3.range < w2.range * 0.6 && w2.range < w1.range * 0.6);
  if (!settling) return { kind: "unsettled" };
  if (Math.abs(d2) <= Math.max(1e-4, Math.abs(w3.mid) * 1e-3)) return { kind: "value", v: w3.mid };
  const r = d2 / d1;
  if (isFinite(r) && Math.abs(r) < 0.95) return { kind: "value", v: w3.mid + (d2 * r) / (1 - r) };
  return { kind: "unsettled" };
}

const sideText = (p: SideProbe): string =>
  p.kind === "value" ? `→ ${fmt(p.v)}` : p.kind === "inf" ? `→ ${p.sign > 0 ? "∞" : "−∞"}` : "never settles";

export function LimitPane({
  f,
  depKey,
  inputVar,
  at,
  onAt,
}: {
  f: (x: number) => number;
  depKey: string;
  inputVar: string;
  at: number;
  onAt: (c: number) => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

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

  const verdict = useMemo(() => {
    if (!isFinite(at)) {
      const p = probeInfinity(f, at > 0 ? 1 : -1);
      return { kind: "one-sided" as const, probe: p };
    }
    const left = probeSide(f, at, -1);
    const right = probeSide(f, at, 1);
    const fc = f(at);
    const agree =
      (left.kind === "value" &&
        right.kind === "value" &&
        Math.abs(left.v - right.v) <= Math.max(1e-3, Math.abs(left.v) * 1e-3)) ||
      (left.kind === "inf" && right.kind === "inf" && left.sign === right.sign);
    if (agree && left.kind === "value" && right.kind === "value") {
      const L = (left.v + right.v) / 2;
      const fcState: "matches" | "hole" | "differs" = !isFinite(fc)
        ? "hole"
        : Math.abs(fc - L) <= Math.max(1e-3, Math.abs(L) * 1e-3)
          ? "matches"
          : "differs";
      return { kind: "limit" as const, L, fc, fcState };
    }
    if (agree && left.kind === "inf") {
      return { kind: "blowup" as const, sign: left.sign };
    }
    return { kind: "split" as const, left, right };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, depKey]);

  const clientToX = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const x = X_MIN + ((sx - PAD) / (W - 2 * PAD)) * (X_MAX - X_MIN);
    // dragged to (or past) the edge → the limit at ±∞
    if (x >= X_MAX - 0.1) return Infinity;
    if (x <= X_MIN + 0.1) return -Infinity;
    return Math.round(Math.min(X_MAX, Math.max(X_MIN, x)) * 20) / 20;
  };
  const move = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    onAt(clientToX(e));
  };

  const y0 = py(0);
  const hx = px(Math.max(X_MIN, Math.min(X_MAX, at))); // ±∞ pins to the edge

  // approach dots: the eye's version of the probe — samples marching in on c
  const approach: { x: number; y: number; o: number }[] = [];
  if (isFinite(at)) {
    [1.6, 1.0, 0.55, 0.25].forEach((h, i) => {
      for (const dir of [-1, 1] as const) {
        const x = at + dir * h;
        const y = f(x);
        if (x < X_MIN || x > X_MAX || !isFinite(y) || y < lo || y > hi) continue;
        approach.push({ x, y, o: 0.35 + i * 0.2 });
      }
    });
  }

  const clampedY = (v: number) => Math.max(lo, Math.min(hi, v));

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
        aria-label="The curve with a draggable approach point, probed from both sides"
        onPointerMove={move}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        <defs>
          <clipPath id="limit-clip">
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
        <g clipPath="url(#limit-clip)">
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-foreground/70" strokeWidth="1.6" />
          ))}
          {approach.map((p, i) => (
            <circle key={i} cx={px(p.x)} cy={py(p.y)} r="3" className="fill-amber-500" opacity={p.o} />
          ))}
          {/* the limit's landing point: hollow when it's a hole the curve skips */}
          {isFinite(at) && verdict.kind === "limit" && (
            <>
              <circle
                cx={hx}
                cy={py(clampedY(verdict.L))}
                r="4.5"
                className={
                  verdict.fcState === "matches" ? "fill-amber-500 stroke-background" : "fill-background stroke-amber-500"
                }
                strokeWidth="2"
              />
              {verdict.fcState === "differs" && isFinite(verdict.fc) && (
                <circle cx={hx} cy={py(clampedY(verdict.fc))} r="4" className="fill-amber-500 stroke-background" strokeWidth="2" />
              )}
            </>
          )}
        </g>
        <line x1={hx} y1={PAD} x2={hx} y2={H - PAD} className="stroke-amber-500/60" strokeWidth="1" strokeDasharray="3 3" />
        <circle
          cx={hx}
          cy={y0}
          r="6"
          data-bound="at"
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = true;
            (e.target as Element).setPointerCapture(e.pointerId);
          }}
          className="cursor-ew-resize fill-amber-500 stroke-background"
          strokeWidth="2"
        />
        <text x={hx} y={H - 2} textAnchor="middle" className="fill-amber-600 text-[10px]">
          {inputVar} → {fmt(at)}
        </text>
      </svg>
      <div className="text-[10px] text-muted-foreground">
        lim as {inputVar} → {fmt(at)}{" "}
        {verdict.kind === "one-sided" ? (
          verdict.probe.kind === "value" ? (
            <>
              ≈ <span className="text-amber-600">{fmt(verdict.probe.v)}</span>
            </>
          ) : verdict.probe.kind === "inf" ? (
            <span className="text-rose-500">diverges to {verdict.probe.sign > 0 ? "∞" : "−∞"}</span>
          ) : (
            <span className="text-rose-500">does not exist — the values never settle</span>
          )
        ) : verdict.kind === "limit" ? (
          <>
            = <span className="text-amber-600">{fmt(verdict.L)}</span>
            {verdict.fcState === "hole" ? (
              <span className="text-amber-600">
                {" "}
                — even though f({fmt(at)}) itself is undefined: a removable hole
              </span>
            ) : verdict.fcState === "differs" ? (
              <span className="text-amber-600">
                {" "}
                — but f({fmt(at)}) = {fmt(verdict.fc)}, off the approaching curve
              </span>
            ) : null}
          </>
        ) : verdict.kind === "blowup" ? (
          <span className="text-rose-500">diverges to {verdict.sign > 0 ? "∞" : "−∞"} from both sides</span>
        ) : (
          <span className="text-rose-500">
            does not exist — from the left {sideText(verdict.left)}, from the right {sideText(verdict.right)}
          </span>
        )}{" "}
        — drag the point (to the edge for ±∞), or drop a number from the equation onto it
      </div>
    </div>
  );
}
