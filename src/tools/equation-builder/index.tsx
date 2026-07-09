import { useMemo, useRef, useState, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { History, TriangleAlert } from "lucide-react";

/**
 * Equation Playground — a single large equation whose symbols are live
 * objects. Every glyph does literally what it is:
 *   - a term (grabbed by its sign, number, or x) crosses "=" with its sign flipped
 *   - a numeral in coefficient position divides both sides by that number
 *   - a group factor like the 2 in 2(x + 3) distributes when dropped on the
 *     parenthesis, or divides both sides when dragged across "="
 *   - a leading "−" on a lone term flips the sign of both sides
 *   - a fraction's denominator multiplies both sides by it
 *   - the x of a lone x-term divides both sides by x (dangerous: assumes
 *     x ≠ 0 — remembered in the step history)
 *   - an x in a denominator multiplies both sides by x
 * Drops anywhere route to the opposite side; dropping back on the source
 * side cancels. Every move lands in the step history behind the menu.
 */

// Leaf terms are (num/den) · x^power with den > 0, reduced, power ∈ {-1, 0, 1}.
// Group terms are (num/den) · (sum of leaf terms) — parentheses with a factor.
type Power = -1 | 0 | 1;

interface LeafTerm {
  id: string;
  kind: "leaf";
  num: number;
  den: number;
  power: Power;
}

interface GroupTerm {
  id: string;
  kind: "group";
  num: number; // the factor's numerator (signed)
  den: number; // the factor's denominator
  inner: LeafTerm[];
}

type EqTerm = LeafTerm | GroupTerm;

type Side = "left" | "right";

const opposite = (side: Side): Side => (side === "left" ? "right" : "left");

interface EquationState {
  left: EqTerm[];
  right: EqTerm[];
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
const leaf = (num: number, power: Power = 0, den = 1): LeafTerm => ({
  id: `t${termCounter++}`,
  kind: "leaf",
  ...reduce(num, den),
  power,
});
const group = (num: number, inner: LeafTerm[], den = 1): GroupTerm => ({
  id: `t${termCounter++}`,
  kind: "group",
  ...reduce(num, den),
  inner: inner.map((l) => leaf(l.num, l.power, l.den)),
});

// Scale a term's value: both work identically on leaves and group factors
const scaleNum = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf" ? leaf(t.num * k, t.power, t.den) : group(t.num * k, t.inner, t.den);
const scaleDen = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf" ? leaf(t.num, t.power, t.den * k) : group(t.num, t.inner, t.den * k);

const cloneTerm = (t: EqTerm): EqTerm =>
  t.kind === "leaf" ? { ...t } : { ...t, inner: t.inner.map((l) => ({ ...l })) };

const cloneState = (state: EquationState): EquationState => ({
  left: state.left.map(cloneTerm),
  right: state.right.map(cloneTerm),
});

interface Preset {
  name: string;
  make: () => EquationState;
}

const PRESETS: Preset[] = [
  { name: "2x − 3 = −7", make: () => ({ left: [leaf(2, 1), leaf(-3)], right: [leaf(-7)] }) },
  { name: "5x + 4 = 3x", make: () => ({ left: [leaf(5, 1), leaf(4)], right: [leaf(3, 1)] }) },
  { name: "6/x = 2", make: () => ({ left: [leaf(6, -1)], right: [leaf(2)] }) },
  { name: "4/x + 1 = 3", make: () => ({ left: [leaf(4, -1), leaf(1)], right: [leaf(3)] }) },
  { name: "2(x + 3) = 8", make: () => ({ left: [group(2, [leaf(1, 1), leaf(3)])], right: [leaf(8)] }) },
  {
    name: "3(x − 2) = 2x + 1",
    make: () => ({ left: [group(3, [leaf(1, 1), leaf(-2)])], right: [leaf(2, 1), leaf(1)] }),
  },
];

/**
 * Normalize a side: unwrap groups whose factor became 1, drop zero terms,
 * and merge like leaf terms (grouped by power) with exact rational arithmetic.
 * Groups are kept as-is otherwise — distribution is the player's move.
 */
function combine(terms: EqTerm[]): EqTerm[] {
  const groups: GroupTerm[] = [];
  const leaves: LeafTerm[] = [];
  for (const t of terms) {
    if (t.kind === "group") {
      if (t.num === 0) continue;
      if (t.num === 1 && t.den === 1) leaves.push(...t.inner.map((l) => leaf(l.num, l.power, l.den)));
      else groups.push(group(t.num, t.inner, t.den));
    } else {
      leaves.push(t);
    }
  }
  const sum = (list: LeafTerm[]) =>
    list.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const merged: LeafTerm[] = [];
  for (const power of [1, 0, -1] as Power[]) {
    const s = sum(leaves.filter((t) => t.power === power));
    if (s.num !== 0) merged.push(leaf(s.num, power, s.den));
  }
  const result: EqTerm[] = [...groups, ...merged];
  if (result.length === 0) result.push(leaf(0));
  return result;
}

/** Plain-text rendering of a term, for history rows and labels */
function termText(t: EqTerm, leading: boolean): string {
  const sign = t.num < 0 ? "−" : "+";
  const prefix = leading ? (t.num < 0 ? "−" : "") : ` ${sign} `;
  const mag = Math.abs(t.num);
  const coefStr = mag === 1 && t.den === 1 ? "" : t.den === 1 ? String(mag) : `(${mag}/${t.den})`;
  let body: string;
  if (t.kind === "group") {
    body = `${coefStr}(${innerText(t.inner)})`;
  } else if (t.power === 1) {
    body = `${coefStr}x`;
  } else if (t.power === 0) {
    body = t.den === 1 ? String(mag) : `${mag}/${t.den}`;
  } else {
    body = `${mag}/${t.den === 1 ? "x" : `${t.den}x`}`;
  }
  return prefix + body;
}

const innerText = (terms: LeafTerm[]) => terms.map((t, i) => termText(t, i === 0)).join("");
const sideTextOf = (terms: EqTerm[]) => terms.map((t, i) => termText(t, i === 0)).join("");
const equationText = (state: EquationState) => `${sideTextOf(state.left)} = ${sideTextOf(state.right)}`;

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

type Role = "term" | "coef" | "den" | "neg" | "xdiv" | "xmul" | "factor";

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
  /** Inert fractions (inside parentheses) have no blue action glyphs */
  inert?: boolean;
  handlers: SymbolHandlers;
}

/**
 * Stacked fraction, sized and centered to sit on the equation's math axis.
 * Term-highlight is applied to the container so the bar colors with it;
 * blue action glyphs override via their own color class.
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
  inert,
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
      role={inert ? "term" : numRole}
      highlighted={false}
      blue={!inert && numBlue}
      title={inert ? undefined : numTitle}
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
          role={inert ? "term" : "den"}
          highlighted={false}
          blue={!inert}
          handlers={handlers}
          title={inert ? undefined : `Drag across to multiply both sides by ${denNumber}`}
        >
          {denNumber}
        </Sym>
      )}
      {denX && (
        <Sym
          termId={termId}
          side={side}
          role={inert ? "term" : "xmul"}
          highlighted={false}
          blue={!inert}
          handlers={handlers}
          title={inert ? undefined : "Drag across to multiply both sides by x"}
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
  const [parenHover, setParenHover] = useState<string | null>(null);
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

  // A lone x-ish leaf (x or 1/x) whose numeral can be dragged across to divide
  const divideSide: Side | null = useMemo(() => {
    const alone = (side: EqTerm[]) =>
      side.length === 1 && side[0].kind === "leaf" && side[0].power !== 0 && Math.abs(side[0].num) > 1;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  // The x of a lone x-leaf is draggable to divide both sides by x
  const xDivideSide: Side | null = useMemo(() => {
    const alone = (side: EqTerm[]) =>
      side.length === 1 && side[0].kind === "leaf" && side[0].power === 1 && side[0].num !== 0;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  // A lone negative term (leaf or group) whose leading − negates both sides
  const negSide: Side | null = useMemo(() => {
    const alone = (side: EqTerm[]) => side.length === 1 && side[0].num < 0;
    if (alone(left)) return "left";
    if (alone(right)) return "right";
    return null;
  }, [left, right]);

  const solved = useMemo(() => {
    const check = (a: EqTerm[], b: EqTerm[]) =>
      a.length === 1 &&
      a[0].kind === "leaf" &&
      a[0].power === 1 &&
      a[0].num === 1 &&
      a[0].den === 1 &&
      b.length === 1 &&
      b[0].kind === "leaf" &&
      b[0].power === 0;
    return check(left, right) || check(right, left);
  }, [left, right]);

  const solvedTerm = solved ? ((left[0].kind === "leaf" && left[0].power === 1 ? right : left)[0] as LeafTerm) : null;
  const solvedValue = solvedTerm ? (solvedTerm.den === 1 ? String(solvedTerm.num) : `${solvedTerm.num}/${solvedTerm.den}`) : null;
  const solvedContradiction = solved && solvedTerm?.num === 0 && xNonZeroAssumed;

  // --- Algebra moves ---
  const moveTerms = (ids: string[], from: Side, to: Side) => {
    if (from === to) return;
    const source = [...equation[from]];
    const moved: EqTerm[] = [];
    for (const id of ids) {
      const index = source.findIndex((t) => t.id === id);
      if (index !== -1) moved.push(...source.splice(index, 1));
    }
    // The lone "0" placeholder isn't a movable object
    const real = moved.filter((m) => m.num !== 0);
    if (real.length === 0) return;
    const target = [...equation[to], ...real.map((m) => scaleNum(m, -1))];
    const next = { ...equation, [from]: combine(source), [to]: combine(target) } as EquationState;
    commitMove(`moved ${real.map((m) => termText(m, true).trim()).join(", ")} across`, next);
  };

  /** Divide every term on both sides by the (positive) numeral that was dragged */
  const divideByNumber = (termId: string, from: Side, to: Side, isFactor = false) => {
    if (from === to) {
      if (isFactor) flashNotice("Drop the factor onto the parenthesis to distribute it.");
      return;
    }
    const source = equation[from].find((t) => t.id === termId);
    if (!source) return;
    if (source.kind === "leaf" && source.power === 0) return;
    if (equation[from].length !== 1) {
      flashNotice(
        isFactor
          ? "Move the other terms away first — or drop the factor on the parenthesis to distribute."
          : "Move the other terms away first — the x term must be alone to divide."
      );
      return;
    }
    const v = Math.abs(source.num);
    if (v <= 1) return;
    const divide = (t: EqTerm) => scaleDen(t, v);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    commitMove(`divided both sides by ${v}`, next);
  };

  /** Multiply every term on both sides by a fraction's numeric denominator */
  const multiplyByDenominator = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.den === 1) return;
    const d = source.den;
    const multiply = (t: EqTerm) => scaleNum(t, d);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    commitMove(`multiplied both sides by ${d}`, next);
  };

  /** Multiply both sides by −1 — the escape hatch from states like −x = 3 */
  const negateBothSides = (_termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const negate = (t: EqTerm) => scaleNum(t, -1);
    const next = { left: combine(equation.left.map(negate)), right: combine(equation.right.map(negate)) };
    commitMove("flipped the sign of both sides (× −1)", next);
  };

  /** Distribute a group's factor over its parenthesis: a(bx + c) → abx + ac */
  const distributeFactor = (termId: string, from: Side) => {
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "group") return;
    const label = `distributed ${termText(source, true).trim().startsWith("−") ? `−${Math.abs(source.num)}` : Math.abs(source.num)}${
      source.den !== 1 ? `/${source.den}` : ""
    } over (${innerText(source.inner)})`;
    const expanded = source.inner.map((l) => leaf(l.num * source.num, l.power, l.den * source.den));
    const rest = equation[from].filter((t) => t.id !== termId);
    const next = { ...equation, [from]: combine([...rest, ...expanded]) } as EquationState;
    commitMove(label, next);
  };

  const hasGroups = [...left, ...right].some((t) => t.kind === "group");

  /** Divide both sides by x: every power drops by one. Assumes x ≠ 0. */
  const divideByX = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const xTerm = equation[from].find((t) => t.id === termId);
    if (!xTerm || xTerm.kind !== "leaf" || xTerm.power !== 1) return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the x term must be alone to divide by x.");
      return;
    }
    if (hasGroups) {
      flashNotice("Distribute the parentheses first.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power === -1)) {
      flashNotice("That would nest x deeper than this playground supports (x² in a denominator).");
      return;
    }
    const divide = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power - 1) as Power, t.den) : t);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    commitMove("divided both sides by x", next, true, "assumes x ≠ 0 — a solution x = 0 would be lost");
  };

  /** Multiply both sides by x: every power rises by one. Hides the original x ≠ 0 domain. */
  const multiplyByX = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== -1) return;
    if (hasGroups) {
      flashNotice("Distribute the parentheses first.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power === 1)) {
      flashNotice("That would create an x² term — beyond this playground (for now).");
      return;
    }
    const multiply = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power + 1) as Power, t.den) : t);
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
    | { kind: "xmul"; termId: string; from: Side }
    | { kind: "factor"; termId: string; from: Side };

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
    else if (role === "factor") startDrag(e, { kind: "factor", termId, from: side });
    else startDrag(e, { kind: "terms", ids: [termId], from: side });
  };

  const finishDrag = () => {
    dragPayloadRef.current = null;
    setDragOver(null);
    setParenHover(null);
  };

  const performDrop = (payload: DragPayload, to: Side) => {
    if (payload.kind === "terms") moveTerms(payload.ids, payload.from, to);
    else if (payload.kind === "coef") divideByNumber(payload.termId, payload.from, to);
    else if (payload.kind === "factor") divideByNumber(payload.termId, payload.from, to, true);
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

  /** The magnitude portion of a leaf term (numeral, x, fraction) */
  const renderLeafBody = (t: LeafTerm, side: Side, highlighted: boolean, opts: { termId?: string; inert?: boolean } = {}) => {
    const termId = opts.termId ?? t.id;
    const inert = opts.inert ?? false;
    const magnitude = Math.abs(t.num);
    const canDivide = !inert && divideSide === side && magnitude > 1;
    const divideTitle = canDivide
      ? `Drag across the equals sign to divide both sides by ${magnitude}`
      : "Drag across to divide — but the x term must be alone on its side";
    if (t.power === 1) {
      return (
        <>
          {!(magnitude === 1 && t.den === 1) &&
            (t.den === 1 ? (
              <Sym
                termId={termId}
                side={side}
                role={inert ? "term" : "coef"}
                highlighted={highlighted}
                blue={canDivide}
                handlers={symHandlers}
                title={inert ? undefined : divideTitle}
              >
                {magnitude}
              </Sym>
            ) : (
              <Fraction
                termId={termId}
                side={side}
                highlighted={highlighted}
                numText={magnitude}
                numRole={magnitude > 1 ? "coef" : "term"}
                numBlue={canDivide}
                numTitle={magnitude > 1 ? divideTitle : undefined}
                denNumber={t.den}
                denX={false}
                inert={inert}
                handlers={symHandlers}
              />
            ))}
          <Sym
            termId={termId}
            side={side}
            role={!inert && xDivideSide === side ? "xdiv" : "term"}
            highlighted={highlighted}
            blue={!inert && xDivideSide === side}
            handlers={symHandlers}
            title={
              !inert && xDivideSide === side
                ? "Drag across the equals sign to divide both sides by x (assumes x ≠ 0)"
                : undefined
            }
            className="italic"
          >
            x
          </Sym>
        </>
      );
    }
    if (t.power === 0) {
      return t.den === 1 ? (
        <Sym termId={termId} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
          {magnitude}
        </Sym>
      ) : (
        <Fraction
          termId={termId}
          side={side}
          highlighted={highlighted}
          numText={magnitude}
          denNumber={t.den}
          denX={false}
          inert={inert}
          handlers={symHandlers}
        />
      );
    }
    return (
      <Fraction
        termId={termId}
        side={side}
        highlighted={highlighted}
        numText={magnitude}
        numRole={!inert && magnitude > 1 ? "coef" : "term"}
        numBlue={canDivide}
        numTitle={!inert && magnitude > 1 ? divideTitle : undefined}
        denNumber={t.den === 1 ? null : t.den}
        denX
        inert={inert}
        handlers={symHandlers}
      />
    );
  };

  const renderSide = (terms: EqTerm[], side: Side) => (
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
        const highlighted =
          !!(selection?.side === side && selection.termIds.includes(t.id)) || hoveredTermId === t.id;
        const sign = (
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
        );

        if (t.kind === "group") {
          const factorMag = Math.abs(t.num);
          const showFactor = !(factorMag === 1 && t.den === 1);
          const factorTitle = `Drop onto the parenthesis to distribute — or drag across the equals sign to divide both sides by ${factorMag}`;
          return (
            <span key={t.id} className="inline-flex items-center">
              {(i > 0 || t.num < 0) && sign}
              {showFactor &&
                (t.den === 1 ? (
                  <Sym
                    termId={t.id}
                    side={side}
                    role="factor"
                    highlighted={highlighted}
                    blue
                    handlers={symHandlers}
                    title={factorTitle}
                  >
                    {factorMag}
                  </Sym>
                ) : (
                  <Fraction
                    termId={t.id}
                    side={side}
                    highlighted={highlighted}
                    numText={factorMag}
                    numRole="factor"
                    numBlue
                    numTitle={factorTitle}
                    denNumber={t.den}
                    denX={false}
                    handlers={symHandlers}
                  />
                ))}
              <span
                className={`inline-flex items-center rounded-lg transition-colors ${
                  parenHover === t.id ? "bg-sky-100 text-sky-600 dark:bg-sky-950/50" : ""
                }`}
                onDragOver={(e) => {
                  const payload = dragPayloadRef.current;
                  if (payload?.kind === "factor" && payload.termId === t.id) {
                    e.preventDefault();
                    e.stopPropagation();
                    setParenHover(t.id);
                    setDragOver(null);
                  }
                }}
                onDragLeave={() => setParenHover((cur) => (cur === t.id ? null : cur))}
                onDrop={(e) => {
                  const payload = dragPayloadRef.current;
                  if (payload?.kind === "factor" && payload.termId === t.id) {
                    e.preventDefault();
                    e.stopPropagation();
                    distributeFactor(t.id, side);
                    finishDrag();
                  }
                }}
              >
                <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                  (
                </Sym>
                {t.inner.map((l, j) => (
                  <span key={l.id} className="inline-flex items-center">
                    {(j > 0 || l.num < 0) && (
                      <Sym
                        termId={t.id}
                        side={side}
                        role="term"
                        highlighted={highlighted}
                        handlers={symHandlers}
                        className={j > 0 ? "mx-3" : "mr-0.5"}
                      >
                        {j > 0 ? (l.num < 0 ? "−" : "+") : "−"}
                      </Sym>
                    )}
                    {renderLeafBody(l, side, highlighted, { termId: t.id, inert: true })}
                  </span>
                ))}
                <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                  )
                </Sym>
              </span>
            </span>
          );
        }

        return (
          <span key={t.id} className="inline-flex items-center">
            {(i > 0 || t.num < 0) && sign}
            {renderLeafBody(t, side, highlighted)}
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

      {/* State line: notice, solved, or a neutral hint — plus the active assumption */}
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
          <span>Drag a symbol across the equals sign, or sweep empty space to select a block.</span>
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
