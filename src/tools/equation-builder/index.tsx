import { useMemo, useRef, useState, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

/**
 * Equation Playground — a single large equation whose symbols are live
 * objects. Hover highlights the symbol itself; sweeping empty space
 * selects a block. Moves:
 *   - drag a term across "=" → it moves with its sign flipped
 *   - drag the (blue) coefficient of a lone a·x across → divides both
 *     sides, results shown as stacked fractions
 *   - drag a fraction's denominator across → multiplies both sides
 */

// Terms carry exact rational coefficients: value = num/den, den > 0, reduced
interface Term {
  id: string;
  num: number;
  den: number;
  hasX: boolean;
}

type Side = "left" | "right";

interface EquationState {
  left: Term[];
  right: Term[];
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

function reduce(num: number, den: number): { num: number; den: number } {
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(Math.abs(num), den) || 1;
  return { num: num / g, den: den / g };
}

let termCounter = 0;
const term = (num: number, hasX = false, den = 1): Term => ({
  id: `term-${termCounter++}`,
  ...reduce(num, den),
  hasX,
});

interface Preset {
  name: string;
  make: () => EquationState;
}

const PRESETS: Preset[] = [
  { name: "2x − 3 = −7", make: () => ({ left: [term(2, true), term(-3)], right: [term(-7)] }) },
  { name: "2x + 4 = −3", make: () => ({ left: [term(2, true), term(4)], right: [term(-3)] }) },
  { name: "5x + 4 = 3x", make: () => ({ left: [term(5, true), term(4)], right: [term(3, true)] }) },
  { name: "4 − x = 2x + 1", make: () => ({ left: [term(4), term(-1, true)], right: [term(2, true), term(1)] }) },
];

/** Merge like terms on a side with exact rational arithmetic */
function combine(terms: Term[]): Term[] {
  const sum = (group: Term[]) =>
    group.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const x = sum(terms.filter((t) => t.hasX));
  const constant = sum(terms.filter((t) => !t.hasX));
  const result: Term[] = [];
  if (x.num !== 0) result.push(term(x.num, true, x.den));
  if (constant.num !== 0) result.push(term(constant.num, false, constant.den));
  if (result.length === 0) result.push(term(0));
  return result;
}

const EquationBuilderTool = () => {
  const [presetIndex, setPresetIndex] = useState(0);
  const [equation, setEquation] = useState<EquationState>(() => PRESETS[0].make());
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<{ side: Side; termIds: string[] } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equationRef = useRef<HTMLDivElement>(null);

  const { left, right } = equation;

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  };

  // The coefficient of a lone a·x (|a| ≠ 1) is draggable to divide both sides
  const divideSide: Side | null = useMemo(() => {
    const alone = (side: Term[]) =>
      side.length === 1 && side[0].hasX && !(Math.abs(side[0].num) === 1 && side[0].den === 1) && side[0].num !== 0;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  const hasFraction = useMemo(
    () => [...left, ...right].some((t) => t.den !== 1),
    [left, right]
  );

  const solved = useMemo(() => {
    const check = (a: Term[], b: Term[]) =>
      a.length === 1 && a[0].hasX && a[0].num === 1 && a[0].den === 1 && b.length === 1 && !b[0].hasX;
    return check(left, right) || check(right, left);
  }, [left, right]);

  const formatValue = (t: Term) => (t.den === 1 ? String(t.num) : `${t.num}/${t.den}`);
  const solvedValue = solved ? formatValue((left[0].hasX ? right : left)[0]) : null;

  // --- Algebra moves ---
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
      const target = [...prev[to], ...moved.map((m) => term(-m.num, m.hasX, m.den))];
      return { ...prev, [from]: combine(source), [to]: combine(target) } as EquationState;
    });
    setSelection(null);
    setNotice(null);
  };

  /** Divide every term on both sides by the signed coefficient of the lone x-term */
  const divideByCoefficient = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const xTerm = equation[from].find((t) => t.id === termId);
    if (!xTerm?.hasX) return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the x term must be alone to divide.");
      return;
    }
    const a = { num: xTerm.num, den: xTerm.den };
    if (a.num === 0) return;
    setEquation((prev) => {
      const divide = (t: Term) => term(t.num * a.den, t.hasX, t.den * a.num);
      return { left: combine(prev.left.map(divide)), right: combine(prev.right.map(divide)) };
    });
    setSelection(null);
    setNotice(null);
  };

  /** Multiply every term on both sides by a fraction's denominator */
  const multiplyByDenominator = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.den === 1) return;
    const d = source.den;
    setEquation((prev) => {
      const multiply = (t: Term) => term(t.num * d, t.hasX, t.den);
      return { left: combine(prev.left.map(multiply)), right: combine(prev.right.map(multiply)) };
    });
    setSelection(null);
    setNotice(null);
  };

  const loadPreset = (index: number) => {
    setPresetIndex(index);
    setEquation(PRESETS[index].make());
    setSelection(null);
    setNotice(null);
  };

  // --- Marquee (drag-to-select a block of symbols on empty space) ---
  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-symbol]")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setSelection(null);

    const move = (ev: PointerEvent) => setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
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
      if (rect.right - rect.left < 8 && rect.bottom - rect.top < 8) return;

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

      const side: Side = hits.left.size >= hits.right.size ? "left" : "right";
      if (hits[side].size === 0) return;
      setSelection({ side, termIds: Array.from(hits[side]) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- Drag & drop ---
  type DragPayload =
    | { kind: "terms"; ids: string[]; from: Side }
    | { kind: "coef"; termId: string; from: Side }
    | { kind: "den"; termId: string; from: Side };

  const startDrag = (e: DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    setDragging(true);
  };

  const onSymbolDragStart = (e: DragEvent, termId: string, side: Side, role: "term" | "coef" | "den") => {
    // A selected block always moves as a whole, whatever symbol is grabbed
    if (selection && selection.side === side && selection.termIds.includes(termId)) {
      startDrag(e, { kind: "terms", ids: selection.termIds, from: side });
      return;
    }
    if (role === "coef") startDrag(e, { kind: "coef", termId, from: side });
    else if (role === "den") startDrag(e, { kind: "den", termId, from: side });
    else startDrag(e, { kind: "terms", ids: [termId], from: side });
  };

  const onDrop = (e: DragEvent, to: Side) => {
    e.preventDefault();
    setDragOver(null);
    setDragging(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
      if (payload.kind === "terms") moveTerms(payload.ids, payload.from, to);
      else if (payload.kind === "coef") divideByCoefficient(payload.termId, payload.from, to);
      else if (payload.kind === "den") multiplyByDenominator(payload.termId, payload.from, to);
    } catch {
      // not a symbol drag — ignore
    }
  };

  // --- Rendering ---
  const symbolClass = (opts: { selected: boolean; blue?: boolean }) => {
    const base = "cursor-grab select-none transition-colors duration-150 active:cursor-grabbing";
    if (opts.blue) return `${base} text-sky-600 hover:text-sky-400`;
    if (opts.selected) return `${base} text-amber-500`;
    return `${base} hover:text-amber-500`;
  };

  interface SymProps {
    termId: string;
    side: Side;
    role: "term" | "coef" | "den";
    selected: boolean;
    blue?: boolean;
    title?: string;
    className?: string;
    children: ReactNode;
  }
  const Sym = ({ termId, side, role, selected, blue, title, className = "", children }: SymProps) => (
    <span
      data-symbol
      data-term-id={termId}
      data-side={side}
      draggable
      onDragStart={(e) => onSymbolDragStart(e, termId, side, role)}
      onDragEnd={() => {
        setDragging(false);
        setDragOver(null);
      }}
      title={title ?? "Drag across the equals sign — or sweep empty space to select a block"}
      className={`${symbolClass({ selected, blue })} ${className}`}
    >
      {children}
    </span>
  );

  /** Stacked fraction: numerator moves the term, denominator multiplies both sides */
  const Fraction = ({ t, side, selected, numText }: { t: Term; side: Side; selected: boolean; numText: string }) => (
    <span className="inline-flex flex-col items-center self-center text-[0.55em] leading-tight">
      <Sym termId={t.id} side={side} role="term" selected={selected}>
        {numText}
      </Sym>
      <span className="my-0.5 h-[0.06em] w-full min-w-[1.2em] rounded bg-current" aria-hidden />
      <Sym
        termId={t.id}
        side={side}
        role="den"
        selected={selected}
        blue
        title={`Drag the denominator across to multiply both sides by ${t.den}`}
      >
        {t.den}
      </Sym>
    </span>
  );

  const renderSide = (terms: Term[], side: Side) => (
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
      {terms.map((t, i) => {
        const selected = selection?.side === side && selection.termIds.includes(t.id);
        const magnitude = Math.abs(t.num);
        const showCoef = t.hasX && !(magnitude === 1 && t.den === 1);
        const coefIsBlue = divideSide === side && t.hasX;
        return (
          <span key={t.id} className="inline-flex items-baseline">
            {(i > 0 || t.num < 0) && (
              <Sym termId={t.id} side={side} role="term" selected={!!selected} className={i > 0 ? "mx-4" : "mr-1"}>
                {i > 0 ? (t.num < 0 ? "−" : "+") : "−"}
              </Sym>
            )}
            {t.hasX ? (
              <>
                {showCoef &&
                  (t.den === 1 ? (
                    <Sym
                      termId={t.id}
                      side={side}
                      role="coef"
                      selected={!!selected}
                      blue={coefIsBlue}
                      title={
                        coefIsBlue
                          ? `Drag across the equals sign to divide both sides by ${t.num}`
                          : "Drag across to divide — but the x term must be alone on its side"
                      }
                    >
                      {magnitude}
                    </Sym>
                  ) : (
                    <Fraction t={t} side={side} selected={!!selected} numText={String(magnitude)} />
                  ))}
                <Sym termId={t.id} side={side} role="term" selected={!!selected} className="italic">
                  x
                </Sym>
              </>
            ) : t.den === 1 ? (
              <Sym termId={t.id} side={side} role="term" selected={!!selected}>
                {magnitude}
              </Sym>
            ) : (
              <Fraction t={t} side={side} selected={!!selected} numText={String(magnitude)} />
            )}
          </span>
        );
      })}
    </span>
  );

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center bg-background text-foreground"
      onPointerDown={onBackgroundPointerDown}
    >
      {/* The equation */}
      <div
        ref={equationRef}
        className={`flex items-baseline font-serif text-6xl tracking-wide transition-colors duration-300 sm:text-7xl ${
          solved ? "text-emerald-600" : ""
        }`}
      >
        {renderSide(left, "left")}
        <span className="mx-5 select-none">=</span>
        {renderSide(right, "right")}
      </div>

      {/* State line: notice, solved, or contextual hint */}
      <div className="mt-10 h-6 text-sm text-muted-foreground">
        {notice ? (
          <span className="text-rose-500">{notice}</span>
        ) : solved ? (
          <span className="font-medium text-emerald-600">Solved — x = {solvedValue}</span>
        ) : selection ? (
          <span>
            <span className="text-amber-500">Block selected</span> — drag it across the equals sign.
          </span>
        ) : divideSide ? (
          <span>
            Drag the <span className="text-sky-600">coefficient</span> across the equals sign to divide both sides.
          </span>
        ) : hasFraction ? (
          <span>
            Drag a <span className="text-sky-600">denominator</span> across to multiply both sides.
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
