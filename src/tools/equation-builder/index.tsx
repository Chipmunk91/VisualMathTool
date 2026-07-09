import { useMemo, useState, DragEvent } from "react";

/**
 * Equation Playground — a single large equation whose symbols are live
 * objects. Hover a term to highlight it; drag it across the equals sign
 * and its sign flips (like moving terms when solving by hand). When the
 * equation reaches a·x = b, click the coefficient to divide both sides.
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

/** The magnitude part of a term ("2x", "x", "7") — sign is rendered separately */
function termBody(t: Term): string {
  const mag = Math.abs(t.coef);
  if (!t.hasX) return formatNumber(mag);
  if (mag === 1) return "x";
  return `${formatNumber(mag)}x`;
}

const EquationBuilderTool = () => {
  const [presetIndex, setPresetIndex] = useState(0);
  const [equation, setEquation] = useState<EquationState>(() => PRESETS[0].make());
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [dragging, setDragging] = useState(false);

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

  const moveTerm = (id: string, from: Side, to: Side) => {
    if (from === to) return;
    setEquation((prev) => {
      const source = [...prev[from]];
      const index = source.findIndex((t) => t.id === id);
      if (index === -1) return prev;
      const [moved] = source.splice(index, 1);
      // Keep "0" on a side that just lost its last term
      const target = [...prev[to], term(-moved.coef, moved.hasX)];
      const next = { ...prev, [from]: combine(source), [to]: combine(target) };
      return next;
    });
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
  };

  const loadPreset = (index: number) => {
    setPresetIndex(index);
    setEquation(PRESETS[index].make());
  };

  // --- Drag & drop ---
  const onDragStart = (e: DragEvent, id: string, from: Side) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({ id, from }));
    setDragging(true);
  };
  const onDrop = (e: DragEvent, to: Side) => {
    e.preventDefault();
    setDragOver(null);
    setDragging(false);
    try {
      const { id, from } = JSON.parse(e.dataTransfer.getData("text/plain"));
      moveTerm(id, from, to);
    } catch {
      // not a term drag — ignore
    }
  };

  const renderSide = (terms: Term[], side: Side) => (
    <span
      className={`inline-flex items-baseline gap-3 rounded-xl px-3 py-1 transition-colors ${
        dragOver === side ? "bg-amber-100/80 ring-2 ring-amber-300" : dragging ? "bg-muted/60" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(side);
      }}
      onDragLeave={() => setDragOver((cur) => (cur === side ? null : cur))}
      onDrop={(e) => onDrop(e, side)}
    >
      {terms.map((t, i) => {
        const isDivideCoef = divideCandidate?.xSide === side && t.hasX;
        return (
          <span key={t.id} className="inline-flex items-baseline gap-3">
            {/* Operator between terms; leading minus is part of the first term */}
            {i > 0 && <span className="select-none text-muted-foreground">{t.coef < 0 ? "−" : "+"}</span>}
            <span
              draggable
              onDragStart={(e) => onDragStart(e, t.id, side)}
              onDragEnd={() => {
                setDragging(false);
                setDragOver(null);
              }}
              title="Drag me to the other side of the equals sign"
              className="cursor-grab select-none rounded-lg px-1 transition-colors duration-150 hover:bg-amber-100 hover:text-amber-600 active:cursor-grabbing"
            >
              {i === 0 && t.coef < 0 && "−"}
              {isDivideCoef && Math.abs(t.coef) !== 1 ? (
                <>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      divideBoth();
                    }}
                    title={`Click to divide both sides by ${formatNumber(Math.abs(t.coef))}`}
                    className="cursor-pointer rounded px-0.5 text-sky-600 underline decoration-sky-300 decoration-2 underline-offset-8 transition-colors hover:bg-sky-100"
                  >
                    {formatNumber(Math.abs(t.coef))}
                  </span>
                  <span className="italic">x</span>
                </>
              ) : t.hasX ? (
                <>
                  {Math.abs(t.coef) !== 1 && formatNumber(Math.abs(t.coef))}
                  <span className="italic">x</span>
                </>
              ) : (
                termBody(t)
              )}
            </span>
          </span>
        );
      })}
    </span>
  );

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-background text-foreground">
      {/* The equation */}
      <div
        className={`font-serif text-6xl tracking-wide transition-colors duration-300 sm:text-7xl ${
          solved ? "text-emerald-600" : ""
        }`}
      >
        {renderSide(left, "left")}
        <span className="mx-4 select-none">=</span>
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
        ) : (
          <span>Drag a term across the equals sign — its sign flips.</span>
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
    </div>
  );
};

export default EquationBuilderTool;
