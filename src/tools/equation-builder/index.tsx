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
type Power = -1 | 0 | 1 | 2;

interface LeafTerm {
  id: string;
  kind: "leaf";
  num: number;
  den: number;
  power: Power;
  /** Result of a square root: shown with a ± prefix (both roots kept) */
  pm?: boolean;
  /** num/den is a radicand: the value is √(num/den), display-only */
  radical?: boolean;
  /** An inverse-function value: fnVal applied to num/den (e.g. arcsin(1/2)), display-only */
  fnVal?: string;
}

interface GroupTerm {
  id: string;
  kind: "group";
  num: number; // the factor's numerator (signed)
  den: number; // the factor's denominator
  inner: LeafTerm[];
}

type FuncName = "sin" | "cos" | "ln" | "exp";

/** A function wrapped around an argument, with a rational coefficient: a·fn(inner) */
interface FuncTerm {
  id: string;
  kind: "func";
  num: number;
  den: number;
  fn: FuncName;
  inner: LeafTerm[];
}

type EqTerm = LeafTerm | GroupTerm | FuncTerm;

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
const func = (fn: FuncName, num: number, inner: LeafTerm[], den = 1): FuncTerm => ({
  id: `t${termCounter++}`,
  kind: "func",
  ...reduce(num, den),
  fn,
  inner: inner.map((l) => leaf(l.num, l.power, l.den)),
});

// Scale a term's value: both work identically on leaves and group factors
const scaleNum = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf"
    ? leaf(t.num * k, t.power, t.den)
    : t.kind === "group"
      ? group(t.num * k, t.inner, t.den)
      : func(t.fn, t.num * k, t.inner, t.den);
const scaleDen = (t: EqTerm, k: number): EqTerm =>
  t.kind === "leaf"
    ? leaf(t.num, t.power, t.den * k)
    : t.kind === "group"
      ? group(t.num, t.inner, t.den * k)
      : func(t.fn, t.num, t.inner, t.den * k);

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

  { name: "2(x + 3) = 8", make: () => ({ left: [group(2, [leaf(1, 1), leaf(3)])], right: [leaf(8)] }) },
  {
    name: "3(x − 2) = 2x + 1",
    make: () => ({ left: [group(3, [leaf(1, 1), leaf(-2)])], right: [leaf(2, 1), leaf(1)] }),
  },
  { name: "x² = 9", make: () => ({ left: [leaf(1, 2)], right: [leaf(9)] }) },
  { name: "x² + 1 = 6", make: () => ({ left: [leaf(1, 2), leaf(1)], right: [leaf(6)] }) },
  { name: "2x² − 6 = 12", make: () => ({ left: [leaf(2, 2), leaf(-6)], right: [leaf(12)] }) },
  { name: "2sin(x) = 1", make: () => ({ left: [func("sin", 2, [leaf(1, 1)])], right: [leaf(1)] }) },
  { name: "ln(x) = 2", make: () => ({ left: [func("ln", 1, [leaf(1, 1)])], right: [leaf(2)] }) },
  { name: "eˣ + 1 = 4", make: () => ({ left: [func("exp", 1, [leaf(1, 1)]), leaf(1)], right: [leaf(4)] }) },
];

/**
 * Normalize a side: unwrap groups whose factor became 1, drop zero terms,
 * and merge like leaf terms (grouped by power) with exact rational arithmetic.
 * Groups are kept as-is otherwise — distribution is the player's move.
 */
function combine(terms: EqTerm[]): EqTerm[] {
  const passthrough: EqTerm[] = [];
  const leaves: LeafTerm[] = [];
  for (const t of terms) {
    if (t.kind === "group") {
      if (t.num === 0) continue;
      if (t.num === 1 && t.den === 1) leaves.push(...t.inner.map((l) => leaf(l.num, l.power, l.den)));
      else passthrough.push(group(t.num, t.inner, t.den));
    } else if (t.kind === "func") {
      if (t.num !== 0) passthrough.push(func(t.fn, t.num, t.inner, t.den));
    } else if (t.pm || t.radical || t.fnVal) {
      passthrough.push({ ...t }); // terminal values never merge
    } else {
      leaves.push(t);
    }
  }
  const sum = (list: LeafTerm[]) =>
    list.reduce((acc, t) => reduce(acc.num * t.den + t.num * acc.den, acc.den * t.den), { num: 0, den: 1 });
  const merged: LeafTerm[] = [];
  for (const power of [2, 1, 0, -1] as Power[]) {
    const s = sum(leaves.filter((t) => t.power === power));
    if (s.num !== 0) merged.push(leaf(s.num, power, s.den));
  }
  const result: EqTerm[] = [...passthrough, ...merged];
  if (result.length === 0) result.push(leaf(0));
  return result;
}

/** Plain-text rendering of a term, for history rows and labels */
function termText(t: EqTerm, leading: boolean): string {
  const sign = t.num < 0 ? "−" : "+";
  const prefix = leading ? (t.num < 0 ? "−" : "") : ` ${sign} `;
  const mag = Math.abs(t.num);
  const coefStr = mag === 1 && t.den === 1 ? "" : t.den === 1 ? String(mag) : `(${mag}/${t.den})`;
  if (t.kind === "leaf" && (t.pm || t.radical || t.fnVal)) {
    const arg = t.den === 1 ? String(t.num) : `${t.num}/${t.den}`;
    const core = t.fnVal
      ? t.fnVal === "e^"
        ? `e^${arg}`
        : t.fnVal === "ln"
          ? `ln ${arg}`
          : `${t.fnVal}(${arg})`
      : t.radical
        ? `√${t.den === 1 ? t.num : `(${t.num}/${t.den})`}`
        : arg;
    return prefix + `${t.pm ? "±" : ""}${core}`;
  }
  let body: string;
  if (t.kind === "group") {
    body = `${coefStr}(${innerText(t.inner)})`;
  } else if (t.kind === "func") {
    body = t.fn === "exp" ? `${coefStr}e^(${innerText(t.inner)})` : `${coefStr}${t.fn}(${innerText(t.inner)})`;
  } else if (t.power === 1 || t.power === 2) {
    body = `${coefStr}x${t.power === 2 ? "²" : ""}`;
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
  /** A standing assumption this step introduced (e.g. "x ≠ 0", "principal value") */
  pill?: string;
  state: EquationState;
  text: string;
}

let stepCounter = 0;
const makeStep = (label: string, state: EquationState, dangerous?: boolean, note?: string, pill?: string): Step => ({
  id: stepCounter++,
  label,
  note,
  dangerous,
  pill,
  state: cloneState(state),
  text: equationText(state),
});

type Role = "term" | "coef" | "den" | "neg" | "xdiv" | "xmul" | "factor" | "exp" | "fn";

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
      blue ? "hover:text-amber-500" : highlighted ? "text-amber-500" : ""
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

  // The "dangerous switches": standing assumptions introduced by past steps
  const assumptions = useMemo(
    () => Array.from(new Set(history.map((s) => s.pill).filter((p): p is string => !!p))),
    [history]
  );
  const xNonZeroAssumed = assumptions.includes("x ≠ 0");

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  };

  const commitMove = (label: string, next: EquationState, dangerous?: boolean, note?: string, pill?: string) => {
    setEquation(next);
    setHistory((h) => [...h, makeStep(label, next, dangerous, note, pill)]);
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
  const solvedArg = solvedTerm ? (solvedTerm.den === 1 ? String(solvedTerm.num) : `${solvedTerm.num}/${solvedTerm.den}`) : "";
  const solvedValue = solvedTerm
    ? `${solvedTerm.pm ? "±" : ""}${
        solvedTerm.fnVal
          ? solvedTerm.fnVal === "e^"
            ? `e^${solvedArg}`
            : solvedTerm.fnVal === "ln"
              ? `ln ${solvedArg}`
              : `${solvedTerm.fnVal}(${solvedArg})`
          : solvedTerm.radical
            ? `√${solvedTerm.den === 1 ? solvedTerm.num : `(${solvedTerm.num}/${solvedTerm.den})`}`
            : solvedArg
      }`
    : null;
  const solvedContradiction = solved && solvedTerm?.num === 0 && xNonZeroAssumed;

  // ± / radical results are an end state: no further arithmetic is defined on them
  const hasTerminal = [...left, ...right].some((t) => t.kind === "leaf" && (t.pm || t.radical || t.fnVal));
  const guardTerminal = () => {
    if (hasTerminal) {
      flashNotice("± roots are an end state — rewind from the history menu to try another path.");
      return true;
    }
    return false;
  };

  // --- Algebra moves ---
  const moveTerms = (ids: string[], from: Side, to: Side) => {
    if (from === to) return;
    if (guardTerminal()) return;
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
    if (guardTerminal()) return;
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
    if (guardTerminal()) return;
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
    if (guardTerminal()) return;
    if (from === to) return;
    const negate = (t: EqTerm) => scaleNum(t, -1);
    const next = { left: combine(equation.left.map(negate)), right: combine(equation.right.map(negate)) };
    commitMove("flipped the sign of both sides (× −1)", next);
  };

  /** Distribute a group's factor over its parenthesis: a(bx + c) → abx + ac */
  const distributeFactor = (termId: string, from: Side) => {
    if (guardTerminal()) return;
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
    if (guardTerminal()) return;
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
    if ([...equation.left, ...equation.right].some((t) => t.kind === "func")) {
      flashNotice("Unwrap the function first.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power === -1)) {
      flashNotice("That would nest x deeper than this playground supports (x² in a denominator).");
      return;
    }
    const divide = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power - 1) as Power, t.den) : t);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    commitMove("divided both sides by x", next, true, "assumes x ≠ 0 — a solution x = 0 would be lost", "x ≠ 0");
  };

  /** Multiply both sides by x: every power rises by one. Hides the original x ≠ 0 domain. */
  const multiplyByX = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    if (guardTerminal()) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== -1) return;
    if (hasGroups) {
      flashNotice("Distribute the parentheses first.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.kind === "func")) {
      flashNotice("Unwrap the function first.");
      return;
    }
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power >= 1)) {
      flashNotice("That would raise a power beyond this playground (for now).");
      return;
    }
    const multiply = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power + 1) as Power, t.den) : t);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    commitMove("multiplied both sides by x", next, true, "the original equation required x ≠ 0 — that rule is now invisible", "x ≠ 0");
  };

  /** Take the square root of both sides: x² = c → x = ±√c (both roots kept) */
  const takeSquareRoot = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== 2) return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the x² term must be alone.");
      return;
    }
    if (!(source.num === 1 && source.den === 1)) {
      flashNotice(
        source.num < 0
          ? "Flip the sign of both sides first — the square root needs a bare x²."
          : "Divide away the coefficient first — the square root needs a bare x²."
      );
      return;
    }
    const other = equation[to];
    if (other.length !== 1 || other[0].kind !== "leaf" || other[0].power !== 0 || other[0].pm || other[0].radical || other[0].fnVal) {
      flashNotice("Gather everything else on the other side first.");
      return;
    }
    const c = other[0];
    if (c.num < 0) {
      flashNotice("x² can never equal a negative number — no real solutions here.");
      return;
    }
    const isSquare = (n: number) => {
      const r = Math.round(Math.sqrt(n));
      return r * r === n;
    };
    let result: LeafTerm;
    if (c.num === 0) {
      result = leaf(0);
    } else if (isSquare(c.num) && isSquare(c.den)) {
      result = { ...leaf(Math.round(Math.sqrt(c.num)), 0, Math.round(Math.sqrt(c.den))), pm: true };
    } else {
      result = { ...leaf(c.num, 0, c.den), radical: true, pm: true };
    }
    const next = { ...equation, [from]: [leaf(1, 1)], [to]: [result] } as EquationState;
    commitMove("took the square root of both sides", next, false, "keeping ± — both roots survive");
  };

  /** Unwrap a function by applying its inverse to both sides: fn(x) = c → x = fn⁻¹(c) */
  const unwrapFunction = (termId: string, from: Side, to: Side) => {
    if (from === to) return;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "func") return;
    if (equation[from].length !== 1) {
      flashNotice("Move the other terms away first — the function must be alone on its side.");
      return;
    }
    if (!(source.num === 1 && source.den === 1)) {
      flashNotice(
        source.num < 0
          ? "Flip the sign of both sides first — the inverse needs a bare function."
          : "Divide away the coefficient first — the inverse needs a bare function."
      );
      return;
    }
    const other = equation[to];
    if (other.length !== 1 || other[0].kind !== "leaf" || other[0].power !== 0 || other[0].pm || other[0].radical || other[0].fnVal) {
      flashNotice("Gather a single plain number on the other side first.");
      return;
    }
    const c = other[0];
    if (source.fn === "exp" && c.num <= 0) {
      flashNotice("e^x is always positive — it can never equal a number ≤ 0.");
      return;
    }
    if ((source.fn === "sin" || source.fn === "cos") && Math.abs(c.num / c.den) > 1) {
      flashNotice(`${source.fn} never leaves [−1, 1] — no solution here.`);
      return;
    }
    const INVERSE: Record<FuncName, string> = { sin: "arcsin", cos: "arccos", ln: "e^", exp: "ln" };
    const LABEL: Record<FuncName, string> = {
      sin: "applied arcsin to both sides",
      cos: "applied arccos to both sides",
      ln: "exponentiated both sides (e to each side)",
      exp: "took the natural log of both sides",
    };
    // Exact special values keep the result rational
    let result: LeafTerm;
    if (
      (source.fn === "exp" && c.num === 1 && c.den === 1) ||
      (source.fn === "sin" && c.num === 0) ||
      (source.fn === "cos" && c.num === 1 && c.den === 1)
    ) {
      result = leaf(0);
    } else if (source.fn === "ln" && c.num === 0) {
      result = leaf(1);
    } else {
      result = { ...leaf(c.num, 0, c.den), fnVal: INVERSE[source.fn] };
    }
    const isTrig = source.fn === "sin" || source.fn === "cos";
    const next = {
      ...equation,
      [from]: combine(source.inner.map((l) => leaf(l.num, l.power, l.den))),
      [to]: [result],
    } as EquationState;
    commitMove(
      LABEL[source.fn],
      next,
      isTrig,
      isTrig ? "principal value only — the periodic solutions are dropped" : undefined,
      isTrig ? "principal value" : undefined
    );
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
    | { kind: "factor"; termId: string; from: Side }
    | { kind: "exp"; termId: string; from: Side }
    | { kind: "fn"; termId: string; from: Side };

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
    else if (role === "exp") startDrag(e, { kind: "exp", termId, from: side });
    else if (role === "fn") startDrag(e, { kind: "fn", termId, from: side });
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
    else if (payload.kind === "exp") takeSquareRoot(payload.termId, payload.from, to);
    else if (payload.kind === "fn") unwrapFunction(payload.termId, payload.from, to);
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
    if (t.power === 1 || t.power === 2) {
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
          {t.power === 2 && (
            <Sym
              termId={termId}
              side={side}
              role={inert ? "term" : "exp"}
              highlighted={highlighted}
              blue={!inert}
              handlers={symHandlers}
              title={inert ? undefined : "Drag across the equals sign to take the square root of both sides"}
              className="self-start mt-[0.08em] text-[0.5em] leading-none"
            >
              2
            </Sym>
          )}
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
        // ± / radical / inverse-function results are terminal — display-only
        if (t.kind === "leaf" && (t.pm || t.radical || t.fnVal)) {
          const arg = t.den === 1 ? String(t.num) : `${t.num}/${t.den}`;
          return (
            <span key={t.id} className="inline-flex select-none items-center">
              {t.pm && <span className="mr-2">±</span>}
              {t.radical ? (
                <span className="inline-flex items-baseline">
                  <span>√</span>
                  <span className="border-t-[0.06em] border-current pt-[0.04em]">{arg}</span>
                </span>
              ) : t.fnVal === "e^" ? (
                <span className="inline-flex items-center">
                  <span className="italic">e</span>
                  <span className="mt-[0.08em] self-start text-[0.5em] leading-none">{arg}</span>
                </span>
              ) : t.fnVal === "ln" ? (
                <span>
                  ln&thinsp;{arg}
                </span>
              ) : t.fnVal ? (
                <span className="inline-flex items-center">
                  <span className="mr-1 text-[0.7em]">{t.fnVal}</span>({arg})
                </span>
              ) : (
                <span>{arg}</span>
              )}
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
                  parenHover === t.id ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40" : ""
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

        if (t.kind === "func") {
          const coefMag = Math.abs(t.num);
          const showCoef = !(coefMag === 1 && t.den === 1);
          const fnTitle = "Drag across the equals sign to apply the inverse function to both sides";
          const inner = t.inner.map((l, j) => (
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
          ));
          return (
            <span key={t.id} className="inline-flex items-center">
              {(i > 0 || t.num < 0) && sign}
              {showCoef &&
                (t.den === 1 ? (
                  <Sym
                    termId={t.id}
                    side={side}
                    role="coef"
                    highlighted={highlighted}
                    blue
                    handlers={symHandlers}
                    title="Drag across the equals sign to divide both sides — the function must be alone on its side"
                  >
                    {coefMag}
                  </Sym>
                ) : (
                  <Fraction
                    termId={t.id}
                    side={side}
                    highlighted={highlighted}
                    numText={coefMag}
                    numRole="coef"
                    numBlue
                    denNumber={t.den}
                    denX={false}
                    handlers={symHandlers}
                  />
                ))}
              {t.fn === "exp" ? (
                <>
                  <Sym
                    termId={t.id}
                    side={side}
                    role="fn"
                    highlighted={highlighted}
                    blue
                    handlers={symHandlers}
                    title={fnTitle}
                    className="italic"
                  >
                    e
                  </Sym>
                  <span className="mt-[0.08em] inline-flex items-center self-start text-[0.5em] leading-none">
                    {inner}
                  </span>
                </>
              ) : (
                <>
                  <Sym
                    termId={t.id}
                    side={side}
                    role="fn"
                    highlighted={highlighted}
                    blue
                    handlers={symHandlers}
                    title={fnTitle}
                    className="mr-1 text-[0.7em]"
                  >
                    {t.fn}
                  </Sym>
                  <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                    (
                  </Sym>
                  {inner}
                  <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                    )
                  </Sym>
                </>
              )}
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
        ) : null}
        {!solvedContradiction &&
          assumptions.map((assumption) => (
            <span
              key={assumption}
              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            >
              {assumption === "x ≠ 0" ? "assuming x ≠ 0" : assumption}
            </span>
          ))}
      </div>

      {/* Presets + reset, kept out of the way */}
      <div className="absolute bottom-6 flex flex-wrap items-center justify-center gap-2 px-4" data-ui>
        <select
          value={presetIndex}
          onChange={(e) => loadPreset(Number(e.target.value))}
          className="rounded-full border border-border bg-background px-3 py-1 font-serif text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Choose an equation"
        >
          {PRESETS.map((preset, i) => (
            <option key={preset.name} value={i}>
              {preset.name}
            </option>
          ))}
        </select>
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
