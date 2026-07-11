/**
 * The input → output mapping pane — the reward for isolating y. Two parallel
 * number lines: inputs on top, outputs below. A draggable probe shows one
 * x being carried to its y; a quiet fan of sample arrows shows how the whole
 * line is transported — stretching, folding, and gaps all become visible.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { EqTerm } from "./model";
import { evalSide } from "./graph";

const W = 680;
const H = 240;
const PAD = 14;
const IN_Y = 62;
const OUT_Y = 178;
const X_MIN = -6;
const X_MAX = 6;

const fmt = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return String(r).replace("-", "−");
};

export function MappingPane({
  rhs,
  inputVar,
  outputVar,
}: {
  rhs: EqTerm[];
  inputVar: string;
  outputVar: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const [probe, setProbe] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const f = (x: number) => evalSide(rhs, x);

  // Output window: robust range over the input interval
  const { outLo, outHi, samples } = useMemo(() => {
    const xs: number[] = [];
    for (let i = 0; i <= 240; i++) xs.push(X_MIN + ((X_MAX - X_MIN) * i) / 240);
    const ys = xs.map(f).filter((v) => isFinite(v) && Math.abs(v) < 1e6);
    const sorted = [...ys].sort((a, b) => a - b);
    let lo = sorted.length ? sorted[Math.floor(sorted.length * 0.04)] : -5;
    let hi = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.96))] : 5;
    if (hi - lo < 2) {
      const mid = (hi + lo) / 2;
      lo = mid - 1;
      hi = mid + 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    // the fan: one arrow per unit input
    const fan: { x: number; y: number }[] = [];
    for (let x = X_MIN; x <= X_MAX + 1e-9; x += 1) {
      const y = f(x);
      if (isFinite(y) && y >= lo && y <= hi) fan.push({ x, y });
    }
    return { outLo: lo, outHi: hi, samples: fan };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rhs]);

  const pxIn = (x: number) => PAD + ((x - X_MIN) / (X_MAX - X_MIN)) * (W - 2 * PAD);
  const pxOut = (y: number) => PAD + ((y - outLo) / (outHi - outLo)) * (W - 2 * PAD);
  const inFromPx = (px: number) => X_MIN + ((px - PAD) / (W - 2 * PAD)) * (X_MAX - X_MIN);

  const probeY = f(probe);
  const probeDefined = isFinite(probeY);
  const probeVisible = probeDefined && probeY >= outLo && probeY <= outHi;

  const clientToX = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    return Math.min(X_MAX, Math.max(X_MIN, inFromPx(px)));
  };
  const down = (e: ReactPointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    setProbe(clientToX(e));
  };
  const move = (e: ReactPointerEvent) => {
    if (dragging.current) setProbe(clientToX(e));
  };
  const up = () => {
    dragging.current = false;
  };

  // nice output ticks
  const outTicks = useMemo(() => {
    const raw = (outHi - outLo) / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((st) => (outHi - outLo) / st <= 7) ?? 10 * mag;
    const ticks: number[] = [];
    for (let v = Math.ceil(outLo / step) * step; v <= outHi; v += step) ticks.push(v);
    return ticks;
  }, [outLo, outHi]);

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
        aria-label="The function as a mapping from inputs to outputs"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        {/* the fan: how the whole number line is carried */}
        {samples.map((sample) => (
          <line
            key={sample.x}
            x1={pxIn(sample.x)}
            y1={IN_Y}
            x2={pxOut(sample.y)}
            y2={OUT_Y}
            className="stroke-muted-foreground/15"
            strokeWidth="1"
          />
        ))}

        {/* input line */}
        <line x1={PAD} y1={IN_Y} x2={W - PAD} y2={IN_Y} className="stroke-muted-foreground/50" strokeWidth="1" />
        {[-6, -4, -2, 0, 2, 4, 6].map((v) => (
          <g key={`i${v}`}>
            <line x1={pxIn(v)} y1={IN_Y - 3} x2={pxIn(v)} y2={IN_Y + 3} className="stroke-muted-foreground/50" strokeWidth="1" />
            <text x={pxIn(v)} y={IN_Y - 8} textAnchor="middle" className="fill-muted-foreground/60 text-[9px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        <text x={W - PAD + 2} y={IN_Y + 3} className="fill-muted-foreground text-[11px] italic" fontFamily="serif">
          {inputVar}
        </text>

        {/* output line */}
        <line x1={PAD} y1={OUT_Y} x2={W - PAD} y2={OUT_Y} className="stroke-muted-foreground/50" strokeWidth="1" />
        {outTicks.map((v) => (
          <g key={`o${v}`}>
            <line x1={pxOut(v)} y1={OUT_Y - 3} x2={pxOut(v)} y2={OUT_Y + 3} className="stroke-muted-foreground/50" strokeWidth="1" />
            <text x={pxOut(v)} y={OUT_Y + 16} textAnchor="middle" className="fill-muted-foreground/60 text-[9px]">
              {fmt(v)}
            </text>
          </g>
        ))}
        <text x={W - PAD + 2} y={OUT_Y + 3} className="fill-muted-foreground text-[11px] italic" fontFamily="serif">
          {outputVar}
        </text>

        {/* the probe: one input carried to its output */}
        {probeVisible && (
          <g>
            <defs>
              <marker id="map-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" className="fill-amber-500" />
              </marker>
            </defs>
            <path
              d={`M${pxIn(probe)} ${IN_Y + 4} C ${pxIn(probe)} ${(IN_Y + OUT_Y) / 2}, ${pxOut(probeY)} ${(IN_Y + OUT_Y) / 2}, ${pxOut(probeY)} ${OUT_Y - 6}`}
              fill="none"
              className="stroke-amber-500"
              strokeWidth="1.6"
              markerEnd="url(#map-arrow)"
            />
            <circle cx={pxOut(probeY)} cy={OUT_Y} r="3.5" className="fill-amber-500 stroke-background" strokeWidth="1.5" />
            <text x={pxOut(probeY)} y={OUT_Y + 28} textAnchor="middle" className="fill-amber-600 text-[10px]">
              {outputVar} = {fmt(probeY)}
            </text>
          </g>
        )}
        {!probeDefined && (
          <text x={pxIn(probe)} y={(IN_Y + OUT_Y) / 2} textAnchor="middle" className="fill-rose-400 text-[10px]">
            {outputVar} is undefined here
          </text>
        )}
        {/* input handle drawn last so it stays grabbable */}
        <circle
          cx={pxIn(probe)}
          cy={IN_Y}
          r="6"
          className="cursor-grab fill-amber-500 stroke-background active:cursor-grabbing"
          strokeWidth="2"
        />
        <text x={pxIn(probe)} y={IN_Y - 14} textAnchor="middle" className="fill-amber-600 text-[10px]">
          {inputVar} = {fmt(probe)}
        </text>
      </svg>
      <div className="text-[10px] text-muted-foreground">
        {outputVar} = f({inputVar}) — drag the point to feed the function
      </div>
    </div>
  );
}
