/**
 * The dependency canvas at the top of the symbol book: symbols as chips,
 * "x drives y" as an arrow flowing DOWN from independents to dependents.
 * Solid amber arrows are declared knowledge (SymbolRecord.dependsOn); dashed
 * sky arrows are the app's structural guess, shown only for symbols with no
 * declaration. Dragging one chip onto another declares an arrow; clicking a
 * dashed arrow confirms it; clicking a solid arrow cuts it.
 *
 * ASKING MODE (a differentiation question is pending): the canvas dims and
 * becomes the answer surface — candidate symbols pulse; tapping one
 * differentiates ALONG it (every path from it moves), tapping an arrow takes
 * the slot partial THROUGH that one arrow (its source per that target,
 * everything else frozen). Hover previews with an energy flow; the parent
 * renders the would-be result.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface GraphEdge {
  /** the symbol that moves on its own */
  from: string;
  /** the symbol that responds */
  to: string;
  declared: boolean;
}

export type AskTarget =
  | { kind: "node"; name: string }
  | { kind: "edge"; from: string; to: string };

interface Props {
  /** symbol names in display order */
  names: string[];
  edges: GraphEdge[];
  onDeclare: (from: string, to: string) => void;
  onCut: (from: string, to: string) => void;
  /** the symbol whose semantic card is open below the canvas */
  selected?: string | null;
  onSelect?: (name: string) => void;
  onHoverSymbol?: (name: string | null) => void;
  /** parameter symbols (no equation occurrence) render dashed */
  parameters?: string[];
  /** a differentiation question is pending — the canvas answers it */
  asking?: boolean;
  /** legal along-symbols (pulse while asking) */
  candidates?: string[];
  /** active preview lighting: the along symbol and everything that moves */
  flow?: { wrt: string; deps: ReadonlySet<string> } | null;
  onAskHover?: (target: AskTarget | null) => void;
  onAskCommit?: (target: AskTarget) => void;
}

const NODE_HALF_H = 22;
const LAYER_HEIGHT = 86;
const TOP_PAD = 40;

/** Topological depth: independents at 0 (top), each dependent below its deepest driver. */
const layerOf = (names: string[], edges: GraphEdge[]): Map<string, number> => {
  const depth = new Map<string, number>(names.map((name) => [name, 0]));
  for (let pass = 0; pass < names.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      const need = (depth.get(edge.from) ?? 0) + 1;
      if ((depth.get(edge.to) ?? 0) < need) {
        depth.set(edge.to, need);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
};

/** Would declaring from→to close a loop? (is `from` already downstream of `to`?) */
export const wouldCycle = (edges: GraphEdge[], from: string, to: string): boolean => {
  if (from === to) return true;
  const downstream = new Set<string>([to]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (edge.declared && downstream.has(edge.from) && !downstream.has(edge.to)) {
        downstream.add(edge.to);
        grew = true;
      }
    }
  }
  return downstream.has(from);
};

export const SymbolDependencyGraph = ({
  names,
  edges,
  onDeclare,
  onCut,
  selected,
  onSelect,
  onHoverSymbol,
  parameters = [],
  asking = false,
  candidates = [],
  flow = null,
  onAskHover,
  onAskCommit,
}: Props) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [shakeName, setShakeName] = useState<string | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layers = layerOf(names, edges);
  const depthMax = Math.max(0, ...Array.from(layers.values()));
  const height = TOP_PAD * 2 + depthMax * LAYER_HEIGHT;
  const width = 320; // viewBox width — the container scales it responsively

  const positions = new Map<string, { x: number; y: number }>();
  for (let level = 0; level <= depthMax; level++) {
    const row = names.filter((name) => layers.get(name) === level);
    row.forEach((name, index) => {
      positions.set(name, {
        x: ((index + 1) / (row.length + 1)) * width,
        y: TOP_PAD + level * LAYER_HEIGHT,
      });
    });
  }

  const signatureOf = (name: string): string | null => {
    const drivers = edges.filter((edge) => edge.declared && edge.to === name).map((edge) => edge.from).sort();
    return drivers.length > 0 ? `${name}(${drivers.join(", ")})` : null;
  };

  const shake = (name: string) => {
    setShakeName(name);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShakeName(null), 450);
  };

  const localPoint = (event: ReactPointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const onNodeDown = (name: string) => (event: ReactPointerEvent) => {
    if (asking) return; // asking mode answers with clicks, not drags
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDrag({ from: name, ...localPoint(event) });
  };
  const onNodeMove = (event: ReactPointerEvent) => {
    if (drag) setDrag({ ...drag, ...localPoint(event) });
  };
  const onNodeUp = (event: ReactPointerEvent) => {
    if (!drag) return;
    const from = drag.from;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setDrag(null);
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-graph-node]");
    const to = target?.dataset.graphNode;
    const moved = !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6;
    if (!moved || to === from) {
      onSelect?.(from); // a tap opens the symbol's card
      return;
    }
    if (!to) return;
    if (wouldCycle(edges, from, to)) {
      shake(to);
      return;
    }
    onDeclare(from, to);
  };

  const arrowPath = (from: string, to: string): string => {
    const a = positions.get(from)!;
    const b = positions.get(to)!;
    const ay = a.y + NODE_HALF_H;
    const by = b.y - NODE_HALF_H - 6;
    const bend = (b.x - a.x) / 3 || 18;
    return `M ${a.x} ${ay} C ${a.x + bend} ${ay + 26}, ${b.x - bend} ${by - 26}, ${b.x} ${by}`;
  };

  const edgeActive = (edge: GraphEdge): boolean =>
    !!flow && (edge.from === flow.wrt || flow.deps.has(edge.from)) && flow.deps.has(edge.to);

  return (
    <div
      ref={canvasRef}
      className="relative w-full touch-none select-none overflow-hidden rounded-xl border border-border bg-background/60"
      style={{ aspectRatio: `${width} / ${height}` }}
      onPointerMove={onNodeMove}
      onPointerUp={onNodeUp}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
        <defs>
          <marker id="dep-arrow-declared" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="fill-amber-500" />
          </marker>
          <marker id="dep-arrow-guess" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="fill-sky-400" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const active = edgeActive(edge);
          const d = arrowPath(edge.from, edge.to);
          return (
            <g key={`${edge.from}->${edge.to}`}>
              <path
                d={d}
                fill="none"
                strokeWidth={active ? 2.6 : 1.8}
                strokeDasharray={edge.declared ? undefined : "5 4"}
                opacity={flow && !active ? 0.3 : 1}
                className={edge.declared ? "stroke-amber-500" : "stroke-sky-400"}
                markerEnd={edge.declared ? "url(#dep-arrow-declared)" : "url(#dep-arrow-guess)"}
              />
              {active &&
                [0, 1, 2].map((wave) => (
                  <circle key={wave} r={3 - wave * 0.6} className="fill-amber-500 motion-reduce:hidden" opacity={0.9 - wave * 0.25}>
                    <animateMotion dur="1.3s" begin={`${wave * 0.18}s`} repeatCount="indefinite" path={d} />
                  </circle>
                ))}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                className="cursor-pointer"
                role="button"
                aria-label={
                  asking
                    ? `Slot partial through ${edge.from} → ${edge.to}`
                    : edge.declared
                      ? `Stop declaring that ${edge.to} depends on ${edge.from}`
                      : `Confirm that ${edge.to} depends on ${edge.from}`
                }
                onClick={() => {
                  if (asking) onAskCommit?.({ kind: "edge", from: edge.from, to: edge.to });
                  else if (edge.declared) onCut(edge.from, edge.to);
                  else onDeclare(edge.from, edge.to);
                }}
                onPointerEnter={asking ? () => onAskHover?.({ kind: "edge", from: edge.from, to: edge.to }) : undefined}
                onPointerLeave={asking ? () => onAskHover?.(null) : undefined}
              >
                <title>
                  {asking
                    ? `∂ through this arrow only — everything else frozen`
                    : edge.declared
                      ? `${edge.to} depends on ${edge.from} — click to cut`
                      : `the app's guess: ${edge.to} depends on ${edge.from} — click to confirm`}
                </title>
              </path>
            </g>
          );
        })}
        {drag && (
          <path
            d={`M ${positions.get(drag.from)!.x} ${positions.get(drag.from)!.y} L ${drag.x} ${drag.y}`}
            fill="none"
            strokeWidth={1.8}
            strokeDasharray="4 4"
            className="stroke-amber-500"
            markerEnd="url(#dep-arrow-declared)"
          />
        )}
      </svg>
      {asking && <div className="pointer-events-none absolute inset-0 bg-background/50" />}
      {names.map((name) => {
        const p = positions.get(name)!;
        const signature = signatureOf(name);
        const isCandidate = asking && candidates.includes(name);
        const isSource = flow?.wrt === name;
        const isLit = !!flow && flow.deps.has(name);
        return (
          <div
            key={name}
            data-graph-node={name}
            onPointerDown={onNodeDown(name)}
            onPointerEnter={() => {
              onHoverSymbol?.(name);
              if (isCandidate) onAskHover?.({ kind: "node", name });
            }}
            onPointerLeave={() => {
              onHoverSymbol?.(null);
              if (isCandidate) onAskHover?.(null);
            }}
            onClick={isCandidate ? () => onAskCommit?.({ kind: "node", name }) : undefined}
            className={`absolute flex min-h-9 min-w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border bg-card px-2 font-serif text-lg italic shadow-sm transition-all ${
              asking ? (isCandidate ? "z-10 cursor-pointer animate-pulse border-amber-400" : "opacity-60") : "cursor-grab active:cursor-grabbing"
            } ${
              shakeName === name
                ? "border-rose-400 ring-2 ring-rose-300"
                : isSource
                  ? "z-10 border-amber-400 ring-4 ring-amber-200 dark:ring-amber-900"
                  : isLit
                    ? "z-10 border-amber-400 bg-amber-50 dark:bg-amber-950/40"
                    : signature
                      ? "border-amber-300"
                      : "border-border"
            } ${parameters.includes(name) ? "border-dashed" : ""} ${selected === name && !asking ? "ring-2 ring-sky-300" : ""}`}
            style={{
              left: `${(p.x / width) * 100}%`,
              top: `${(p.y / height) * 100}%`,
            }}
            title={
              asking
                ? isCandidate
                  ? `Differentiate along ${name} — every path from it moves`
                  : undefined
                : `Tap: open ${name} · drag onto another symbol: “${name} drives it”`
            }
          >
            {name}
            {signature && (
              <span className="absolute top-full mt-0.5 whitespace-nowrap font-serif text-[10px] italic text-muted-foreground">
                {signature}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
