import { useMemo, useRef, useState, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { History, Search, TriangleAlert } from "lucide-react";
import {
  Power,
  LeafTerm,
  FuncName,
  EqTerm,
  Side,
  EquationState,
  opposite,
  leaf,
  group,
  func,
  scaleNum,
  scaleDen,
  cloneState,
  combine,
} from "./model";
import { parseEquation, renderMathPreview } from "./parse";

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
  const [dragPreview, setDragPreview] = useState<{ kind: "ok" | "reject" | "cancel"; text: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [underHover, setUnderHover] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputMsg, setInputMsg] = useState<{ kind: "err" | "warn"; text: string } | null>(null);
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

  // ± / radical / inverse results are an end state: no further arithmetic is defined on them
  const hasTerminal = [...left, ...right].some((t) => t.kind === "leaf" && (t.pm || t.radical || t.fnVal));
  const hasGroups = [...left, ...right].some((t) => t.kind === "group");
  const hasFuncs = [...left, ...right].some((t) => t.kind === "func");

  // --- Algebra moves ---------------------------------------------------
  // Every move is a pure computation returning the would-be outcome, a
  // rejection reason (string), or null (a no-op / cancel). The same
  // functions power the actual drop AND the live preview shown mid-drag.
  interface MoveOutcome {
    next: EquationState;
    label: string;
    dangerous?: boolean;
    note?: string;
    pill?: string;
  }
  type MoveResult = MoveOutcome | string | null;

  const tryMoveTerms = (ids: string[], from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = [...equation[from]];
    const moved: EqTerm[] = [];
    for (const id of ids) {
      const index = source.findIndex((t) => t.id === id);
      if (index !== -1) moved.push(...source.splice(index, 1));
    }
    // The lone "0" placeholder isn't a movable object
    const real = moved.filter((m) => m.num !== 0);
    if (real.length === 0) return null;
    const target = [...equation[to], ...real.map((m) => scaleNum(m, -1))];
    const next = { ...equation, [from]: combine(source), [to]: combine(target) } as EquationState;
    return { next, label: `moved ${real.map((m) => termText(m, true).trim()).join(", ")} across` };
  };

  /** Divide every term on both sides by the (positive) numeral that was dragged */
  const tryDivideByNumber = (termId: string, from: Side, to: Side, isFactor = false): MoveResult => {
    if (from === to) return isFactor ? "drop the factor onto the parenthesis to distribute it" : null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source) return null;
    const v = Math.abs(source.num);
    if (v <= 1) return null;
    const divide = (t: EqTerm) => scaleDen(t, v);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    return { next, label: `divided both sides by ${v}` };
  };

  /** Multiply every term on both sides by a fraction's numeric denominator */
  const tryMultiplyByDenominator = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.den === 1) return null;
    const d = source.den;
    const multiply = (t: EqTerm) => scaleNum(t, d);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    return { next, label: `multiplied both sides by ${d}` };
  };

  /** Multiply both sides by −1 — the escape hatch from states like −x = 3 */
  const tryNegateBothSides = (_termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const negate = (t: EqTerm) => scaleNum(t, -1);
    const next = { left: combine(equation.left.map(negate)), right: combine(equation.right.map(negate)) };
    return { next, label: "flipped the sign of both sides (× −1)" };
  };

  /** Distribute a group's factor over its parenthesis: a(bx + c) → abx + ac */
  const tryDistributeFactor = (termId: string, from: Side): MoveResult => {
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "group") return null;
    const label = `distributed ${termText(source, true).trim().startsWith("−") ? `−${Math.abs(source.num)}` : Math.abs(source.num)}${
      source.den !== 1 ? `/${source.den}` : ""
    } over (${innerText(source.inner)})`;
    const expanded = source.inner.map((l) => leaf(l.num * source.num, l.power, l.den * source.den));
    const rest = equation[from].filter((t) => t.id !== termId);
    const next = { ...equation, [from]: combine([...rest, ...expanded]) } as EquationState;
    return { next, label };
  };

  /** Divide both sides by x: every power drops by one. Assumes x ≠ 0. */
  const tryDivideByX = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const xTerm = equation[from].find((t) => t.id === termId);
    if (!xTerm || xTerm.kind !== "leaf" || !(xTerm.power === 1 || xTerm.power === 2)) return null;
    if (hasGroups) return "distribute the parentheses first";
    if (hasFuncs) return "unwrap the function first";
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power === -1)) {
      return "that would nest x deeper than this playground supports";
    }
    const divide = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power - 1) as Power, t.den) : t);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    return {
      next,
      label: "divided both sides by x",
      dangerous: true,
      note: "assumes x ≠ 0 — a solution x = 0 would be lost",
      pill: "x ≠ 0",
    };
  };

  /** Divide both sides by a whole term's value (dragged under another term) */
  const tryDivideByTerm = (ids: string[], from: Side): MoveResult => {
    if (ids.length !== 1) return "divide by a single term at a time";
    const source = equation[from].find((t) => t.id === ids[0]);
    if (!source) return null;
    if (source.kind !== "leaf") return "dividing by parentheses or functions isn't playable yet";
    if (source.pm || source.radical || source.fnVal || source.num === 0) return "can't divide by that";
    const p = source.power;
    if (p !== 0) {
      if (hasGroups) return "distribute the parentheses first";
      if (hasFuncs) return "unwrap the function first";
      const outOfRange = [...equation.left, ...equation.right].some(
        (t) => t.kind === "leaf" && (t.power - p < -1 || t.power - p > 2)
      );
      if (outOfRange) return "that would push a power beyond this playground";
    }
    const apply = (t: EqTerm): EqTerm => {
      const scaled = scaleDen(scaleNum(t, source.den), source.num);
      if (p === 0 || scaled.kind !== "leaf") return scaled;
      return leaf(scaled.num, (scaled.power - p) as Power, scaled.den);
    };
    const next = { left: combine(equation.left.map(apply)), right: combine(equation.right.map(apply)) };
    return {
      next,
      label: `divided both sides by ${termText(source, true).trim()}`,
      dangerous: p > 0,
      note: p > 0 ? "assumes x ≠ 0 — a solution x = 0 would be lost" : undefined,
      pill: p > 0 ? "x ≠ 0" : undefined,
    };
  };

  /** Multiply both sides by x: every power rises by one. Hides the original x ≠ 0 domain. */
  const tryMultiplyByX = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== -1) return null;
    if (hasGroups) return "distribute the parentheses first";
    if (hasFuncs) return "unwrap the function first";
    if ([...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power >= 1)) {
      return "that would raise a power beyond this playground (for now)";
    }
    const multiply = (t: EqTerm) => (t.kind === "leaf" ? leaf(t.num, (t.power + 1) as Power, t.den) : t);
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    return {
      next,
      label: "multiplied both sides by x",
      dangerous: true,
      note: "the original equation required x ≠ 0 — that rule is now invisible",
      pill: "x ≠ 0",
    };
  };

  /** Take the square root of both sides: x² = c → x = ±√c (both roots kept) */
  const tryTakeSquareRoot = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== 2) return null;
    if (equation[from].length !== 1) return "move the other terms away first — the x² term must be alone";
    if (!(source.num === 1 && source.den === 1)) {
      return source.num < 0
        ? "flip the sign of both sides first — the square root needs a bare x²"
        : "divide away the coefficient first — the square root needs a bare x²";
    }
    const other = equation[to];
    if (other.length !== 1 || other[0].kind !== "leaf" || other[0].power !== 0 || other[0].pm || other[0].radical || other[0].fnVal) {
      return "gather everything else on the other side first";
    }
    const c = other[0];
    if (c.num < 0) return "x² can never equal a negative number — no real solutions here";
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
    return { next, label: "took the square root of both sides", note: "keeping ± — both roots survive" };
  };

  /** Unwrap a function by applying its inverse to both sides: fn(x) = c → x = fn⁻¹(c) */
  const tryUnwrapFunction = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "func") return null;
    if (equation[from].length !== 1) return "move the other terms away first — the function must be alone on its side";
    if (!(source.num === 1 && source.den === 1)) {
      return source.num < 0
        ? "flip the sign of both sides first — the inverse needs a bare function"
        : "divide away the coefficient first — the inverse needs a bare function";
    }
    const other = equation[to];
    if (other.length !== 1 || other[0].kind !== "leaf" || other[0].power !== 0 || other[0].pm || other[0].radical || other[0].fnVal) {
      return "gather a single plain number on the other side first";
    }
    const c = other[0];
    if (source.fn === "exp" && c.num <= 0) return "e^x is always positive — it can never equal a number ≤ 0";
    if ((source.fn === "sin" || source.fn === "cos") && Math.abs(c.num / c.den) > 1) {
      return `${source.fn} never leaves [−1, 1] — no solution here`;
    }
    const INVERSE: Record<FuncName, string> = { sin: "arcsin", cos: "arccos", tan: "arctan", ln: "e^", exp: "ln" };
    const LABEL: Record<FuncName, string> = {
      sin: "applied arcsin to both sides",
      cos: "applied arccos to both sides",
      tan: "applied arctan to both sides",
      ln: "exponentiated both sides (e to each side)",
      exp: "took the natural log of both sides",
    };
    // Exact special values keep the result rational
    let result: LeafTerm;
    if (
      (source.fn === "exp" && c.num === 1 && c.den === 1) ||
      ((source.fn === "sin" || source.fn === "tan") && c.num === 0) ||
      (source.fn === "cos" && c.num === 1 && c.den === 1)
    ) {
      result = leaf(0);
    } else if (source.fn === "ln" && c.num === 0) {
      result = leaf(1);
    } else {
      result = { ...leaf(c.num, 0, c.den), fnVal: INVERSE[source.fn] };
    }
    const isTrig = source.fn === "sin" || source.fn === "cos" || source.fn === "tan";
    const next = {
      ...equation,
      [from]: combine(source.inner.map((l) => leaf(l.num, l.power, l.den))),
      [to]: [result],
    } as EquationState;
    return {
      next,
      label: LABEL[source.fn],
      dangerous: isTrig,
      note: isTrig ? "principal value only — the periodic solutions are dropped" : undefined,
      pill: isTrig ? "principal value" : undefined,
    };
  };

  const loadPreset = (index: number) => {
    const state = PRESETS[index].make();
    setPresetIndex(index);
    setEquation(state);
    setHistory([makeStep("start", state)]);
    setSelection(null);
    setNotice(null);
  };

  // Typed equation: live pretty-math preview and Enter-to-load
  const inputPreview = useMemo(
    () => (inputText.trim() ? renderMathPreview(inputText) : null),
    [inputText]
  );

  const submitInput = () => {
    const result = parseEquation(inputText);
    if (result.ok) {
      setPresetIndex(-1);
      setEquation(result.state);
      setHistory([makeStep("start", result.state)]);
      setSelection(null);
      setNotice(null);
      setInputMsg(null);
    } else {
      setInputMsg({ kind: result.stage === "parse" ? "err" : "warn", text: result.message });
    }
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
    setDragActive(true);
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

  const previewKeyRef = useRef<string | null>(null);

  const finishDrag = () => {
    dragPayloadRef.current = null;
    previewKeyRef.current = null;
    setDragOver(null);
    setParenHover(null);
    setDragPreview(null);
    setDragActive(false);
    setUnderHover(null);
  };

  type DropTarget =
    | { kind: "side"; side: Side }
    | { kind: "parens"; termId: string; side: Side }
    | { kind: "under"; termId: string; side: Side };

  /** The single dispatcher shared by real drops and the mid-drag preview */
  const computeDrop = (payload: DragPayload, target: DropTarget): MoveResult => {
    if (hasTerminal) return "± roots and inverse values are an end state — rewind from the history menu";
    if (target.kind === "parens") {
      if (payload.kind === "factor" && payload.termId === target.termId) {
        return tryDistributeFactor(payload.termId, target.side);
      }
      return null;
    }
    if (target.kind === "under") {
      // Denominator position: the dragged thing divides both sides
      const across = opposite(payload.from);
      switch (payload.kind) {
        case "xdiv":
          return tryDivideByX(payload.termId, payload.from, across);
        case "coef":
        case "factor":
          return tryDivideByNumber(payload.termId, payload.from, across);
        case "terms":
          return tryDivideByTerm(payload.ids, payload.from);
        case "neg":
          return tryDivideByTerm([payload.termId], payload.from);
        case "den":
          return "a denominator multiplies — drop it beside the other side";
        case "xmul":
          return "that x multiplies — drop it beside the other side";
        case "exp":
          return "the exponent takes the square root — drag it across the equals sign";
        case "fn":
          return "functions unwrap — drag the name across the equals sign";
      }
    }
    const to = target.side;
    switch (payload.kind) {
      case "terms":
        return tryMoveTerms(payload.ids, payload.from, to);
      case "coef":
        return tryDivideByNumber(payload.termId, payload.from, to);
      case "factor":
        return tryDivideByNumber(payload.termId, payload.from, to, true);
      case "den":
        return tryMultiplyByDenominator(payload.termId, payload.from, to);
      case "neg":
        return tryNegateBothSides(payload.termId, payload.from, to);
      case "xdiv":
        // Beside the terms, the x moves its whole term; under a term it divides
        return tryMoveTerms([payload.termId], payload.from, to);
      case "xmul":
        return tryMultiplyByX(payload.termId, payload.from, to);
      case "exp":
        return tryTakeSquareRoot(payload.termId, payload.from, to);
      case "fn":
        return tryUnwrapFunction(payload.termId, payload.from, to);
    }
  };

  /** Live outcome preview: what would happen if the drag were released here */
  const updatePreview = (payload: DragPayload, target: DropTarget) => {
    const key = JSON.stringify([payload, target]);
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;
    const result = computeDrop(payload, target);
    if (result === null) setDragPreview({ kind: "cancel", text: "" });
    else if (typeof result === "string") setDragPreview({ kind: "reject", text: result });
    else setDragPreview({ kind: "ok", text: equationText(result.next) });
  };

  const performDrop = (payload: DragPayload, target: DropTarget) => {
    const result = computeDrop(payload, target);
    if (result === null) return;
    if (typeof result === "string") {
      flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
      return;
    }
    commitMove(result.label, result.next, result.dangerous, result.note, result.pill);
  };

  const onDrop = (e: DragEvent, target: DropTarget) => {
    e.preventDefault();
    try {
      const payload = JSON.parse(e.dataTransfer.getData("text/plain")) as DragPayload;
      performDrop(payload, target);
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

  /** What the dragged thing reads as, for ghost slots */
  const payloadGlyph = (p: DragPayload): string => {
    const findTerm = (id: string) => equation[p.from].find((t) => t.id === id);
    switch (p.kind) {
      case "xdiv":
      case "xmul":
        return "x";
      case "coef":
      case "factor": {
        const t = findTerm(p.termId);
        return t ? String(Math.abs(t.num)) : "?";
      }
      case "den": {
        const t = findTerm(p.termId);
        return t ? String(t.den) : "?";
      }
      case "neg": {
        const t = findTerm(p.termId);
        return t ? termText(t, true).trim() : "−";
      }
      case "terms": {
        const ts = equation[p.from].filter((t) => p.ids.includes(t.id));
        return ts.map((t, i) => termText(t, i === 0)).join("").trim() || "?";
      }
      case "exp":
        return "√";
      case "fn": {
        const t = findTerm(p.termId);
        return t && t.kind === "func" ? t.fn : "fn";
      }
    }
  };

  /** Ghost chip appended to a side while it is the drop target (term moves etc.) */
  const sideGhost = (side: Side): ReactNode => {
    const p = dragPayloadRef.current;
    if (!p || p.from === side) return null;
    let text: string | null = null;
    if (p.kind === "terms") {
      const ts = equation[p.from].filter((t) => p.ids.includes(t.id));
      text = ts.map((t, i) => termText(scaleNum(t, -1), i === 0)).join("").trim();
    } else if (p.kind === "xdiv") {
      const t = equation[p.from].find((t) => t.id === p.termId);
      if (t) text = termText(scaleNum(t, -1), true).trim();
    } else if (p.kind === "neg") {
      text = "× −1";
    } else if (p.kind === "coef" || p.kind === "factor") {
      const t = equation[p.from].find((t) => t.id === p.termId);
      if (t) text = `÷${Math.abs(t.num)}`;
    } else if (p.kind === "den") {
      const t = equation[p.from].find((t) => t.id === p.termId);
      if (t) text = `×${t.den}`;
    } else if (p.kind === "xmul") {
      text = "×x";
    }
    if (!text) return null;
    return (
      <span className="ml-4 self-center rounded-md border-2 border-dashed border-amber-400 px-2 py-1 text-[0.45em] leading-none text-amber-500">
        {text}
      </span>
    );
  };

  /**
   * Positional drop zones around a term. The lower half of every term is a
   * "denominator zone": hovering it morphs the term in place — it shrinks
   * into numerator position over a bar, with a dashed slot showing where the
   * dragged glyph will land — and dropping divides both sides.
   */
  const withZones = (t: EqTerm, side: Side, content: ReactNode) => {
    const payload = dragPayloadRef.current;
    const ghosted = dragActive && underHover === t.id && payload;
    return (
      <span key={t.id} className="relative inline-flex items-center">
        {ghosted ? (
          <span className="inline-flex flex-col items-center self-center leading-none">
            <span className="inline-flex origin-bottom scale-[0.62] items-center">{content}</span>
            <span className="my-[0.1em] h-[0.08em] w-full min-w-[1.2em] rounded bg-amber-400" aria-hidden />
            <span className="rounded-md border-2 border-dashed border-amber-400 px-[0.3em] py-[0.05em] text-[0.5em] leading-tight text-amber-500">
              {payloadGlyph(payload)}
            </span>
          </span>
        ) : (
          content
        )}
        {dragActive && (
          <span
            data-under-zone={t.id}
            className="absolute inset-x-0 -bottom-[0.35em] top-1/2 z-10"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setUnderHover(t.id);
              setDragOver(null);
              const p = dragPayloadRef.current;
              if (p) updatePreview(p, { kind: "under", termId: t.id, side });
            }}
            onDragLeave={() => setUnderHover((cur) => (cur === t.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const p = dragPayloadRef.current;
              if (p) performDrop(p, { kind: "under", termId: t.id, side });
              finishDrag();
            }}
          />
        )}
      </span>
    );
  };

  /** The magnitude portion of a leaf term (numeral, x, fraction) */
  const renderLeafBody = (t: LeafTerm, side: Side, highlighted: boolean, opts: { termId?: string; inert?: boolean } = {}) => {
    const termId = opts.termId ?? t.id;
    const inert = opts.inert ?? false;
    const magnitude = Math.abs(t.num);
    const canDivide = !inert && magnitude > 1;
    const divideTitle = `Drag across the equals sign to divide both sides by ${magnitude}`;
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
            role={inert ? "term" : "xdiv"}
            highlighted={highlighted}
            blue={!inert}
            handlers={symHandlers}
            title={
              inert
                ? undefined
                : "Drag beside the other side to move the term — or under a term to divide both sides by x"
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
        if (payload) {
          // Only ring the side a drop here would actually act on
          setDragOver(payload.from === side ? null : side);
          setUnderHover(null);
          updatePreview(payload, { kind: "side", side });
        }
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop(e, { kind: "side", side }); // dropping back on the source side is a cancel
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
          return withZones(t, side, (
            <span className="inline-flex items-center">
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
                    updatePreview(payload, { kind: "parens", termId: t.id, side });
                  }
                }}
                onDragLeave={() => setParenHover((cur) => (cur === t.id ? null : cur))}
                onDrop={(e) => {
                  const payload = dragPayloadRef.current;
                  if (payload?.kind === "factor" && payload.termId === t.id) {
                    e.preventDefault();
                    e.stopPropagation();
                    performDrop(payload, { kind: "parens", termId: t.id, side });
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
          ));
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
          return withZones(t, side, (
            <span className="inline-flex items-center">
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
                    title={`Drag across the equals sign to divide both sides by ${coefMag}`}
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
          ));
        }

        return withZones(t, side, (
          <span className="inline-flex items-center">
            {(i > 0 || t.num < 0) && sign}
            {renderLeafBody(t, side, highlighted)}
          </span>
        ));
      })}
      {dragActive && dragOver === side && !underHover && sideGhost(side)}
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
        if (payload) {
          setDragOver(opposite(payload.from));
          setUnderHover(null);
          updatePreview(payload, { kind: "side", side: opposite(payload.from) });
        }
      }}
      onDrop={(e) => {
        const payload = dragPayloadRef.current;
        if (payload) onDrop(e, { kind: "side", side: opposite(payload.from) });
      }}
    >
      {/* Typed equation input with live parse preview */}
      <div className="absolute left-1/2 top-4 w-[min(560px,75vw)] -translate-x-1/2" data-ui>
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 shadow-sm transition-colors focus-within:border-foreground/40">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setInputMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitInput();
            }}
            placeholder="type an equation… e.g. 2(x + 3) = 8"
            spellCheck={false}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        {(inputPreview || inputMsg) && (
          <div className="mt-2 flex flex-col items-center gap-1">
            {inputPreview && <div className="font-serif text-2xl">{inputPreview}</div>}
            {inputMsg && (
              <div className={`text-xs ${inputMsg.kind === "err" ? "text-rose-500" : "text-amber-600"}`}>
                {inputMsg.text}
              </div>
            )}
            {inputPreview && !inputMsg && (
              <div className="text-xs text-muted-foreground/70">press Enter to load</div>
            )}
          </div>
        )}
      </div>

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
        {dragPreview ? (
          dragPreview.kind === "ok" ? (
            <span className="font-serif text-base">→ {dragPreview.text}</span>
          ) : dragPreview.kind === "reject" ? (
            <span className="text-rose-400">{dragPreview.text}</span>
          ) : (
            <span className="text-muted-foreground/60">release here to cancel</span>
          )
        ) : notice ? (
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
          {presetIndex === -1 && <option value={-1}>custom</option>}
          {PRESETS.map((preset, i) => (
            <option key={preset.name} value={i}>
              {preset.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => restoreStep(0)}
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
