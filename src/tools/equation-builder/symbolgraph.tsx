/**
 * The dependency canvas at the top of the symbol book: symbols as chips,
 * "x drives y" as an arrow flowing DOWN from independents to dependents.
 * Solid amber arrows are declared knowledge (SymbolRecord.dependsOn); dashed
 * sky arrows are the app's structural guess, shown only for symbols with no
 * declaration. Dragging one chip onto another declares an arrow; clicking a
 * dashed arrow confirms it; clicking a solid arrow cuts it. The graph shape
 * is what decides how differentiation reads the relation.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface GraphEdge {
  /** the symbol that moves on its own */
  from: string;
  /** the symbol that responds */
  to: string;
  declared: boolean;
}

interface Props {
  /** symbol names in display order */
  names: string[];
  edges: GraphEdge[];
  onDeclare: (from: string, to: string) => void;
  onCut: (from: string, to: string) => void;
}

const NODE_HALF_W = 26;
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

export const SymbolDependencyGraph = ({ names, edges, onDeclare, onCut }: Props) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
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
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ from: name, ...localPoint(event) });
  };
  const onNodeMove = (event: ReactPointerEvent) => {
    if (drag) setDrag({ ...drag, ...localPoint(event) });
  };
  const onNodeUp = (event: ReactPointerEvent) => {
    if (!drag) return;
    const from = drag.from;
    setDrag(null);
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-graph-node]");
    const to = target?.dataset.graphNode;
    if (!to || to === from) return;
    if (wouldCycle(edges, from, to)) {
      shake(to);
      return;
    }
    onDeclare(from, to);
  };

  const arrowPath = (from: string, to: string): string => {
    const a = positions.get(from)!;
    const b = positions.get(to)!;
    const ax = a.x;
    const ay = a.y + NODE_HALF_H;
    const bx = b.x;
    const by = b.y - NODE_HALF_H - 6;
    const bend = (bx - ax) / 3;
    return `M ${ax} ${ay} C ${ax + bend} ${ay + 26}, ${bx - bend} ${by - 26}, ${bx} ${by}`;
  };

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
        {edges.map((edge) => (
          <g key={`${edge.from}->${edge.to}`}>
            <path
              d={arrowPath(edge.from, edge.to)}
              fill="none"
              strokeWidth={1.8}
              strokeDasharray={edge.declared ? undefined : "5 4"}
              className={edge.declared ? "stroke-amber-500" : "stroke-sky-400"}
              markerEnd={edge.declared ? "url(#dep-arrow-declared)" : "url(#dep-arrow-guess)"}
            />
            <path
              d={arrowPath(edge.from, edge.to)}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              className="cursor-pointer"
              role="button"
              aria-label={
                edge.declared
                  ? `Stop declaring that ${edge.to} depends on ${edge.from}`
                  : `Confirm that ${edge.to} depends on ${edge.from}`
              }
              onClick={() => (edge.declared ? onCut(edge.from, edge.to) : onDeclare(edge.from, edge.to))}
            >
              <title>
                {edge.declared
                  ? `${edge.to} depends on ${edge.from} — click to cut`
                  : `the app's guess: ${edge.to} depends on ${edge.from} — click to confirm`}
              </title>
            </path>
          </g>
        ))}
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
      {names.map((name) => {
        const p = positions.get(name)!;
        const signature = signatureOf(name);
        return (
          <div
            key={name}
            data-graph-node={name}
            onPointerDown={onNodeDown(name)}
            className={`absolute flex min-h-9 min-w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-lg border bg-card px-2 font-serif text-lg italic shadow-sm transition-colors active:cursor-grabbing ${
              shakeName === name
                ? "border-rose-400 ring-2 ring-rose-300"
                : signature
                  ? "border-amber-300"
                  : "border-border"
            }`}
            style={{
              left: `${(p.x / width) * 100}%`,
              top: `${(p.y / height) * 100}%`,
            }}
            title={`Drag onto another symbol: “${name} drives it”`}
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
