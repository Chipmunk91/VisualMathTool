import { useMemo, useRef, useState, DragEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Equation Playground — a single large equation whose symbols are live
 * objects. Hovering highlights the symbol itself (not a block). Dragging
 * on empty space sweeps a selection region: symbols inside it light up as
 * a selected block that can be dragged across the equals sign together.
 * Crossing the equals sign flips signs; at a·x = b the coefficient is
 * clickable to divide both sides.
 */

interface Term {
  id: string;
  coef: number;
  hasX: boolean;
}

type Side = "left" | "right";

interface EquationState {
  left: Term[];
  right: Term[];
}

let termCounter = 0;
const term = (coef: number, hasX = false): Term => ({
  id: `term-${termCounter++}`,
  coef,
  hasX,
});

interface Preset {
  name: string;
  make: () => EquationState;
}

const PRESETS: Preset[] = [
  { name: "2x − 3 = −7", make: () => ({ left: [term(2, true), term(-3)], right: [term(-7)] }) },
  { name: "5x + 4 = 3x", make: () => ({ left: [term(5, true), term(4)], right: [term(3, true)] }) },
  { name: "4 − x = 2x + 1", make: () => ({ left: [term(4), term(-1, true)], right: [term(2, true), term(1)] }) },
  { name: "3x + 5 = x − 9", make: () => ({ left: [term(3, true), term(5)], right: [term(1, true), term(-9)] }) },
];

/** Merge like terms on a side: ax-terms together, constants together */
function combine(terms: Term[]): Term[] {
  const xCoef = terms.filter((t) => t.hasX).reduce((s, t) => s + t.coef, 0);
  const constant = terms.filter((t) => !t.hasX).reduce((s, t) => s + t.coef, 0);
  const result: Term[] = [];
  if (xCoef !== 0) result.push(term(xCoef, true));
  if (constant !== 0) result.push(term(constant));
  if (result.length === 0) result.push(term(0));
  return result;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Try small fractions before falling back to decimals
  for (let den = 2; den <= 12; den++) {
    const num = value * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) {
      return `${Math.round(num)}/${den}`;
    }
  }
  return value.toFixed(2);
}

/** One term broken into visual symbols: sign/operator, coefficient, variable */
interface SymbolSpec {
  key: string;
  termId: string;
  text: string;
  kind: "op" | "num" | "var";
  isCoef?: boolean; // the coefficient of an x-term (divide target)
}

function sideSymbols(terms: Term[]): SymbolSpec[] {
  const symbols: SymbolSpec[] = [];
  terms.forEach((t, i) => {
    if (i > 0) {
      symbols.push({ key: `${t.id}-op`, termId: t.id, text: t.coef < 0 ? "−" : "+", kind: "op" });
    } else if (t.coef < 0) {
      symbols.push({ key: `${t.id}-neg`, termId: t.id, text: "−", kind: "op" });
    }
    const mag = Math.abs(t.coef);
    if (t.hasX) {
      if (mag !== 1) {
        symbols.push({ key: `${t.id}-coef`, termId: t.id, text: formatNumber(mag), kind: "num", isCoef: true });
      }
      symbols.push({ key: `${t.id}-x`, termId: t.id, text: "x", kind: "var" });
    } else {
      symbols.push({ key: `${t.id}-num`, termId: t.id, text: formatNumber(mag), kind: "num" });
    }
  });
  return symbols;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EquationBuilderTool = () => {
  const [presetIndex, setPresetIndex] = useState(0);
  const [equation, setEquation] = useState<EquationState>(() => PRESETS[0].make());
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<{ side: Side; termIds: string[] } | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const equationRef = useRef<HTMLDivElement>(null);

  const { left, right } = equation;

  // a·x = b (or b = a·x) with |a| ≠ 1 → the coefficient is clickable to divide
  const divideCandidate = useMemo(() => {
    const check = (xSide: Term[], constSide: Term[]) =>
      xSide.length === 1 &&
      xSide[0].hasX &&
      Math.abs(xSide[0].coef) !== 1 &&
      xSide[0].coef !== 0 &&
      constSide.length === 1 &&
      !constSide[0].hasX;
    if (check(left, right)) return { xSide: "left" as Side };
    if (check(right, left)) return { xSide: "right" as Side };
    return null;
  }, [left, right]);

  const solved = useMemo(() => {
    const check = (a: Term[], b: Term[]) =>
      a.length === 1 && a[0].hasX && a[0].coef === 1 && b.length === 1 && !b[0].hasX;
    return check(left, right) || check(right, left);
  }, [left, right]);

  const solvedValue = solved
    ? formatNumber((left[0].hasX ? right : left)[0].coef)
    : null;

  const moveTerms = (ids: string[], from: Side, to: Side) => {
    if (from === to) return;
    setEquation((prev) => {
      const source = [...prev[from]];
      const moved: Term[] = [];
      for (const id of ids) {
        const index = source.findIndex((t) => t.id === id);
        if (index !== -1) moved.push(...source.splice(index, 1));
      }
      if (moved.length === 0) return prev;
      const target = [...prev[to], ...moved.map((m) => term(-m.coef, m.hasX))];
      return { ...prev, [from]: combine(source), [to]: combine(target) } as EquationState;
    });
    setSelection(null);
  };

  const divideBoth = () => {
    if (!divideCandidate) return;
    setEquation((prev) => {
      const xSide = divideCandidate.xSide;
      const constSide: Side = xSide === "left" ? "right" : "left";
      const a = prev[xSide][0].coef;
      return {
        ...prev,
        [xSide]: [term(1, true)],
        [constSide]: [term(prev[constSide][0].coef / a)],
      } as EquationState;
    });
    setSelection(null);
  };

  const loadPreset = (index: number) => {
    setPresetIndex(index);
    setEquation(PRESETS[index].make());
    setSelection(null);
  };

  // --- Marquee (drag-to-select a block of symbols on empty space) ---
  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-symbol]")) return; // symbol drags are HTML5 dnd
    const x0 = e.clientX;
    const y0 = e.clientY;
    setSelection(null);

    const move = (ev: PointerEvent) => {
      setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);

      const rect = {
        left: Math.min(x0, ev.clientX),
        right: Math.max(x0, ev.clientX),
        top: Math.min(y0, ev.clientY),
        bottom: Math.max(y0, ev.clientY),
      };
      // A tiny sweep is just a click — clear selection and stop
      if (rect.right - rect.left < 8 && rect.bottom - rect.top < 8) return;

      // Collect the terms whose symbols intersect the region, per side
      const hits: Record<Side, Set<string>> = { left: new Set(), right: new Set() };
      const spans = equationRef.current?.querySelectorAll<HTMLElement>("[data-symbol]") ?? [];
      spans.forEach((span) => {
        const b = span.getBoundingClientRect();
        const overlaps = b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top;
        if (!overlaps) return;
        const side = span.dataset.side as Side;
        const termId = span.dataset.termId;
        if (side && termId) hits[side].add(termId);
      });

      // A block lives on one side of the equation — take the side with more hits
      const side: Side = hits.left.size >= hits.right.size ? "left" : "right";
      if (hits[side].size === 0) return;
      setSelection({ side, termIds: Array.from(hits[side]) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- Drag & drop of symbols / selected blocks ---
  const onSymbolDragStart = (e: DragEvent, termId: string, side: Side) => {
    const ids =
      selection && selection.side === side && selection.termIds.includes(termId)
        ? selection.termIds
        : [termId];
    e.dataTransfer.setData("text/plain", JSON.stringify({ ids, from: side }));
    setDragging(true);
  };
  const onDrop = (e: DragEvent, to: Side) => {
    e.preventDefault();
    setDragOver(null);
    setDragging(false);
    try {
      const { ids, from } = JSON.parse(e.dataTransfer.getData("text/plain"));
      moveTerms(ids, from, to);
    } catch {
      // not a symbol drag — ignore
    }
  };

  const renderSide = (terms: Term[], side: Side) => {
    const symbols = sideSymbols(terms);
    return (
      <span
        className={`inline-flex items-baseline rounded-xl px-2 py-1 transition-shadow ${
          dragOver === side ? "ring-2 ring-amber-300" : dragging ? "ring-1 ring-border" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(side);
        }}
        onDragLeave={() => setDragOver((cur) => (cur === side ? null : cur))}
        onDrop={(e) => onDrop(e, side)}
      >
        {symbols.map((sym) => {
          const isSelected = selection?.side === side && selection.termIds.includes(sym.termId);
          const isDivideCoef = sym.isCoef && divideCandidate?.xSide === side;
          const base =
            "cursor-grab select-none transition-colors duration-150 active:cursor-grabbing";
          const spacing = sym.kind === "op" ? "mx-4" : "";
          const italic = sym.kind === "var" ? "italic" : "";
          const color = isDivideCoef
            ? "text-sky-600 underline decoration-sky-300 decoration-2 underline-offset-8 hover:text-sky-500 cursor-pointer"
            : isSelected
              ? "text-amber-500"
              : "hover:text-amber-500";
          return (
            <span
              key={sym.key}
              data-symbol
              data-term-id={sym.termId}
              data-side={side}
              draggable
              onDragStart={(e) => onSymbolDragStart(e, sym.termId, side)}
              onDragEnd={() => {
                setDragging(false);
                setDragOver(null);
              }}
              onClick={isDivideCoef ? (e) => { e.stopPropagation(); divideBoth(); } : undefined}
              title={
                isDivideCoef
                  ? `Click to divide both sides by ${sym.text}`
                  : "Drag across the equals sign — or sweep empty space to select a block"
              }
              className={`${base} ${spacing} ${italic} ${color}`}
            >
              {sym.text}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center bg-background text-foreground"
      onPointerDown={onBackgroundPointerDown}
    >
      {/* The equation */}
      <div
        ref={equationRef}
        className={`font-serif text-6xl tracking-wide transition-colors duration-300 sm:text-7xl ${
          solved ? "text-emerald-600" : ""
        }`}
      >
        {renderSide(left, "left")}
        <span className="mx-5 select-none">=</span>
        {renderSide(right, "right")}
      </div>

      {/* State line: hint or solved message */}
      <div className="mt-10 h-6 text-sm text-muted-foreground">
        {solved ? (
          <span className="font-medium text-emerald-600">Solved — x = {solvedValue}</span>
        ) : divideCandidate ? (
          <span>
            Click the <span className="text-sky-600">coefficient</span> to divide both sides.
          </span>
        ) : selection ? (
          <span>
            <span className="text-amber-500">Block selected</span> — drag it across the equals sign.
          </span>
        ) : (
          <span>Drag a symbol across the equals sign, or sweep empty space to select a block.</span>
        )}
      </div>

      {/* Presets + reset, kept out of the way */}
      <div className="absolute bottom-6 flex flex-wrap items-center justify-center gap-2 px-4">
        {PRESETS.map((preset, i) => (
          <button
            key={preset.name}
            onClick={() => loadPreset(i)}
            className={`rounded-full border px-3 py-1 font-serif text-sm transition-colors ${
              i === presetIndex
                ? "border-foreground/40 bg-muted"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {preset.name}
          </button>
        ))}
        <button
          onClick={() => loadPreset(presetIndex)}
          className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Reset the current equation"
        >
          ↺ Reset
        </button>
      </div>

      {/* Marquee rectangle while sweeping */}
      {marquee && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-amber-400 bg-amber-200/20"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </div>
  );
};

export default EquationBuilderTool;
