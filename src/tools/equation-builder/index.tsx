import { useMemo, useRef, useState, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { History, TriangleAlert } from "lucide-react";

/**
 * Equation Playground — a single large equation whose symbols are live
 * objects. Every glyph does literally what it is:
 *   - a term (grabbed by its sign, number, or x) crosses "=" with its sign flipped
 *   - a numeral in coefficient position divides both sides by that number
 *   - a leading "−" on a lone term flips the sign of both sides
 *   - a fraction's denominator multiplies both sides by it
 *   - the x of a lone x-term divides both sides by x (dangerous: assumes
 *     x ≠ 0 — remembered in the step history)
 *   - an x in a denominator multiplies both sides by x
 * Drops anywhere route to the opposite side; dropping back on the source
 * side cancels. Every move lands in the step history behind the menu.
 */

// Terms are (num/den) · x^power with den > 0, reduced, power ∈ {-1, 0, 1}
type Power = -1 | 0 | 1;

interface Term {
  id: string;
  num: number;
  den: number;
  power: Power;
}

type Side = "left" | "right";

const opposite = (side: Side): Side => (side === "left" ? "right" : "left");

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
const term = (num: number, power: Power = 0, den = 1): Term => ({
  id: `term-${termCounter++}`,
  ...reduce(num, den),
  power,
});

const cloneState = (state: EquationState): EquationState => ({
  left: state.left.map((t) => ({ ...t })),
  right: state.right.map((t) => ({ ...t })),
});

interface Preset {
  name: string;
  make: () => EquationState;
}

const PRESETS: Preset[] = [
  { name: "2x − 3 = −7", make: () => ({ left: [term(2, 1), term(-3)], right: [term(-7)] }) },
  { name: "2x + 4 = −3", make: () => ({ left: [term(2, 1), term(4)], right: [term(-3)] }) },
  { name: "5x + 4 = 3x", make: () => ({ left: [term(5, 1), term(4)], right: [term(3, 1)] }) },
  { name: "6/x = 2", make: () => ({ left: [term(6, -1)], right: [term(2)] }) },
  { name: "4/x + 1 = 3", make: () => ({ left: [term(4, -1), term(1)], right: [term(3)] }) },
];

/** Merge like terms on a side (grouped by power) with exact rational arithmetic */
function combine(terms: Term[]): Term[] {
  const sum = (group: Term[]) =>
    group.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const result: Term[] = [];
  for (const power of [1, 0, -1] as Power[]) {
    const s = sum(terms.filter((t) => t.power === power));
    if (s.num !== 0) result.push(term(s.num, power, s.den));
  }
  if (result.length === 0) result.push(term(0));
  return result;
}

/** Plain-text rendering of a term's magnitude, for history rows and labels */
function termText(t: Term, leading: boolean): string {
  const sign = t.num < 0 ? "−" : "+";
  const prefix = leading ? (t.num < 0 ? "−" : "") : ` ${sign} `;
  const mag = Math.abs(t.num);
  let body: string;
  if (t.power === 1) {
    const coef = mag === 1 && t.den === 1 ? "" : t.den === 1 ? String(mag) : `(${mag}/${t.den})`;
    body = `${coef}x`;
  } else if (t.power === 0) {
    body = t.den === 1 ? String(mag) : `${mag}/${t.den}`;
  } else {
    body = `${mag}/${t.den === 1 ? "x" : `${t.den}x`}`;
  }
  return prefix + body;
}

const sideText = (terms: Term[]) => terms.map((t, i) => termText(t, i === 0)).join("");
const equationText = (state: EquationState) => `${sideText(state.left)} = ${sideText(state.right)}`;

interface Step {
  id: number;
  label: string;
  note?: string;
  dangerous?: boolean;
  state: EquationState;
  text: string;
}

let stepCounter = 0;
const makeStep = (label: string, state: EquationState, dangerous?: boolean, note?: string): Step => ({
  id: stepCounter++,
  label,
  note,
  dangerous,
  state: cloneState(state),
  text: equationText(state),
});

type Role = "term" | "coef" | "den" | "xdiv" | "xmul" | "neg";

interface SymbolHandlers {
  dragStart: (e: DragEvent, termId: string, side: Side, role: Role) => void;
  dragEnd: () => void;
  hover: (termId: string | null) => void;
}

interface SymProps {
  termId: string;
  side: Side;
  role: Role;
  highlighted: boolean;
  blue?: boolean;
  title?: string;
  className?: string;
  handlers: SymbolHandlers;
  children: ReactNode;
}

/**
 * One interactive symbol. Module-level on purpose: defining this inside the
 * tool component would give it a new identity every render, remounting the
 * DOM node mid-drag and silently cancelling HTML5 drag-and-drop.
 * Hovering any non-blue symbol highlights its whole term (the unit that a
 * drag from here would move); blue symbols are their own affordance.
 */
const Sym = ({ termId, side, role, highlighted, blue, title, className = "", handlers, children }: SymProps) => (
  <span
    data-symbol
    data-term-id={termId}
    data-side={side}
    draggable
    onDragStart={(e) => handlers.dragStart(e, termId, side, role)}
    onDragEnd={handlers.dragEnd}
    onPointerEnter={blue ? undefined : () => handlers.hover(termId)}
    onPointerLeave={blue ? undefined : () => handlers.hover(null)}
    title={title ?? "Drag across the equals sign — or sweep empty space to select a block"}
    className={`cursor-grab select-none transition-colors duration-150 active:cursor-grabbing ${
      blue ? "text-sky-600 hover:text-sky-400" : highlighted ? "text-amber-500" : ""
    } ${className}`}
  >
    {children}
  </span>
);

interface FractionProps {
  termId: string;
  side: Side;
  highlighted: boolean;
  numText: string | number;
  numRole?: Role;
  numBlue?: boolean;
  numTitle?: string;
  denNumber: number | null;
  denX: boolean;
  handlers: SymbolHandlers;
}

/**
 * Stacked fraction, sized and centered to sit on the equation's math axis.
 * Term-highlight is applied to the container so the bar colors with it;
 * blue action glyphs (numerals that divide, denominators that multiply)
 * override via their own color class.
 */
const Fraction = ({
  termId,
  side,
  highlighted,
  numText,
  numRole = "term",
  numBlue,
  numTitle,
  denNumber,
  denX,
  handlers,
}: FractionProps) => (
  <span
    className={`mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none ${
      highlighted ? "text-amber-500" : ""
    }`}
  >
    <Sym
      termId={termId}
      side={side}
      role={numRole}
      highlighted={false}
      blue={numBlue}
      title={numTitle}
      handlers={handlers}
      className="px-[0.15em]"
    >
      {numText}
    </Sym>
    <span className="my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
    <span className="inline-flex items-center">
      {denNumber !== null && (
        <Sym
          termId={termId}
          side={side}
          role="den"
          highlighted={false}
          blue
          handlers={handlers}
          title={`Drag across to multiply both sides by ${denNumber}`}
        >
          {denNumber}
        </Sym>
      )}
      {denX && (
        <Sym
          termId={termId}
          side={side}
          role="xmul"
          highlighted={false}
          blue
          handlers={handlers}
          title="Drag across to multiply both sides by x"
          className="italic"
        >
          x
        </Sym>
      )}
    </span>
  </span>
);

const EquationBuilderTool = () => {
  const [presetIndex, setPresetIndex] = useState(0);
  const [equation, setEquation] = useState<EquationState>(() => PRESETS[0].make());
  const [history, setHistory] = useState<Step[]>(() => [makeStep("start", PRESETS[0].make())]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [selection, setSelection] = useState<{ side: Side; termIds: string[] } | null>(null);
  const [hoveredTermId, setHoveredTermId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equationRef = useRef<HTMLDivElement>(null);

  const { left, right } = equation;

  // The "dangerous switch": some step divided/multiplied by x, so x ≠ 0 is assumed
  const xNonZeroAssumed = useMemo(() => history.some((s) => s.dangerous), [history]);

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  };

  const commitMove = (label: string, next: EquationState, dangerous?: boolean, note?: string) => {
    setEquation(next);
    setHistory((h) => [...h, makeStep(label, next, dangerous, note)]);
    setSelection(null);
    setNotice(null);
  };

  // A lone x-ish term (x or 1/x) whose numeral can be dragged across to divide
  const divideSide: Side | null = useMemo(() => {
    const alone = (side: Term[]) => side.length === 1 && side[0].power !== 0 && Math.abs(side[0].num) > 1;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  // The x of a lone x-term is draggable to divide both sides by x
  const xDivideSide: Side | null = useMemo(() => {
    const alone = (side: Term[]) => side.length === 1 && side[0].power === 1 && side[0].num !== 0;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  // A lone negative term whose leading − can be dragged across to negate both sides
  const negSide: Side | null = useMemo(() => {
    const alone = (side: Term[]) => side.length === 1 && side[0].num < 0;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  /**
   * Strategy coach: recommend the best next move toward isolating x —
   * gather x terms, clear constants off the x side, free x from the
   * denominator, divide the coefficient, clear its denominator, flip the
   * sign — rather than advertising whichever blue handle happens to be lit.
   */
  const coachTip: ReactNode = useMemo(() => {
    const xTerms = (side: Term[]) => side.filter((t) => t.power !== 0 && t.num !== 0);
    const leftX = xTerms(left);
    const rightX = xTerms(right);
    const glyph = (text: ReactNode) => <span className="font-serif text-foreground">{text}</span>;

    // x on both sides → gather them first (move the smaller one)
    if (leftX.length > 0 && rightX.length > 0) {
      const size = (t: Term) => Math.abs(t.num / t.den);
      const candidate = size(leftX[0]) <= size(rightX[0]) ? leftX[0] : rightX[0];
      return <>Get the x terms together — drag {glyph(termText(candidate, true).trim())} across the equals sign.</>;
    }
    if (leftX.length === 0 && rightX.length === 0) {
      return <>No x remains on either side — rewind a step from the history menu (top right).</>;
    }

    const xSide: Side = leftX.length > 0 ? "left" : "right";
    const xTerm = (leftX.length > 0 ? leftX : rightX)[0];

    // Constants sharing the x side → move them away
    const stray = equation[xSide].find((t) => t.power === 0 && t.num !== 0);
    if (stray) {
      return <>Isolate the x term — drag {glyph(termText(stray, true).trim())} across the equals sign.</>;
    }

    // The x-ish term is alone on its side
    if (xTerm.power === -1) {
      return (
        <>
          x is trapped in the denominator — drag the <i className="text-sky-600">x</i> across to multiply both sides.
        </>
      );
    }
    if (Math.abs(xTerm.num) > 1) {
      return (
        <>
          Drag the <span className="text-sky-600">{Math.abs(xTerm.num)}</span> across to divide both sides — or the{" "}
          <i className="text-sky-600">x</i> itself, if you dare.
        </>
      );
    }
    if (xTerm.den > 1) {
      return (
        <>
          Drag the <span className="text-sky-600">{xTerm.den}</span> under the x across to multiply both sides.
        </>
      );
    }
    if (xTerm.num < 0) {
      return (
        <>
          Drag the <span className="text-sky-600">−</span> across to flip the sign of both sides.
        </>
      );
    }
    return <>Drag a symbol across the equals sign, or sweep empty space to select a block.</>;
  }, [left, right, equation]);

  const solved = useMemo(() => {
    const check = (a: Term[], b: Term[]) =>
      a.length === 1 && a[0].power === 1 && a[0].num === 1 && a[0].den === 1 && b.length === 1 && b[0].power === 0;
    return check(left, right) || check(right, left);
  }, [left, right]);

  const solvedTerm = solved ? (left[0].power === 1 ? right : left)[0] : null;
  const solvedValue = solvedTerm ? (solvedTerm.den === 1 ? String(solvedTerm.num) : `${solvedTerm.num}/${solvedTerm.den}`) : null;
  const solvedContradiction = solved && solvedTerm?.num === 0 && xNonZeroAssumed;

  // --- Algebra moves ---
  const moveTerms = (ids: string[], from: Side, to: Side) => {
    if (from === to) return;
    const source = [...equation[from]];
    const moved: Term[] = [];
    for (const id of ids) {
      const index = source.findIndex((t) => t.id === id);
      if (index !== -1) moved.push(...source.splice(index, 1));
    }
    // The lone "0" placeholder isn't a movable object
    const real = moved.filter((m) => m.num !== 0);
    if (real.length === 0) return;
    const target = [...equation[to], ...real.map((m) => term(-m.num, m.power, m.den))];
    const next = { ...equation, [from]: combine(source), [to]: combine(target) } as EquationState;
    commitMove(`moved ${real.map((m) => termText(m, true).trim()).join(", ")} across`, next);
  };

  /** Divide every term on both sides by the (positive) numeral that was dragged */
  const divideByNumber = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.power === 0) return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the x term must be alone to divide.");
      return;
    }
    const v = Math.abs(source.num);
    if (v <= 1) return;
    const divide = (t: Term) => term(t.num, t.power, t.den * v);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    commitMove(`divided both sides by ${v}`, next);
  };

  /** Multiply every term on both sides by a fraction's numeric denominator */
  const multiplyByDenominator = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.den === 1) return;
    const d = source.den;
    const multiply = (t: Term) => term(t.num * d, t.power, t.den);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    commitMove(`multiplied both sides by ${d}`, next);
  };

  /** Multiply both sides by −1 — the escape hatch from states like −x = 3 */
  const negateBothSides = (_termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const negate = (t: Term) => term(-t.num, t.power, t.den);
    const next = { left: combine(equation.left.map(negate)), right: combine(equation.right.map(negate)) };
    commitMove("flipped the sign of both sides (× −1)", next);
  };

  /** Divide both sides by x: every power drops by one. Assumes x ≠ 0. */
  const divideByX = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const xTerm = equation[from].find((t) => t.id === termId);
    if (!xTerm || xTerm.power !== 1) return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the x term must be alone to divide by x.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.power === -1)) {
      flashNotice("That would nest x deeper than this playground supports (x² in a denominator).");
      return;
    }
    const divide = (t: Term) => term(t.num, (t.power - 1) as Power, t.den);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    commitMove("divided both sides by x", next, true, "assumes x ≠ 0 — a solution x = 0 would be lost");
  };

  /** Multiply both sides by x: every power rises by one. Hides the original x ≠ 0 domain. */
  const multiplyByX = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.power !== -1) return;
    if ([...equation.left, ...equation.right].some((t) => t.power === 1)) {
      flashNotice("That would create an x² term — beyond this playground (for now).");
      return;
    }
    const multiply = (t: Term) => term(t.num, (t.power + 1) as Power, t.den);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    commitMove("multiplied both sides by x", next, true, "the original equation required x ≠ 0 — that rule is now invisible");
  };

  const loadPreset = (index: number) => {
    const state = PRESETS[index].make();
    setPresetIndex(index);
    setEquation(state);
    setHistory([makeStep("start", state)]);
    setSelection(null);
    setNotice(null);
  };

  const restoreStep = (index: number) => {
    setEquation(cloneState(history[index].state));
    setHistory((h) => h.slice(0, index + 1));
    setSelection(null);
    setNotice(null);
  };

  // --- Marquee (drag-to-select a block of symbols on empty space) ---
  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    setHistoryOpen(false);
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-symbol],[data-ui]")) return;
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
    | { kind: "den"; termId: string; from: Side }
    | { kind: "neg"; termId: string; from: Side }
    | { kind: "xdiv"; termId: string; from: Side }
    | { kind: "xmul"; termId: string; from: Side };

  // Tracked in a ref (dataTransfer is unreadable during dragover) so any drop
  // location can route to the opposite side and the target ring is accurate
  const dragPayloadRef = useRef<DragPayload | null>(null);

  const startDrag = (e: DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    dragPayloadRef.current = payload;
  };

  const onSymbolDragStart = (e: DragEvent, termId: string, side: Side, role: Role) => {
    // A selected block always moves as a whole, whatever symbol is grabbed
    if (selection && selection.side === side && selection.termIds.includes(termId)) {
      startDrag(e, { kind: "terms", ids: selection.termIds, from: side });
      return;
    }
    if (role === "coef") startDrag(e, { kind: "coef", termId, from: side });
    else if (role === "den") startDrag(e, { kind: "den", termId, from: side });
    else if (role === "neg") startDrag(e, { kind: "neg", termId, from: side });
    else if (role === "xdiv") startDrag(e, { kind: "xdiv", termId, from: side });
    else if (role === "xmul") startDrag(e, { kind: "xmul", termId, from: side });
    else startDrag(e, { kind: "terms", ids: [termId], from: side });
  };

  const finishDrag = () => {
    dragPayloadRef.current = null;
    setDragOver(null);
  };

  const performDrop = (payload: DragPayload, to: Side) => {
    if (payload.kind === "terms") moveTerms(payload.ids, payload.from, to);
    else if (payload.kind === "coef") divideByNumber(payload.termId, payload.from, to);
    else if (payload.kind === "den") multiplyByDenominator(payload.termId, payload.from, to);
    else if (payload.kind === "neg") negateBothSides(payload.termId, payload.from, to);
    else if (payload.kind === "xdiv") divideByX(payload.termId, payload.from, to);
    else if (payload.kind === "xmul") multiplyByX(payload.termId, payload.from, to);
  };

  const onDrop = (e: DragEvent, to: Side) => {
    e.preventDefault();
    try {
      const payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
      performDrop(payload, to);
    } catch {
      // not a symbol drag — ignore
    }
    finishDrag();
  };

  // --- Rendering ---
  const symHandlers: SymbolHandlers = {
    dragStart: onSymbolDragStart,
    dragEnd: finishDrag,
    hover: setHoveredTermId,
  };

  const renderSide = (terms: Term[], side: Side) => (
    <span
      className={`inline-flex items-center rounded-xl px-2 py-1 transition-shadow ${
        dragOver === side ? "ring-2 ring-amber-300" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const payload = dragPayloadRef.current;
        // Only ring the side a drop here would actually act on
        if (payload) setDragOver(payload.from === side ? null : side);
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop(e, side); // dropping back on the source side is a cancel
      }}
    >
      {terms.map((t, i) => {
        // The lone "0" placeholder is display-only
        if (t.num === 0) {
          return (
            <span key={t.id} className="select-none">
              0
            </span>
          );
        }
        // The whole term is one interactive unit: selected via marquee, or
        // hovered via any of its symbols
        const highlighted =
          !!(selection?.side === side && selection.termIds.includes(t.id)) || hoveredTermId === t.id;
        const magnitude = Math.abs(t.num);
        const canDivide = divideSide === side && magnitude > 1;
        const divideTitle = canDivide
          ? `Drag across the equals sign to divide both sides by ${magnitude}`
          : "Drag across to divide — but the x term must be alone on its side";
        return (
          <span key={t.id} className="inline-flex items-center">
            {(i > 0 || t.num < 0) && (
              <Sym
                termId={t.id}
                side={side}
                role={i === 0 && negSide === side ? "neg" : "term"}
                highlighted={highlighted}
                blue={i === 0 && negSide === side}
                handlers={symHandlers}
                title={
                  i === 0 && negSide === side
                    ? "Drag across the equals sign to flip the sign of both sides"
                    : undefined
                }
                className={i > 0 ? "mx-4" : "mr-1"}
              >
                {i > 0 ? (t.num < 0 ? "−" : "+") : "−"}
              </Sym>
            )}
            {t.power === 1 ? (
              <>
                {!(magnitude === 1 && t.den === 1) &&
                  (t.den === 1 ? (
                    <Sym
                      termId={t.id}
                      side={side}
                      role="coef"
                      highlighted={highlighted}
                      blue={canDivide}
                      handlers={symHandlers}
                      title={divideTitle}
                    >
                      {magnitude}
                    </Sym>
                  ) : (
                    <Fraction
                      termId={t.id}
                      side={side}
                      highlighted={highlighted}
                      numText={magnitude}
                      numRole={magnitude > 1 ? "coef" : "term"}
                      numBlue={canDivide}
                      numTitle={magnitude > 1 ? divideTitle : undefined}
                      denNumber={t.den}
                      denX={false}
                      handlers={symHandlers}
                    />
                  ))}
                <Sym
                  termId={t.id}
                  side={side}
                  role={xDivideSide === side ? "xdiv" : "term"}
                  highlighted={highlighted}
                  blue={xDivideSide === side}
                  handlers={symHandlers}
                  title={
                    xDivideSide === side
                      ? "Drag across the equals sign to divide both sides by x (assumes x ≠ 0)"
                      : undefined
                  }
                  className="italic"
                >
                  x
                </Sym>
              </>
            ) : t.power === 0 ? (
              t.den === 1 ? (
                <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                  {magnitude}
                </Sym>
              ) : (
                <Fraction
                  termId={t.id}
                  side={side}
                  highlighted={highlighted}
                  numText={magnitude}
                  denNumber={t.den}
                  denX={false}
                  handlers={symHandlers}
                />
              )
            ) : (
              <Fraction
                termId={t.id}
                side={side}
                highlighted={highlighted}
                numText={magnitude}
                numRole={magnitude > 1 ? "coef" : "term"}
                numBlue={canDivide}
                numTitle={magnitude > 1 ? divideTitle : undefined}
                denNumber={t.den === 1 ? null : t.den}
                denX
                handlers={symHandlers}
              />
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
      onDragOver={(e) => {
        // Any drop in the tool routes to the opposite side, so users don't
        // have to hit the side span exactly (the "=" gap is not a dead zone)
        e.preventDefault();
        const payload = dragPayloadRef.current;
        if (payload) setDragOver(opposite(payload.from));
      }}
      onDrop={(e) => {
        const payload = dragPayloadRef.current;
        if (payload) onDrop(e, opposite(payload.from));
      }}
    >
      {/* History menu button */}
      <div className="absolute right-4 top-4" data-ui>
        <button
          onClick={() => setHistoryOpen((open) => !open)}
          className="relative flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Step history"
        >
          <History className="h-4 w-4" />
          {history.length - 1} steps
          {xNonZeroAssumed && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400" title="An x ≠ 0 assumption is active" />
          )}
        </button>

        {historyOpen && (
          <div className="absolute right-0 z-40 mt-2 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg">
            {history.map((step, i) => (
              <button
                key={step.id}
                onClick={() => restoreStep(i)}
                title={i < history.length - 1 ? "Click to rewind to this step" : "Current state"}
                className={`block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted ${
                  step.dangerous ? "bg-amber-50 dark:bg-amber-950/30" : ""
                } ${i === history.length - 1 ? "ring-1 ring-border" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-muted-foreground">{i}</span>
                  <span className="font-serif text-base">{step.text}</span>
                </div>
                <div className="ml-7 text-xs text-muted-foreground">
                  {step.dangerous && <TriangleAlert className="mr-1 inline h-3 w-3 text-amber-500" />}
                  {step.label}
                  {step.note && <span className="text-amber-600"> — {step.note}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The equation */}
      <div
        ref={equationRef}
        className={`flex items-center leading-none font-serif text-6xl tracking-wide transition-colors duration-300 sm:text-7xl ${
          solvedContradiction ? "text-rose-500" : solved ? "text-emerald-600" : ""
        }`}
      >
        {renderSide(left, "left")}
        <span className="mx-5 select-none">=</span>
        {renderSide(right, "right")}
      </div>

      {/* State line: notice, solved, or contextual hint — plus the active assumption */}
      <div className="mt-10 flex h-6 items-center gap-3 text-sm text-muted-foreground">
        {notice ? (
          <span className="text-rose-500">{notice}</span>
        ) : solvedContradiction ? (
          <span className="font-medium text-rose-500">
            x = 0 — but a step assumed x ≠ 0 (see history). No valid solution survives.
          </span>
        ) : solved ? (
          <span className="font-medium text-emerald-600">Solved — x = {solvedValue}</span>
        ) : selection ? (
          <span>
            <span className="text-amber-500">Block selected</span> — drag it across the equals sign.
          </span>
        ) : (
          <span>{coachTip}</span>
        )}
        {xNonZeroAssumed && !solvedContradiction && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            assuming x ≠ 0
          </span>
        )}
      </div>

      {/* Presets + reset, kept out of the way */}
      <div className="absolute bottom-6 flex flex-wrap items-center justify-center gap-2 px-4" data-ui>
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
