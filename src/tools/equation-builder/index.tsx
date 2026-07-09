import { useMemo, useState, DragEvent } from "react";
import { create, all } from "mathjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const math = create(all);

/**
 * Equation Playground — build f(x) out of draggable symbol tokens and watch
 * how the function maps input space to output space.
 */

interface TokenDef {
  label: string; // what the user sees (×, ln, √, …)
  expr: string;  // what mathjs evaluates (*, log, sqrt, …)
}

interface Token extends TokenDef {
  id: string;
}

const PALETTE: { group: string; items: TokenDef[] }[] = [
  { group: "Variable", items: [{ label: "x", expr: "x" }] },
  {
    group: "Numbers",
    items: [
      { label: "0.5", expr: "0.5" },
      { label: "1", expr: "1" },
      { label: "2", expr: "2" },
      { label: "3", expr: "3" },
      { label: "10", expr: "10" },
      { label: "π", expr: "pi" },
      { label: "e", expr: "e" },
    ],
  },
  {
    group: "Operators",
    items: [
      { label: "+", expr: "+" },
      { label: "−", expr: "-" },
      { label: "×", expr: "*" },
      { label: "÷", expr: "/" },
      { label: "^", expr: "^" },
      { label: "(", expr: "(" },
      { label: ")", expr: ")" },
    ],
  },
  {
    group: "Functions",
    items: [
      { label: "sin", expr: "sin" },
      { label: "cos", expr: "cos" },
      { label: "tan", expr: "tan" },
      { label: "exp", expr: "exp" },
      { label: "ln", expr: "log" },
      { label: "√", expr: "sqrt" },
      { label: "abs", expr: "abs" },
    ],
  },
];

let tokenCounter = 0;
const makeToken = (def: TokenDef): Token => ({ ...def, id: `tok-${tokenCounter++}` });

const toTokens = (defs: TokenDef[]): Token[] => defs.map(makeToken);

const EXAMPLES: { name: string; defs: TokenDef[] }[] = [
  {
    name: "sin(x)",
    defs: [
      { label: "sin", expr: "sin" }, { label: "(", expr: "(" },
      { label: "x", expr: "x" }, { label: ")", expr: ")" },
    ],
  },
  {
    name: "x² − 2",
    defs: [
      { label: "x", expr: "x" }, { label: "^", expr: "^" }, { label: "2", expr: "2" },
      { label: "−", expr: "-" }, { label: "2", expr: "2" },
    ],
  },
  {
    name: "x·sin(x)",
    defs: [
      { label: "x", expr: "x" }, { label: "×", expr: "*" },
      { label: "sin", expr: "sin" }, { label: "(", expr: "(" },
      { label: "x", expr: "x" }, { label: ")", expr: ")" },
    ],
  },
  {
    name: "eˣ ÷ 10",
    defs: [
      { label: "exp", expr: "exp" }, { label: "(", expr: "(" },
      { label: "x", expr: "x" }, { label: ")", expr: ")" },
      { label: "÷", expr: "/" }, { label: "10", expr: "10" },
    ],
  },
  {
    name: "1 ÷ x",
    defs: [
      { label: "1", expr: "1" }, { label: "÷", expr: "/" }, { label: "x", expr: "x" },
    ],
  },
];

// Input domain shown on both the graph and the mapping view
const X_MIN = -5;
const X_MAX = 5;
const GRAPH_SAMPLES = 240;
const MAP_SAMPLES = 25;

const scale = (v: number, [d0, d1]: number[], [r0, r1]: number[]) =>
  r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

interface Samples {
  xs: number[];
  ys: number[];
  yMin: number;
  yMax: number;
}

function sampleFunction(compiled: { evaluate: (scope: object) => unknown } | null, n: number): Samples | null {
  if (!compiled) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / n;
    let y = NaN;
    try {
      const v = compiled.evaluate({ x });
      if (typeof v === "number" && isFinite(v)) y = v;
    } catch {
      // leave NaN — plotted as a gap
    }
    xs.push(x);
    ys.push(y);
  }
  const finite = ys.filter((y) => !isNaN(y));
  if (finite.length === 0) return null;
  // Clamp the view so poles (tan, 1/x) don't flatten everything else
  let yMin = Math.max(Math.min(...finite), -12);
  let yMax = Math.min(Math.max(...finite), 12);
  if (yMax - yMin < 1e-6) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.1;
  return { xs, ys, yMin: yMin - pad, yMax: yMax + pad };
}

const sampleColor = (i: number, n: number) => `hsl(${scale(i, [0, n], [230, 0])}, 80%, 50%)`;

/** Graph of y = f(x) with a highlighted point at x₀ */
const FunctionGraph = ({ samples, x0, y0 }: { samples: Samples; x0: number; y0: number | null }) => {
  const W = 600, H = 340, M = 36;
  const { xs, ys, yMin, yMax } = samples;
  const px = (x: number) => scale(x, [X_MIN, X_MAX], [M, W - M]);
  const py = (y: number) => scale(y, [yMin, yMax], [H - M, M]);

  // Build path segments, breaking at gaps and discontinuities
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < xs.length; i++) {
    const gap = isNaN(ys[i]) || (i > 0 && !isNaN(ys[i - 1]) && Math.abs(ys[i] - ys[i - 1]) > (yMax - yMin) * 2);
    if (gap) {
      if (current) segments.push(current);
      current = "";
      if (isNaN(ys[i])) continue;
    }
    current += `${current ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(ys[i]).toFixed(1)}`;
  }
  if (current) segments.push(current);

  const xTicks = Array.from({ length: X_MAX - X_MIN + 1 }, (_, i) => X_MIN + i);
  const yTickStep = yMax - yMin > 8 ? 2 : 1;
  const yTicks = [];
  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += yTickStep) yTicks.push(y);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <clipPath id="graph-clip">
          <rect x={M} y={M} width={W - 2 * M} height={H - 2 * M} />
        </clipPath>
      </defs>
      {/* Grid */}
      {xTicks.map((x) => (
        <line key={`gx${x}`} x1={px(x)} y1={M} x2={px(x)} y2={H - M} stroke="#e5e7eb" strokeWidth={x === 0 ? 0 : 1} />
      ))}
      {yTicks.map((y) => (
        <line key={`gy${y}`} x1={M} y1={py(y)} x2={W - M} y2={py(y)} stroke="#e5e7eb" strokeWidth={y === 0 ? 0 : 1} />
      ))}
      {/* Axes */}
      {yMin < 0 && yMax > 0 && <line x1={M} y1={py(0)} x2={W - M} y2={py(0)} stroke="#9ca3af" strokeWidth={1.5} />}
      <line x1={px(0)} y1={M} x2={px(0)} y2={H - M} stroke="#9ca3af" strokeWidth={1.5} />
      {/* Tick labels */}
      {xTicks.filter((x) => x !== 0).map((x) => (
        <text key={`tx${x}`} x={px(x)} y={H - M + 16} textAnchor="middle" fontSize={11} fill="#6b7280">{x}</text>
      ))}
      {yTicks.filter((y) => y !== 0).map((y) => (
        <text key={`ty${y}`} x={M - 8} y={py(y) + 4} textAnchor="end" fontSize={11} fill="#6b7280">{y}</text>
      ))}
      {/* Curve */}
      <g clipPath="url(#graph-clip)">
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#2563EB" strokeWidth={2.5} />
        ))}
      </g>
      {/* Highlighted point at x₀ */}
      {y0 !== null && y0 >= yMin && y0 <= yMax && (
        <g>
          <line x1={px(x0)} y1={H - M} x2={px(x0)} y2={py(y0)} stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4 3" />
          <line x1={M} y1={py(y0)} x2={px(x0)} y2={py(y0)} stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="4 3" />
          <circle cx={px(x0)} cy={py(y0)} r={5} fill="#F59E0B" stroke="#fff" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
};

/** Input number line → output number line: how f maps 1D space */
const MappingView = ({
  compiled,
  samples,
  x0,
  y0,
}: {
  compiled: { evaluate: (scope: object) => unknown };
  samples: Samples;
  x0: number;
  y0: number | null;
}) => {
  const W = 600, H = 230, M = 40;
  const IN_Y = 46, OUT_Y = 186;
  const { yMin, yMax } = samples;
  const px = (x: number) => scale(x, [X_MIN, X_MAX], [M, W - M]);
  const pOut = (y: number) => scale(y, [yMin, yMax], [M, W - M]);

  const rays = [];
  for (let i = 0; i <= MAP_SAMPLES; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / MAP_SAMPLES;
    let y: number | null = null;
    try {
      const v = compiled.evaluate({ x });
      if (typeof v === "number" && isFinite(v)) y = v;
    } catch {
      // skip points where f is undefined
    }
    if (y === null || y < yMin || y > yMax) continue;
    rays.push({ x, y, color: sampleColor(i, MAP_SAMPLES) });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* Rays from input to output */}
      {rays.map((r, i) => (
        <line key={i} x1={px(r.x)} y1={IN_Y + 5} x2={pOut(r.y)} y2={OUT_Y - 5} stroke={r.color} strokeWidth={1.2} opacity={0.55} />
      ))}
      {/* Input line */}
      <line x1={M} y1={IN_Y} x2={W - M} y2={IN_Y} stroke="#374151" strokeWidth={2} />
      <text x={M - 8} y={IN_Y + 4} textAnchor="end" fontSize={12} fill="#374151" fontWeight={600}>x</text>
      {[X_MIN, 0, X_MAX].map((x) => (
        <g key={`in${x}`}>
          <line x1={px(x)} y1={IN_Y - 5} x2={px(x)} y2={IN_Y + 5} stroke="#374151" strokeWidth={1.5} />
          <text x={px(x)} y={IN_Y - 10} textAnchor="middle" fontSize={11} fill="#6b7280">{x}</text>
        </g>
      ))}
      {rays.map((r, i) => (
        <circle key={`ind${i}`} cx={px(r.x)} cy={IN_Y} r={3} fill={r.color} />
      ))}
      {/* Output line */}
      <line x1={M} y1={OUT_Y} x2={W - M} y2={OUT_Y} stroke="#374151" strokeWidth={2} />
      <text x={M - 8} y={OUT_Y + 4} textAnchor="end" fontSize={12} fill="#374151" fontWeight={600}>f(x)</text>
      {[yMin, (yMin + yMax) / 2, yMax].map((y, i) => (
        <g key={`out${i}`}>
          <line x1={pOut(y)} y1={OUT_Y - 5} x2={pOut(y)} y2={OUT_Y + 5} stroke="#374151" strokeWidth={1.5} />
          <text x={pOut(y)} y={OUT_Y + 20} textAnchor="middle" fontSize={11} fill="#6b7280">{y.toFixed(1)}</text>
        </g>
      ))}
      {rays.map((r, i) => (
        <circle key={`outd${i}`} cx={pOut(r.y)} cy={OUT_Y} r={3} fill={r.color} />
      ))}
      {/* Highlighted x₀ ray */}
      {y0 !== null && y0 >= yMin && y0 <= yMax && (
        <g>
          <line x1={px(x0)} y1={IN_Y} x2={pOut(y0)} y2={OUT_Y} stroke="#F59E0B" strokeWidth={2.5} />
          <circle cx={px(x0)} cy={IN_Y} r={5} fill="#F59E0B" stroke="#fff" strokeWidth={1.5} />
          <circle cx={pOut(y0)} cy={OUT_Y} r={5} fill="#F59E0B" stroke="#fff" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
};

const EquationBuilderTool = () => {
  const [tokens, setTokens] = useState<Token[]>(() => toTokens(EXAMPLES[0].defs));
  const [x0, setX0] = useState(1);

  const exprString = tokens.map((t) => t.expr).join(" ");

  const { compiled, error } = useMemo(() => {
    if (tokens.length === 0) return { compiled: null, error: "Drag or click symbols to build an equation." };
    try {
      const c = math.compile(exprString);
      c.evaluate({ x: 1.2345 }); // probe so syntax AND evaluation errors surface now
      return { compiled: c, error: null };
    } catch (e) {
      return { compiled: null, error: e instanceof Error ? e.message : "Invalid expression" };
    }
  }, [exprString, tokens.length]);

  const samples = useMemo(() => sampleFunction(compiled, GRAPH_SAMPLES), [compiled]);

  const y0 = useMemo(() => {
    if (!compiled) return null;
    try {
      const v = compiled.evaluate({ x: x0 });
      return typeof v === "number" && isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }, [compiled, x0]);

  // --- Drag & drop ---
  const onPaletteDragStart = (e: DragEvent, def: TokenDef) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "palette", def }));
  };
  const onTokenDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "strip", id }));
  };

  // Insert (from palette) or move (within the strip) at targetIndex; null = end
  const handleDrop = (e: DragEvent, targetIndex: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    let data: { type: string; def?: TokenDef; id?: string };
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    setTokens((prev) => {
      const next = [...prev];
      if (data.type === "palette" && data.def) {
        next.splice(targetIndex ?? next.length, 0, makeToken(data.def));
      } else if (data.type === "strip" && data.id) {
        const from = next.findIndex((t) => t.id === data.id);
        if (from === -1) return prev;
        const [moved] = next.splice(from, 1);
        let to = targetIndex ?? next.length;
        if (targetIndex !== null && from < targetIndex) to -= 1;
        next.splice(to, 0, moved);
      }
      return next;
    });
  };

  const appendToken = (def: TokenDef) => setTokens((prev) => [...prev, makeToken(def)]);
  const removeToken = (id: string) => setTokens((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        {/* Equation builder */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Build an Equation</CardTitle>
            <p className="text-xs text-muted-foreground">
              Click a symbol to append it, drag to insert or reorder, click a symbol in the equation to remove it.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Equation strip */}
            <div
              className="flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-md border-2 border-dashed border-border bg-muted/40 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, null)}
            >
              <span className="mr-1 font-mono text-sm text-muted-foreground">f(x) =</span>
              {tokens.length === 0 && (
                <span className="text-sm text-muted-foreground">drop symbols here…</span>
              )}
              {tokens.map((token, i) => (
                <button
                  key={token.id}
                  draggable
                  onDragStart={(e) => onTokenDragStart(e, token.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, i)}
                  onClick={() => removeToken(token.id)}
                  title="Click to remove, drag to reorder"
                  className="cursor-grab rounded-md border border-primary/40 bg-background px-2.5 py-1 font-mono text-sm shadow-sm transition-colors hover:border-destructive hover:bg-destructive/10 active:cursor-grabbing"
                >
                  {token.label}
                </button>
              ))}
            </div>

            {error ? (
              <p className="text-sm text-destructive">⚠ {error}</p>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">parsed: {exprString}</p>
            )}

            {/* Palette */}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {PALETTE.map((group) => (
                <div key={group.group}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.group}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.items.map((def) => (
                      <button
                        key={def.label}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, def)}
                        onClick={() => appendToken(def)}
                        className="cursor-grab rounded-md border border-border bg-card px-2.5 py-1 font-mono text-sm shadow-sm transition-colors hover:border-primary hover:bg-primary/10 active:cursor-grabbing"
                      >
                        {def.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Examples + clear */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Examples:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.name}
                  onClick={() => setTokens(toTokens(ex.defs))}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs transition-colors hover:border-primary hover:bg-primary/10"
                >
                  {ex.name}
                </button>
              ))}
              <button
                onClick={() => setTokens([])}
                className="ml-auto rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              >
                Clear
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Visualizations */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Graph: y = f(x)</CardTitle>
            </CardHeader>
            <CardContent>
              {samples ? (
                <FunctionGraph samples={samples} x0={x0} y0={y0} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Build a valid equation to see its graph.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Input Space → Output Space</CardTitle>
              <p className="text-xs text-muted-foreground">
                Each colored point on the x line is carried to f(x) on the output line — watch
                where the function stretches, squashes, and folds the number line.
              </p>
            </CardHeader>
            <CardContent>
              {samples && compiled ? (
                <>
                  <MappingView compiled={compiled} samples={samples} x0={x0} y0={y0} />
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor="x0-slider" className="text-xs text-muted-foreground">
                      probe x₀
                    </label>
                    <input
                      id="x0-slider"
                      type="range"
                      min={X_MIN}
                      max={X_MAX}
                      step={0.05}
                      value={x0}
                      onChange={(e) => setX0(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                    <span className="w-40 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      f({x0.toFixed(2)}) = {y0 !== null ? y0.toFixed(3) : "undefined"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Build a valid equation to see how it maps space.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default EquationBuilderTool;
