import {
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

const W = 680;
const H = 360;
const PAD = 30;
const MIN = -6;
const MAX = 6;

const fmt = (value: number): string => {
  if (!Number.isFinite(value)) return "undefined";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace("-", "−");
};

const px = (value: number) => PAD + ((value - MIN) / (MAX - MIN)) * (W - 2 * PAD);
const py = (value: number) => H - PAD - ((value - MIN) / (MAX - MIN)) * (H - 2 * PAD);
const xFromPx = (value: number) => MIN + ((value - PAD) / (W - 2 * PAD)) * (MAX - MIN);
const yFromPy = (value: number) => MIN + ((H - PAD - value) / (H - 2 * PAD)) * (MAX - MIN);

export interface Point {
  x: number;
  y: number;
}

export interface ContourSegment {
  a: Point;
  b: Point;
}

const crossing = (a: Point, av: number, b: Point, bv: number): Point | null => {
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
  if (av === 0) return a;
  if (bv === 0) return b;
  if ((av < 0) === (bv < 0)) return null;
  const t = av / (av - bv);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

/** Marching-squares contour of G(horizontal, vertical) = 0. */
export const marchingSquaresContour = (g: (x: number, y: number) => number): ContourSegment[] => {
  const cells = 96;
  const step = (MAX - MIN) / cells;
  const values: number[][] = [];
  for (let row = 0; row <= cells; row++) {
    const y = MIN + row * step;
    values[row] = [];
    for (let col = 0; col <= cells; col++) values[row][col] = g(MIN + col * step, y);
  }
  const samePoint = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  const segments: ContourSegment[] = [];
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x0 = MIN + col * step;
      const y0 = MIN + row * step;
      const corners = [
        { x: x0, y: y0 },
        { x: x0 + step, y: y0 },
        { x: x0 + step, y: y0 + step },
        { x: x0, y: y0 + step },
      ];
      const vals = [
        values[row][col],
        values[row][col + 1],
        values[row + 1][col + 1],
        values[row + 1][col],
      ];
      // A corner value of exactly 0 makes BOTH its edges report the same
      // corner point — dedupe, or the curve gets an invisible zero-length
      // segment exactly where it passes through a grid node (the classic
      // hole at the origin for curves through (0, 0)).
      const raw = [
        crossing(corners[0], vals[0], corners[1], vals[1]),
        crossing(corners[1], vals[1], corners[2], vals[2]),
        crossing(corners[2], vals[2], corners[3], vals[3]),
        crossing(corners[3], vals[3], corners[0], vals[0]),
      ].filter((point): point is Point => !!point);
      const hits: Point[] = [];
      for (const hit of raw) if (!hits.some((seen) => samePoint(seen, hit))) hits.push(hit);
      if (hits.length === 2) {
        if (!samePoint(hits[0], hits[1])) segments.push({ a: hits[0], b: hits[1] });
      } else if (hits.length === 3) {
        // The curve passes through a corner: connect through it.
        const hub =
          hits.find((point) => corners.some((corner) => samePoint(corner, point))) ?? hits[1];
        for (const other of hits) {
          if (other !== hub) segments.push({ a: hub, b: other });
        }
      } else if (hits.length === 4) {
        // The center resolves the two ambiguous marching-squares cases.
        const center = g(x0 + step / 2, y0 + step / 2);
        const cornerPositive = vals[0] >= 0;
        if ((center >= 0) === cornerPositive) {
          segments.push({ a: hits[0], b: hits[3] }, { a: hits[1], b: hits[2] });
        } else {
          segments.push({ a: hits[0], b: hits[1] }, { a: hits[2], b: hits[3] });
        }
      }
    }
  }
  return segments;
};

/**
 * Chain cell segments into polylines so the curve renders as continuous
 * strokes with proper joins — per-cell <line> pieces read as a dashed curve
 * at some zoom levels, and any dropped cell shows twice as wide a hole.
 */
export const contourPolylines = (segments: ContourSegment[]): Point[][] => {
  const key = (p: Point) => `${Math.round(p.x * 1e7)}:${Math.round(p.y * 1e7)}`;
  const atPoint = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    for (const end of [segment.a, segment.b]) {
      const k = key(end);
      const bucket = atPoint.get(k) ?? [];
      bucket.push(index);
      atPoint.set(k, bucket);
    }
  });
  const used = new Array(segments.length).fill(false);
  const walk = (startIndex: number, startPoint: Point): Point[] => {
    const chain: Point[] = [startPoint];
    let current = startIndex;
    let at = startPoint;
    for (;;) {
      used[current] = true;
      const segment = segments[current];
      const next = key(segment.a) === key(at) ? segment.b : segment.a;
      chain.push(next);
      const candidates = (atPoint.get(key(next)) ?? []).filter((index) => !used[index]);
      if (candidates.length === 0) return chain;
      current = candidates[0];
      at = next;
    }
  };
  const chains: Point[][] = [];
  // open chains first (start from degree-1 endpoints), then closed loops
  segments.forEach((segment, index) => {
    if (used[index]) return;
    for (const end of [segment.a, segment.b]) {
      if ((atPoint.get(key(end)) ?? []).length === 1 && !used[index]) {
        chains.push(walk(index, end));
      }
    }
  });
  segments.forEach((segment, index) => {
    if (!used[index]) chains.push(walk(index, segment.a));
  });
  return chains;
};

const nearestOnSegment = (point: Point, segment: ContourSegment): Point => {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const size = dx * dx + dy * dy;
  if (size === 0) return segment.a;
  const raw = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / size;
  const t = Math.max(0, Math.min(1, raw));
  return { x: segment.a.x + t * dx, y: segment.a.y + t * dy };
};

export function ImplicitRelationPane({
  g,
  depKey,
  horizontal,
  vertical,
  probe,
  onProbe,
}: {
  g: (horizontal: number, vertical: number) => number;
  depKey: string;
  horizontal: string;
  vertical: string;
  probe: Point;
  onProbe: (point: Point) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const segments = useMemo(() => marchingSquaresContour(g), [depKey]);
  const polylines = useMemo(() => contourPolylines(segments), [segments]);

  const snap = (point: Point): Point => {
    let best = point;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      const candidate = nearestOnSegment(point, segment);
      const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  };
  const pointFromEvent = (event: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * W;
    const localY = ((event.clientY - rect.top) / rect.height) * H;
    return {
      x: Math.max(MIN, Math.min(MAX, xFromPx(localX))),
      y: Math.max(MIN, Math.min(MAX, yFromPy(localY))),
    };
  };
  const moveProbe = (event: ReactPointerEvent) => onProbe(snap(pointFromEvent(event)));
  const down = (event: ReactPointerEvent) => {
    dragging.current = true;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    moveProbe(event);
  };
  const move = (event: ReactPointerEvent) => {
    if (dragging.current) moveProbe(event);
  };
  const up = () => { dragging.current = false; };

  const h = 1e-4;
  const gx = (g(probe.x + h, probe.y) - g(probe.x - h, probe.y)) / (2 * h);
  const gy = (g(probe.x, probe.y + h) - g(probe.x, probe.y - h)) / (2 * h);
  const norm = Math.hypot(gx, gy);
  const tangent = norm > 1e-10 && Number.isFinite(norm)
    ? { x: -gy / norm, y: gx / norm }
    : null;
  const tangentHalf = 2.2;

  return (
    <div className="mt-8 flex flex-col items-center gap-2" data-ui>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-[min(680px,88vw)] touch-none select-none"
        role="img"
        aria-label={`Implicit relation in ${horizontal} and ${vertical}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <defs>
          <clipPath id="implicit-clip">
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx="6" />
          </clipPath>
        </defs>
        <line x1={PAD} y1={py(0)} x2={W - PAD} y2={py(0)} className="stroke-muted-foreground/30" />
        <line x1={px(0)} y1={PAD} x2={px(0)} y2={H - PAD} className="stroke-muted-foreground/30" />
        <g clipPath="url(#implicit-clip)">
          {polylines.map((chain, index) => (
            <path
              key={index}
              d={chain
                .map((point, i) => `${i === 0 ? "M" : "L"}${px(point.x).toFixed(2)} ${py(point.y).toFixed(2)}`)
                .join(" ")}
              fill="none"
              className="stroke-foreground/75"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {tangent && (
            <line
              x1={px(probe.x - tangent.x * tangentHalf)}
              y1={py(probe.y - tangent.y * tangentHalf)}
              x2={px(probe.x + tangent.x * tangentHalf)}
              y2={py(probe.y + tangent.y * tangentHalf)}
              className="stroke-amber-500"
              strokeWidth="1.5"
            />
          )}
        </g>
        {segments.length > 0 && (
          <>
            <circle cx={px(probe.x)} cy={py(probe.y)} r="5" className="fill-amber-500 stroke-background" strokeWidth="2" />
            <text x={px(probe.x)} y={py(probe.y) - 10} textAnchor="middle" className="fill-amber-600 text-[10px]">
              ({fmt(probe.x)}, {fmt(probe.y)})
            </text>
          </>
        )}
        <text x={W - PAD + 5} y={py(0) + 4} className="fill-muted-foreground text-[11px] italic">{horizontal}</text>
        <text x={px(0) + 5} y={PAD - 8} className="fill-muted-foreground text-[11px] italic">{vertical}</text>
        {segments.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            no real contour in this window
          </text>
        )}
      </svg>
      <div className="text-[10px] text-muted-foreground">
        left − right = 0 · drag along the relation; the orange line is tangent to its gradient
      </div>
    </div>
  );
}

export function ScalarFieldPane({
  f,
  depKey,
  horizontal,
  vertical,
  output,
  probe,
  onProbe,
}: {
  f: (horizontal: number, vertical: number) => number;
  depKey: string;
  horizontal: string;
  vertical: string;
  output: string;
  probe: Point;
  onProbe: (point: Point) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const field = useMemo(() => {
    const cols = 44;
    const rows = 28;
    const cells: Array<{ x: number; y: number; value: number }> = [];
    for (let row = 0; row < rows; row++) {
      const y = MIN + ((row + 0.5) / rows) * (MAX - MIN);
      for (let col = 0; col < cols; col++) {
        const x = MIN + ((col + 0.5) / cols) * (MAX - MIN);
        cells.push({ x, y, value: f(x, y) });
      }
    }
    const finite = cells.map((cell) => cell.value).filter(Number.isFinite).sort((a, b) => a - b);
    const lo = finite.length ? finite[Math.floor(finite.length * 0.03)] : -1;
    const hi = finite.length ? finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.97))] : 1;
    return { cells, cols, rows, lo, hi: hi === lo ? lo + 1 : hi };
  }, [depKey]);
  const pointFromEvent = (event: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(MIN, Math.min(MAX, xFromPx(((event.clientX - rect.left) / rect.width) * W))),
      y: Math.max(MIN, Math.min(MAX, yFromPy(((event.clientY - rect.top) / rect.height) * H))),
    };
  };
  const down = (event: ReactPointerEvent) => {
    dragging.current = true;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    onProbe(pointFromEvent(event));
  };
  const move = (event: ReactPointerEvent) => {
    if (dragging.current) onProbe(pointFromEvent(event));
  };
  const up = () => { dragging.current = false; };
  const cellW = (W - 2 * PAD) / field.cols;
  const cellH = (H - 2 * PAD) / field.rows;
  const color = (value: number): string => {
    if (!Number.isFinite(value)) return "hsl(0 0% 88%)";
    const t = Math.max(0, Math.min(1, (value - field.lo) / (field.hi - field.lo)));
    return `hsl(${220 - t * 190} 75% ${82 - Math.abs(t - 0.5) * 28}%)`;
  };
  const value = f(probe.x, probe.y);

  return (
    <div className="mt-8 flex flex-col items-center gap-2" data-ui>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-[min(680px,88vw)] touch-none select-none"
        role="img"
        aria-label={`${output} as a scalar field over ${horizontal} and ${vertical}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <g>
          {field.cells.map((cell, index) => {
            const col = index % field.cols;
            const row = Math.floor(index / field.cols);
            return (
              <rect
                key={index}
                x={PAD + col * cellW}
                y={PAD + (field.rows - row - 1) * cellH}
                width={cellW + 0.4}
                height={cellH + 0.4}
                fill={color(cell.value)}
              />
            );
          })}
        </g>
        <line x1={PAD} y1={py(0)} x2={W - PAD} y2={py(0)} className="stroke-foreground/25" />
        <line x1={px(0)} y1={PAD} x2={px(0)} y2={H - PAD} className="stroke-foreground/25" />
        <circle cx={px(probe.x)} cy={py(probe.y)} r="5" className="fill-amber-500 stroke-background" strokeWidth="2" />
        <text x={px(probe.x)} y={py(probe.y) - 10} textAnchor="middle" className="fill-amber-700 text-[10px]">
          {output} = {fmt(value)}
        </text>
        <text x={W - PAD + 5} y={py(0) + 4} className="fill-muted-foreground text-[11px] italic">{horizontal}</text>
        <text x={px(0) + 5} y={PAD - 8} className="fill-muted-foreground text-[11px] italic">{vertical}</text>
      </svg>
      <div className="text-[10px] text-muted-foreground">
        color encodes {output}; drag the probe to inspect this two-input model
      </div>
    </div>
  );
}
