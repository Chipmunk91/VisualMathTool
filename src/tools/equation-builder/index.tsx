import { useEffect, useMemo, useRef, useState, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ChevronDown, History, Play, Search, Square, TriangleAlert } from "lucide-react";
import {
  Power,
  LeafTerm,
  FuncTerm,
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
  varOf,
  gcd,
  reTerm,
  type Variable,
} from "./model";
import { parseEquation, renderMathPreview, type ParseResult } from "./parse";
import { CATALOG, searchCatalog, type CatalogEntry } from "./catalog";
import { GraphPane, GraphView, evalSide, isFunctionEquation } from "./graph";
import { MappingPane } from "./mapping";
import {
  TNode,
  TreeEq,
  addendsOf,
  cloneTreeEq,
  constValue,
  evalNode,
  printNode,
  printTreeEq,
  simplify as simplifyTree,
  antiderivative,
  derivative,
  flatToTree,
  introducesLnOf,
  keyOf,
  splitCoef,
  tc,
  tmul,
  tpow,
  treeSideToFlat,
  tv,
  varsIn,
} from "./tree";
import { TangentPane } from "./tangent";
import { AreaPane } from "./area";
import { sharedFromUrl, shareUrl, type MoveStory } from "./share";
import { embedSnippet, isEmbed } from "../../lib/embed";
import {
  applyToolT,
  divideBothT,
  finalize,
  moveTermsT,
  multiplyBothT,
  type TreeMoveResult,
  type TreeOutcome,
} from "./treemoves";
import { TreeSideView } from "./treeview";

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

/** The equation on first load — everything else arrives via typing or search */
const INITIAL = (): EquationState => ({ left: [leaf(2, 1), leaf(-3)], right: [leaf(-7)] });

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** x³ etc. in plain text */
export const supText = (n: number): string =>
  (n < 0 ? "⁻" : "") + String(Math.abs(n)).split("").map((d) => SUP[Number(d)]).join("");

/** Display sign of a term (terminal values carry theirs in `neg`) */
const negOf = (t: EqTerm): boolean =>
  t.kind === "leaf" && (t.pm || t.radical || t.fnVal) ? !!t.neg : t.num < 0;

/** Plain-text rendering of a term, for history rows and labels */
function termText(t: EqTerm, leading: boolean): string {
  const negative = t.kind === "leaf" && (t.pm || t.radical || t.fnVal) ? !!t.neg : t.num < 0;
  const sign = negative ? "−" : "+";
  const prefix = leading ? (negative ? "−" : "") : ` ${sign} `;
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
  } else if (t.power >= 1) {
    body = `${coefStr}${varOf(t)}${t.power > 1 ? supText(t.power) : ""}`;
  } else if (t.power === 0) {
    body = t.den === 1 ? String(mag) : `${mag}/${t.den}`;
  } else {
    const denVar = `${varOf(t)}${t.power < -1 ? supText(-t.power) : ""}`;
    body = `${mag}/${t.den === 1 ? denVar : `${t.den}${denVar}`}`;
  }
  return prefix + body;
}

const innerText = (terms: EqTerm[]) => terms.map((t, i) => termText(t, i === 0)).join("");
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
  /** Present when this step lives in the expression tree (frontier mode) */
  tree?: TreeEq;
  /** how this step's move happened — drives the replay choreography */
  story?: MoveStory;
  text: string;
}

let stepCounter = 0;
const makeStep = (
  label: string,
  state: EquationState,
  dangerous?: boolean,
  note?: string,
  pill?: string,
  story?: MoveStory
): Step => ({
  id: stepCounter++,
  label,
  note,
  dangerous,
  pill,
  story,
  state: cloneState(state),
  text: equationText(state),
});

/** A harmless flat placeholder while the equation lives in the tree */
const TREE_DUMMY = (): EquationState => ({ left: [leaf(0)], right: [leaf(0)] });

const makeTreeStep = (label: string, tree: TreeEq, dangerous?: boolean, note?: string, pill?: string): Step => ({
  id: stepCounter++,
  label,
  note,
  dangerous,
  pill,
  state: TREE_DUMMY(),
  tree: cloneTreeEq(tree),
  text: printTreeEq(tree),
});

type Role = "term" | "coef" | "numer" | "den" | "neg" | "xdiv" | "xmul" | "factor" | "exp" | "fn";

/** Toolbox operations that apply to both sides of the equation */
type ToolKind = "ln" | "exp" | "sin" | "cos" | "tan" | "sqrt" | "square" | "recip";

interface ToolItem {
  glyph: string;
  tool?: ToolKind; // absent = shown as roadmap, disabled
  /** click-only operators with their own gate (calculus needs function mode) */
  action?: "ddx" | "int";
  title?: string;
}

const TOOLBOX: { id: string; label: string; items: ToolItem[] }[] = [
  {
    id: "functions",
    label: "Functions",
    items: [
      { glyph: "ln", tool: "ln", title: "Take ln of both sides" },
      { glyph: "eˣ", tool: "exp", title: "Exponentiate both sides (e to each side)" },
      { glyph: "sin", tool: "sin", title: "Take sin of both sides" },
      { glyph: "cos", tool: "cos", title: "Take cos of both sides" },
      { glyph: "tan", tool: "tan", title: "Take tan of both sides" },
    ],
  },
  {
    id: "powers",
    label: "Powers",
    items: [
      { glyph: "√", tool: "sqrt", title: "Take the square root of both sides" },
      { glyph: "( )²", tool: "square", title: "Square both sides" },
      { glyph: "1⁄( )", tool: "recip", title: "Take the reciprocal of both sides" },
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    items: [{ glyph: "d⁄dx", action: "ddx" }, { glyph: "∫", action: "int" }, { glyph: "Σ" }, { glyph: "lim" }],
  },
];

interface SymbolHandlers {
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
    data-role={role}
    onPointerEnter={blue ? undefined : () => handlers.hover(termId)}
    onPointerLeave={blue ? undefined : () => handlers.hover(null)}
    title={title ?? "Drag across the equals sign — or sweep empty space to select a block"}
    className={`-my-[0.16em] cursor-grab select-none py-[0.16em] transition-colors duration-150 active:cursor-grabbing ${
      highlighted ? "text-amber-500" : blue ? "hover:text-amber-500" : ""
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
  /** which variable the denominator shows (default x) */
  denVarText?: string;
  /** exponent on the denominator variable (2 → x²) */
  denVarPower?: number;
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
  denVarText = "x",
  denVarPower = 1,
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
    <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
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
          title={inert ? undefined : `Drag across to multiply both sides by ${denVarText}`}
          className="italic"
        >
          {denVarText}
          {denVarPower > 1 && (
            <span className="self-start mt-[0.06em] text-[0.6em] not-italic leading-none">{denVarPower}</span>
          )}
        </Sym>
      )}
    </span>
  </span>
);

const EquationBuilderTool = () => {
  const [equation, setEquation] = useState<EquationState>(() => INITIAL());
  /** Non-null when the equation lives in the expression tree (frontier mode) */
  const [treeEq, setTreeEq] = useState<TreeEq | null>(null);
  const [history, setHistory] = useState<Step[]>(() => [makeStep("start", INITIAL())]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [parenHover, setParenHover] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ side: Side; termIds: string[] } | null>(null);
  const [hoveredTermId, setHoveredTermId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ kind: "ok" | "reject" | "cancel"; text: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [devHitboxes, setDevHitboxes] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const toolGroupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [underHover, setUnderHover] = useState<string | null>(null);
  const underHoverRef = useRef<string | null>(null);
  const [termHover, setTermHover] = useState<string | null>(null);
  const termHoverRef = useRef<string | null>(null);
  const [branchPick, setBranchPick] = useState<string | null>(null);
  const [expHover, setExpHover] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputMsg, setInputMsg] = useState<{ kind: "err" | "warn"; text: string } | null>(null);
  /** magnifier toggled: words find famous functions instead of parsing math */
  const [searchMode, setSearchMode] = useState(false);
  /** keyboard-highlighted row in the search dropdown */
  const [searchSel, setSearchSel] = useState(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const equationRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Replay: animate the derivation from step 0 to the latest form ------
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const playingRef = useRef(false);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPlayback = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    playingRef.current = false;
    setPlaying(false);
    clearOverlay();
    setHistory((h) => {
      const last = h[h.length - 1];
      setEquation(cloneState(last.state));
      setTreeEq(last.tree ? cloneTreeEq(last.tree) : null);
      return h;
    });
  };

  /**
   * The Graspable-style transition: a shared-element pass at the GLYPH level.
   * Every leaf glyph of the old state is snapshotted (text + position +
   * typography), the new state renders hidden, and glyphs are matched by
   * CONTENT — an "x" is an "x" whichever term rebuilt it. Matched glyphs
   * glide from their old spot to their new one on a fixed overlay; removed
   * glyphs fade away in place; arriving glyphs fade in at their destination.
   * Live DOM measurement + CSS transforms — no pre-rendered frames anywhere.
   */
  interface Glyph {
    key: string;
    text: string;
    rect: DOMRect;
    /** typography captured AT SNAPSHOT TIME — the element may detach later */
    font: string;
    color: string;
    isBar: boolean;
    /** which term this glyph belongs to, and its role — provenance anchors */
    term: string | null;
    role: string | null;
  }
  const FLY_MS = 620;

  const snapshotGlyphs = (): Glyph[] => {
    const out: Glyph[] = [];
    equationRef.current?.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (el.children.length > 0) return; // leaves only
      const text = (el.textContent ?? "").trim();
      const isBar = !text && el.getAttribute("aria-hidden") === "true";
      if (!text && !isBar) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const cs = getComputedStyle(el);
      const owner = el.closest<HTMLElement>("[data-term-id]") ?? el.closest<HTMLElement>("[data-term-wrap]");
      out.push({
        key: isBar ? "—bar—" : text,
        text,
        rect,
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        color: cs.color,
        isBar,
        term: owner?.dataset.termId ?? owner?.dataset.termWrap ?? null,
        role: el.dataset.role ?? null,
      });
    });
    return out;
  };

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const clearOverlay = () => {
    overlayRef.current?.remove();
    overlayRef.current = null;
    if (equationRef.current) equationRef.current.style.opacity = "";
  };

  /** A free-standing copy of one glyph — self-styled, no class inheritance */
  const makeClone = (g: Glyph, overlay: HTMLDivElement): HTMLElement => {
    const clone = document.createElement("div");
    if (!g.isBar) clone.textContent = g.text;
    clone.style.cssText =
      `position:fixed;left:${g.rect.left}px;top:${g.rect.top}px;` +
      `width:${g.rect.width}px;height:${g.rect.height}px;margin:0;padding:0;` +
      `display:flex;align-items:center;justify-content:center;white-space:pre;` +
      `font:${g.font};color:${g.color};line-height:1;transform-origin:0 0;` +
      `will-change:transform,opacity;` +
      (g.isBar ? `background:${g.color};border-radius:2px;` : "");
    overlay.appendChild(clone);
    return clone;
  };

  /**
   * The continuous scene, in two beats. BEFORE the state switches, the old
   * view is rebuilt as an overlay of self-styled clones and the real
   * container hides — pixel-identical, so no frame is ever blank or doubled.
   * AFTER the new layout exists (still hidden), each clone is retargeted:
   * matched glyphs glide to their new spot, departing ones fade in place,
   * arriving ones fade in at their destination. Only when the clones have
   * landed does the real equation take over.
   */
  const beginGlyphTransition = (story?: MoveStory): (() => void) => {
    const olds = snapshotGlyphs();
    clearOverlay();
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:45;";
    document.body.appendChild(overlay);
    overlayRef.current = overlay;
    const clones = olds.map((g) => ({ g, node: makeClone(g, overlay) }));
    if (equationRef.current) equationRef.current.style.opacity = "0";

    return () => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!playingRef.current || overlayRef.current !== overlay) return;
          const news = snapshotGlyphs();
          const easing = "cubic-bezier(0.35, 0.8, 0.3, 1)";
          type Clone = (typeof clones)[number];

          const glide = (c: Clone, to: Glyph) => {
            const dx = to.rect.left - c.g.rect.left;
            const dy = to.rect.top - c.g.rect.top;
            const sx = c.g.rect.width > 0 ? to.rect.width / c.g.rect.width : 1;
            const sy = c.g.rect.height > 0 ? to.rect.height / c.g.rect.height : 1;
            c.node.animate(
              [
                { transform: "translate(0, 0) scale(1, 1)" },
                { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
              ],
              { duration: FLY_MS, easing, fill: "forwards" }
            );
          };
          const fadeOut = (c: Clone) =>
            c.node.animate([{ opacity: 1 }, { opacity: 0, offset: 0.6 }, { opacity: 0 }], {
              duration: FLY_MS,
              easing: "ease-in",
              fill: "forwards",
            });
          const fadeIn = (n: Glyph) => {
            const born = makeClone(n, overlay);
            born.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], {
              duration: FLY_MS,
              easing: "ease-out",
              fill: "forwards",
            });
          };
          const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

          // ---- story choreography: actors converge, results are born ------
          const actorSet = new Map<string, string | null>();
          story?.actors.forEach((a) => actorSet.set(a.term, a.role ?? null));
          const siteSet = new Set(story?.site ?? []);
          const bornSet = new Set(story?.born ?? []);
          const newTermIds = new Set(news.map((g) => g.term).filter(Boolean));

          const isActor = (g: Glyph) =>
            !!g.term &&
            actorSet.has(g.term) &&
            (actorSet.get(g.term) === null || g.role === actorSet.get(g.term)) &&
            // an actor whose term survives isn't consumed — it just travels
            (actorSet.get(g.term) !== null || !newTermIds.has(g.term));
          const actorClones = clones.filter((c) => isActor(c.g));
          const siteClones = clones.filter((c) => c.g.term && siteSet.has(c.g.term) && !isActor(c.g));
          const bornGlyphs = news.filter((g) => g.term && bornSet.has(g.term));

          const bornCenter =
            bornGlyphs.length > 0
              ? center(
                  bornGlyphs.reduce(
                    (acc, g) =>
                      new DOMRect(
                        Math.min(acc.left, g.rect.left),
                        Math.min(acc.top, g.rect.top),
                        Math.max(acc.right, g.rect.right) - Math.min(acc.left, g.rect.left),
                        Math.max(acc.bottom, g.rect.bottom) - Math.min(acc.top, g.rect.top)
                      ),
                    bornGlyphs[0].rect
                  )
                )
              : siteClones.length > 0
                ? center(siteClones[0].g.rect)
                : null;

          for (const c of actorClones) {
            const from = center(c.g.rect);
            if (bornCenter) {
              // converge on the interaction site, shrinking out on contact
              c.node.animate(
                [
                  { transform: "translate(0,0) scale(1)", opacity: 1 },
                  {
                    transform: `translate(${bornCenter.x - from.x}px, ${bornCenter.y - from.y}px) scale(0.45)`,
                    opacity: 0,
                  },
                ],
                { duration: FLY_MS * 0.8, easing, fill: "forwards" }
              );
            } else {
              // no landing site (a divisor slipping under): drift down and out
              c.node.animate(
                [
                  { transform: "translate(0,0) scale(1)", opacity: 1 },
                  { transform: "translate(0, 22px) scale(0.7)", opacity: 0 },
                ],
                { duration: FLY_MS * 0.75, easing: "ease-in", fill: "forwards" }
              );
            }
          }
          for (const c of siteClones) {
            c.node.animate(
              [
                { transform: "translate(0,0) scale(1)", opacity: 1 },
                { transform: "translate(0,0) scale(0.6)", opacity: 0 },
              ],
              { duration: FLY_MS * 0.7, easing: "ease-in", fill: "forwards" }
            );
          }
          for (const n of bornGlyphs) {
            const to = center(n.rect);
            const fromX = bornCenter ? bornCenter.x - to.x : 0;
            const fromY = bornCenter ? bornCenter.y - to.y : 0;
            const born = makeClone(n, overlay);
            born.animate(
              [
                { transform: `translate(${fromX}px, ${fromY}px) scale(0.45)`, opacity: 0 },
                { transform: `translate(${fromX}px, ${fromY}px) scale(0.45)`, opacity: 0, offset: 0.35 },
                { transform: "translate(0,0) scale(1)", opacity: 1 },
              ],
              { duration: FLY_MS, easing, fill: "forwards" }
            );
          }

          // ---- everything else: pair by TERM ID first, then by content ----
          const storyHandledNew = new Set(bornGlyphs);
          const restClones = clones.filter((c) => !actorClones.includes(c) && !siteClones.includes(c));
          const restNews = news.filter((g) => !storyHandledNew.has(g));

          const oldByTerm = new Map<string, Clone[]>();
          restClones.forEach((c) => {
            if (!c.g.term) return;
            if (!oldByTerm.has(c.g.term)) oldByTerm.set(c.g.term, []);
            oldByTerm.get(c.g.term)!.push(c);
          });

          const globalOld: Clone[] = [];
          const globalNew: Glyph[] = [];
          const claimedOld = new Set<Clone>();

          const newByTerm = new Map<string, Glyph[]>();
          restNews.forEach((g) => {
            if (g.term && oldByTerm.has(g.term)) {
              if (!newByTerm.has(g.term)) newByTerm.set(g.term, []);
              newByTerm.get(g.term)!.push(g);
            } else {
              globalNew.push(g);
            }
          });

          // within a surviving term: same-text glyphs glide; leftovers are the
          // term's CHANGED VALUE — they morph in place (old out, new in)
          newByTerm.forEach((termNews, termId) => {
            const termOlds = oldByTerm.get(termId)!;
            const used = new Set<number>();
            const leftoverNews: Glyph[] = [];
            for (const n of termNews) {
              let best = -1;
              termOlds.forEach((c, i) => {
                if (used.has(i) || claimedOld.has(c) || c.g.key !== n.key) return;
                if (best === -1) best = i;
              });
              if (best >= 0) {
                used.add(best);
                claimedOld.add(termOlds[best]);
                glide(termOlds[best], n);
              } else {
                leftoverNews.push(n);
              }
            }
            const leftoverOlds = termOlds.filter((c, i) => !used.has(i) && !claimedOld.has(c));
            leftoverOlds.sort((a, b) => a.g.rect.left - b.g.rect.left);
            leftoverNews.sort((a, b) => a.rect.left - b.rect.left);
            const pairs = Math.min(leftoverOlds.length, leftoverNews.length);
            for (let k = 0; k < pairs; k++) {
              const o = leftoverOlds[k];
              const n = leftoverNews[k];
              claimedOld.add(o);
              // value morph: the old digits shrink toward the new spot as the
              // new digits grow in — 6 visibly becomes 3
              const dx = n.rect.left - o.g.rect.left;
              const dy = n.rect.top - o.g.rect.top;
              o.node.animate(
                [
                  { transform: "translate(0,0) scale(1)", opacity: 1 },
                  { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(0.6)`, opacity: 0 },
                ],
                { duration: FLY_MS * 0.65, easing, fill: "forwards" }
              );
              const grown = makeClone(n, overlay);
              grown.animate(
                [
                  { transform: "scale(0.6)", opacity: 0 },
                  { transform: "scale(0.6)", opacity: 0, offset: 0.3 },
                  { transform: "scale(1)", opacity: 1 },
                ],
                { duration: FLY_MS, easing, fill: "forwards" }
              );
            }
            leftoverOlds.slice(pairs).forEach((c) => {
              claimedOld.add(c);
              fadeOut(c);
            });
            leftoverNews.slice(pairs).forEach(fadeIn);
          });

          restClones.forEach((c) => {
            if (!claimedOld.has(c) && (!c.g.term || !newByTerm.has(c.g.term))) globalOld.push(c);
          });

          // global content matching for whatever provenance couldn't claim
          const groups = new Map<string, { olds: Clone[]; news: Glyph[] }>();
          const groupOf = (k: string) => {
            if (!groups.has(k)) groups.set(k, { olds: [], news: [] });
            return groups.get(k)!;
          };
          globalOld.forEach((c) => groupOf(c.g.key).olds.push(c));
          globalNew.forEach((g) => groupOf(g.key).news.push(g));
          groups.forEach(({ olds: oldClones, news: newGlyphs }) => {
            const used = new Set<number>();
            for (const n of newGlyphs.sort((a, b) => a.rect.left - b.rect.left)) {
              let best = -1;
              let bestDist = Infinity;
              oldClones.forEach((c, i) => {
                if (used.has(i)) return;
                const d = Math.abs(c.g.rect.left - n.rect.left) + Math.abs(c.g.rect.top - n.rect.top) * 2;
                if (d < bestDist) {
                  bestDist = d;
                  best = i;
                }
              });
              if (best >= 0) {
                used.add(best);
                glide(oldClones[best], n);
              } else {
                fadeIn(n);
              }
            }
            oldClones.forEach((c, i) => {
              if (!used.has(i)) fadeOut(c);
            });
          });

          // hand the stage back: reveal the real equation, then drop the overlay
          setTimeout(() => {
            if (overlayRef.current !== overlay) return;
            if (equationRef.current) equationRef.current.style.opacity = "";
            requestAnimationFrame(() => {
              if (overlayRef.current === overlay) {
                overlay.remove();
                overlayRef.current = null;
              }
            });
          }, FLY_MS + 30);
        })
      );
    };
  };

  const startPlayback = () => {
    if (playingRef.current) return;
    setHistory((h) => {
      if (h.length < 2) return h;
      playingRef.current = true;
      setPlaying(true);
      let i = 0;
      const showStep = () => {
        const step = h[i];
        // the overlay takes the stage BEFORE the state switches — no blank frame
        const retarget = i > 0 ? beginGlyphTransition(step.story) : null;
        setEquation(cloneState(step.state));
        setTreeEq(step.tree ? cloneTreeEq(step.tree) : null);
        setPlayIndex(i);
        retarget?.();
        if (i >= h.length - 1) {
          playTimer.current = setTimeout(stopPlayback, 1600);
          return;
        }
        i++;
        playTimer.current = setTimeout(showStep, 1450);
      };
      showStep();
      return h;
    });
  };

  // --- Share: the whole derivation in a link (or an embeddable iframe) ----
  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const currentShareUrl = () =>
    shareUrl({
      steps: history.map((s) => ({
        label: s.label,
        note: s.note,
        dangerous: s.dangerous,
        pill: s.pill,
        state: s.state,
        tree: s.tree,
        story: s.story,
      })),
    });
  const copyShare = () => {
    navigator.clipboard?.writeText(currentShareUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const copyEmbed = () => {
    navigator.clipboard?.writeText(embedSnippet(currentShareUrl(), "Equation Playground")).then(() => {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1500);
    });
  };

  // Restore a shared derivation from the URL, once, on mount
  useEffect(() => {
    const shared = sharedFromUrl();
    if (!shared) return;
    const steps: Step[] = shared.steps.map((s) => ({
      id: stepCounter++,
      label: s.label,
      note: s.note,
      dangerous: s.dangerous,
      pill: s.pill,
      story: s.story,
      state: cloneState(s.state),
      tree: s.tree ? cloneTreeEq(s.tree) : undefined,
      text: s.tree ? printTreeEq(s.tree) : equationText(s.state),
    }));
    const last = steps[steps.length - 1];
    setHistory(steps);
    setEquation(cloneState(last.state));
    setTreeEq(last.tree ? cloneTreeEq(last.tree) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shortcut into search mode: "/" (when not already typing) or Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      const palette = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (palette || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchMode(true);
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { left, right } = equation;

  // The "dangerous switches": standing assumptions introduced by past steps
  const assumptions = useMemo(
    () => Array.from(new Set(history.map((s) => s.pill).filter((p): p is string => !!p))),
    [history]
  );
  const xNonZeroAssumed = assumptions.includes("x ≠ 0");
  const nonZeroAssumed = (v: Variable) => assumptions.includes(`${v} ≠ 0`);

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  };

  /** Keep one branch of a ± value — the other solution is deliberately dropped */
  const pickBranch = (termId: string, side: Side, sign: 1 | -1) => {
    setBranchPick(null);
    const t = equation[side].find((x) => x.id === termId);
    if (!t || t.kind !== "leaf" || !t.pm) return;
    const chosen: LeafTerm =
      t.radical || t.fnVal
        ? { ...t, pm: false, neg: sign < 0 }
        : { ...leaf(sign * t.num, t.power, t.den, varOf(t)) };
    const next = {
      ...equation,
      [side]: equation[side].map((x) => (x.id === termId ? chosen : x)),
    } as EquationState;
    commitMove(
      `kept the ${sign > 0 ? "+" : "−"} branch`,
      next,
      true,
      "the other branch is dropped — remember it exists",
      `branch ${sign > 0 ? "+" : "−"}`
    );
  };

  const commitMove = (
    label: string,
    next: EquationState,
    dangerous?: boolean,
    note?: string,
    pill?: string,
    rebuild?: boolean,
    story?: MoveStory
  ) => {
    setEquation(next);
    if (rebuild) {
      // a building move rewrites the equation itself — new problem, new trail
      setHistory([makeStep(label, next, false, note)]);
    } else {
      setHistory((h) => [...h, makeStep(label, next, dangerous, note, pill, story)]);
    }
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

  /** Does a side mention a variable (in leaves, groups, or function args)? */
  const sideMentions = (terms: EqTerm[], v: Variable): boolean => {
    const mentions = (t: EqTerm): boolean =>
      t.kind === "leaf" ? t.power !== 0 && varOf(t) === v : t.inner.some(mentions);
    return terms.some(mentions);
  };

  /**
   * Solved: one side is the bare variable, the other holds no variable at
   * all — a rational (x = 3), a frozen value (x = ±√2), or a function of a
   * constant (x = ln 8, the shape tree endgames flatten into).
   */
  const solvedInfo = useMemo(() => {
    const bare = (a: EqTerm[]): LeafTerm | null =>
      a.length === 1 &&
      a[0].kind === "leaf" &&
      a[0].power === 1 &&
      a[0].num === 1 &&
      a[0].den === 1 &&
      !a[0].pm &&
      !a[0].radical &&
      !a[0].fnVal
        ? a[0]
        : null;
    const constSide = (b: EqTerm[]): EqTerm | null =>
      b.length === 1 && !sideMentions(b, "x") && !sideMentions(b, "y") ? b[0] : null;
    const detect = (a: EqTerm[], b: EqTerm[]) => {
      const v = bare(a);
      const c = constSide(b);
      return v && c ? { variable: varOf(v), term: c } : null;
    };
    return detect(left, right) ?? detect(right, left);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right]);
  const solved = !!solvedInfo;
  const solvedVar: Variable = solvedInfo?.variable ?? "x";
  const solvedTerm = solvedInfo?.term ?? null;
  const solvedArg =
    solvedTerm?.kind === "leaf" ? (solvedTerm.den === 1 ? String(solvedTerm.num) : `${solvedTerm.num}/${solvedTerm.den}`) : "";
  const solvedValue = solvedTerm
    ? solvedTerm.kind === "leaf"
      ? `${solvedTerm.pm ? "±" : solvedTerm.neg ? "−" : ""}${
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
      : termText(solvedTerm, true).trim()
    : null;
  // a numeric hint whenever the value isn't a plain rational
  const solvedApprox = useMemo(() => {
    if (!solvedTerm) return null;
    if (solvedTerm.kind === "leaf" && !solvedTerm.radical && !solvedTerm.fnVal) return null;
    if (solvedTerm.kind === "leaf" && solvedTerm.pm) return null; // two values — no single ≈
    const v = evalSide([solvedTerm], 0);
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  }, [solvedTerm]);
  const solvedContradiction =
    solved && solvedTerm?.kind === "leaf" && solvedTerm.num === 0 && nonZeroAssumed(solvedVar);

  /** Variable-free equations are a verdict: always true, or no solution */
  const flatStatus = useMemo(() => {
    if (treeEq || solvedInfo) return null;
    const constSide = (b: EqTerm[]) => b.length > 0 && !sideMentions(b, "x") && !sideMentions(b, "y");
    if (!constSide(left) || !constSide(right)) return null;
    const va = evalSide(left, 0);
    const vb = evalSide(right, 0);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
    return Math.abs(va - vb) < 1e-9 ? ("identity" as const) : ("contradiction" as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeEq, solvedInfo, left, right]);

  /**
   * Function mode: one side is a bare variable, the other side is an
   * expression purely in the OTHER variable — y = f(x) (or x = g(y)).
   */
  const functionMode = useMemo(() => {
    const bare = (terms: EqTerm[]): Variable | null =>
      terms.length === 1 &&
      terms[0].kind === "leaf" &&
      terms[0].power === 1 &&
      terms[0].num === 1 &&
      terms[0].den === 1 &&
      !terms[0].pm &&
      !terms[0].radical &&
      !terms[0].fnVal
        ? varOf(terms[0])
        : null;
    const detect = (a: EqTerm[], b: EqTerm[]) => {
      const out = bare(a);
      if (!out) return null;
      const input: Variable = out === "y" ? "x" : "y";
      if (sideMentions(b, out) || !sideMentions(b, input)) return null;
      return { output: out, input, rhs: b };
    };
    return detect(left, right) ?? detect(right, left);
  }, [left, right]);

  const mentionsY = sideMentions(left, "y") || sideMentions(right, "y");

  // --- Tree (frontier) mode: solved detection + which pane the equation earns
  const treeSolved = useMemo(() => {
    if (!treeEq) return null;
    const detect = (a: TNode, b: TNode) =>
      a.kind === "var" && varsIn(b).size === 0 ? { v: a.name, value: b } : null;
    const hit = detect(treeEq.left, treeEq.right) ?? detect(treeEq.right, treeEq.left);
    if (!hit) return null;
    const approx = constValue(hit.value);
    const exact = hit.value.kind === "const";
    return {
      v: hit.v,
      text: printNode(hit.value),
      approx: !exact && approx !== null ? Math.round(approx * 1000) / 1000 : null,
    };
  }, [treeEq]);

  /** Tree equations get the same verdicts: identical sides, or two constants */
  const treeStatus = useMemo(() => {
    if (!treeEq || treeSolved) return null;
    if (keyOf(treeEq.left) === keyOf(treeEq.right)) return "identity" as const;
    const lv = constValue(treeEq.left);
    const rv = constValue(treeEq.right);
    if (lv === null || rv === null) return null;
    return Math.abs(lv - rv) < 1e-9 ? ("identity" as const) : ("contradiction" as const);
  }, [treeEq, treeSolved]);

  const treePane = useMemo(() => {
    if (!treeEq) return null;
    const vars = new Set([...Array.from(varsIn(treeEq.left)), ...Array.from(varsIn(treeEq.right))]);
    // mapping pane when one side is a bare variable of the other: y = 2^x
    const detect = (a: TNode, b: TNode) => {
      if (a.kind !== "var") return null;
      const out = a.name;
      const input: Variable = out === "y" ? "x" : "y";
      const bv = varsIn(b);
      if (bv.has(out) || !bv.has(input)) return null;
      return { out, input, rhs: b };
    };
    const m = detect(treeEq.left, treeEq.right) ?? detect(treeEq.right, treeEq.left);
    if (m) return { kind: "mapping" as const, ...m };
    if (!vars.has("y") && vars.has("x")) return { kind: "graph" as const };
    return null;
  }, [treeEq]);

  /** Which view function mode shows: mapping, curve & slope, or area */
  const [fnView, setFnView] = useState<"mapping" | "slope" | "area">("mapping");
  /** Definite-integral bounds for the area view — draggable, or set by term drops */
  const [bounds, setBounds] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 2 });

  /** d/dx is only meaningful on an identity — exactly what function mode is */
  const ddxReady = treeEq ? treePane?.kind === "mapping" : !!functionMode;

  /**
   * Differentiate the function. Valid ONLY for y = f(x) (an identity in x);
   * the result is a NEW equation about the same function — not an equivalent
   * step — so the trail restarts, like a building move.
   */
  const applyDdx = () => {
    const fm = treeEq
      ? treePane?.kind === "mapping"
        ? { input: treePane.input, output: treePane.out, rhsTree: treePane.rhs }
        : null
      : functionMode
        ? { input: functionMode.input, output: functionMode.output, rhsTree: flatToTree(functionMode.rhs) }
        : null;
    if (!fm) {
      flashNotice("d/dx needs an identity — isolate y = f(x) first.");
      return;
    }
    const d = derivative(fm.rhsTree, fm.input);
    if (d === null) {
      flashNotice("That derivative needs a rule beyond this playground (a power with variable base AND exponent).");
      return;
    }
    const simplified = simplifyTree(d);
    const label = `differentiated — ${fm.output} now shows d${fm.output}/d${fm.input}`;
    const note = "a new equation about the same function, not an equivalent step";
    const lhs = leaf(1, 1, 1, fm.output);
    const fl = treeSideToFlat(simplified);
    if (fl) {
      const next: EquationState = { left: [lhs], right: combine(fl.length ? fl : [leaf(0)]) };
      setTreeEq(null);
      setEquation(next);
      setHistory([makeStep(label, next, false, note)]);
    } else {
      const nextTree: TreeEq = { left: tv(fm.output), right: simplified };
      setTreeEq(nextTree);
      setEquation(TREE_DUMMY());
      setHistory([makeTreeStep(label, nextTree, false, note)]);
    }
    setSelection(null);
    setNotice(null);
  };

  /**
   * Integrate the function: y = f(x) → y = F(x), one antiderivative of the
   * family F + C. The + C rides along as a pill; like d/dx this is a new
   * equation about the same function, so the trail restarts. Default is the
   * INDEFINITE integral — the definite one lives in the area view, where
   * bounds are dragged (or set by dropping numbers onto them).
   */
  const applyIntegral = () => {
    const fm = treeEq
      ? treePane?.kind === "mapping"
        ? { input: treePane.input, output: treePane.out, rhsTree: treePane.rhs }
        : null
      : functionMode
        ? { input: functionMode.input, output: functionMode.output, rhsTree: flatToTree(functionMode.rhs) }
        : null;
    if (!fm) {
      flashNotice("∫ needs an identity — isolate y = f(x) first.");
      return;
    }
    const F = antiderivative(fm.rhsTree, fm.input);
    if (F === null) {
      flashNotice("No rule reaches this integral — some (like e^(−x²)) provably have no elementary antiderivative.");
      return;
    }
    const simplified = simplifyTree(F);
    const lnCame = introducesLnOf(simplified, fm.input);
    const label = `integrated — ${fm.output} now shows an antiderivative`;
    const note =
      "one antiderivative of the family F + C (C = 0 shown)" +
      (lnCame ? "; ln|…| written without the bars — argument > 0 assumed" : "");
    const lhs = leaf(1, 1, 1, fm.output);
    const fl = treeSideToFlat(simplified);
    if (fl) {
      const next: EquationState = { left: [lhs], right: combine(fl.length ? fl : [leaf(0)]) };
      setTreeEq(null);
      setEquation(next);
      setHistory([makeStep(label, next, false, note, "+ C")]);
    } else {
      const nextTree: TreeEq = { left: tv(fm.output), right: simplified };
      setTreeEq(nextTree);
      setEquation(TREE_DUMMY());
      setHistory([makeTreeStep(label, nextTree, false, note, "+ C")]);
    }
    setSelection(null);
    setNotice(null);
  };

  // ± / radical / inverse results are an end state: no further arithmetic is defined on them
  const hasTerminal = [...left, ...right].some((t) => t.kind === "leaf" && (t.pm || t.radical || t.fnVal));
  const hasGroups = [...left, ...right].some((t) => t.kind === "group");
  const hasFuncs = [...left, ...right].some((t) => t.kind === "func");

  /** Keep powers within a sane display range (x⁻⁹ … x⁹) */
  const MAX_POWER = 9;
  const powersInRange = (shift: number): boolean =>
    ![...equation.left, ...equation.right].some(
      (t) => t.kind === "leaf" && t.power !== 0 && Math.abs(t.power + shift) > MAX_POWER
    );

  /** True when a powered leaf of the OTHER variable exists anywhere */
  const mixedWith = (v: Variable): boolean =>
    [...equation.left, ...equation.right].some(
      (t) => t.kind === "leaf" && t.power !== 0 && varOf(t) !== v
    );

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
    /** a building move: rewrites the equation itself and restarts the trail */
    rebuild?: boolean;
    /** provenance for the replay choreography — who interacted with whom */
    story?: MoveStory;
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
    // provenance: if combine() merged the traveler into a resident term, the
    // replay shows it converging on that term and the result being born there
    const oldTargetIds = new Set(equation[to].map((t) => t.id));
    const newTargetIds = new Set(next[to].map((t) => t.id));
    const consumedActors = real.filter((m) => !newTargetIds.has(m.id)).map((m) => m.id);
    const site = Array.from(oldTargetIds).filter((id) => !newTargetIds.has(id));
    const born = Array.from(newTargetIds).filter(
      (id) => !oldTargetIds.has(id) && !real.some((m) => m.id === id)
    );
    const story: MoveStory | undefined =
      consumedActors.length > 0 ? { actors: consumedActors.map((term) => ({ term })), site, born } : undefined;
    return { next, label: `moved ${real.map((m) => termText(m, true).trim()).join(", ")} across`, story };
  };

  /** Divide every term on both sides by the (positive) numeral that was dragged */
  const tryDivideByNumber = (termId: string, from: Side, to: Side, isFactor = false): MoveResult => {
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
    if (from === to) return isFactor ? "drop the factor onto the parenthesis to distribute it" : null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source) return null;
    const v = Math.abs(source.num);
    if (v <= 1) return null;
    const divide = (t: EqTerm) => scaleDen(t, v);
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    return {
      next,
      label: `divided both sides by ${v}`,
      // the dragged numeral is the actor; every term it divides keeps its id,
      // so their value changes morph in place via id-pairing
      story: { actors: [{ term: termId, role: isFactor ? "factor" : "coef" }], site: [], born: [] },
    };
  };

  /** Multiply every term on both sides by a fraction's numeric denominator */
  const tryMultiplyByDenominator = (termId: string, from: Side, to: Side): MoveResult => {
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
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

  /** Reverse distribution: pull the common numeric factor of two same-side
   *  terms into a parenthesis — 2x + 6 becomes 2(x + 3) */
  const tryFactorOut = (sourceId: string, targetId: string, side: Side): MoveResult => {
    const a = equation[side].find((t) => t.id === sourceId);
    const b = equation[side].find((t) => t.id === targetId);
    if (!a || !b || a.id === b.id) return null;
    if (a.kind !== "leaf" || b.kind !== "leaf") return "factoring works between plain terms";
    if (a.pm || a.radical || a.fnVal || b.pm || b.radical || b.fnVal)
      return "frozen values can't be factored";
    const g = gcd(Math.abs(a.num), Math.abs(b.num));
    if (g <= 1) return `${Math.abs(a.num)} and ${Math.abs(b.num)} share no common factor`;
    const inner = [
      leaf(a.num / g, a.power, a.den, varOf(a)),
      leaf(b.num / g, b.power, b.den, varOf(b)),
    ];
    const factored = group(g, inner);
    const nextSide = equation[side]
      .filter((t) => t.id !== sourceId)
      .map((t) => (t.id === targetId ? factored : t));
    const next = { ...equation, [side]: nextSide } as EquationState;
    return {
      next,
      label: `factored ${g} out of ${termText(a, true).trim()} and ${termText(b, true).trim()}`,
    };
  };

  /** Distribute a group's factor over its parenthesis: a(bx + c) → abx + ac */
  const tryDistributeFactor = (termId: string, from: Side): MoveResult => {
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "group") return null;
    const label = `distributed ${termText(source, true).trim().startsWith("−") ? `−${Math.abs(source.num)}` : Math.abs(source.num)}${
      source.den !== 1 ? `/${source.den}` : ""
    } over (${innerText(source.inner)})`;
    const expanded = source.inner.map((l) => scaleDen(scaleNum(l, source.num), source.den));
    const rest = equation[from].filter((t) => t.id !== termId);
    const next = { ...equation, [from]: combine([...rest, ...expanded]) } as EquationState;
    return { next, label };
  };

  /** Divide both sides by x: every power drops by one. Assumes x ≠ 0. */
  const tryDivideByX = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const xTerm = equation[from].find((t) => t.id === termId);
    if (!xTerm || xTerm.kind !== "leaf" || xTerm.power < 1) return null;
    const v = varOf(xTerm);
    if (hasGroups) return "distribute the parentheses first";
    if (hasFuncs) return "unwrap the function first";
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
    if (mixedWith(v)) return "x and y can't share a fraction — beyond this playground";
    if (!powersInRange(-1)) return "that would push a power past x⁹ — far enough";
    const divide = (t: EqTerm) =>
      t.kind === "leaf" ? leaf(t.num, (t.power - 1) as Power, t.den, t.power === 0 ? v : varOf(t)) : t;
    const next = { left: combine(equation.left.map(divide)), right: combine(equation.right.map(divide)) };
    return {
      next,
      label: `divided both sides by ${v}`,
      dangerous: true,
      note: `assumes ${v} ≠ 0 — a solution ${v} = 0 would be lost`,
      pill: `${v} ≠ 0`,
    };
  };

  /** Divide both sides by a whole term's value (dragged under another term) */
  const tryDivideByTerm = (ids: string[], from: Side): MoveResult => {
    if (ids.length !== 1) return "divide by a single term at a time";
    const source = equation[from].find((t) => t.id === ids[0]);
    if (!source) return null;
    if (source.kind !== "leaf") return "dividing by parentheses or functions isn't playable yet";
    if (source.pm || source.radical || source.fnVal || source.num === 0) return "can't divide by that";
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
    const p = source.power;
    const v = varOf(source);
    if (p !== 0) {
      if (hasGroups) return "distribute the parentheses first";
      if (hasFuncs) return "unwrap the function first";
      if (mixedWith(v)) return "x and y can't share a fraction — beyond this playground";
      const outOfRange = [...equation.left, ...equation.right].some(
        (t) => t.kind === "leaf" && t.power !== 0 && Math.abs(t.power - p) > MAX_POWER
      );
      if (outOfRange) return "that would push a power past x⁹ — far enough";
    }
    const apply = (t: EqTerm): EqTerm => {
      const scaled = scaleDen(scaleNum(t, source.den), source.num);
      if (p === 0 || scaled.kind !== "leaf") return scaled;
      return leaf(scaled.num, (scaled.power - p) as Power, scaled.den, scaled.power === 0 ? v : varOf(scaled));
    };
    const next = { left: combine(equation.left.map(apply)), right: combine(equation.right.map(apply)) };
    return {
      next,
      label: `divided both sides by ${termText(source, true).trim()}`,
      dangerous: p > 0,
      note: p > 0 ? `assumes ${v} ≠ 0 — a solution ${v} = 0 would be lost` : undefined,
      pill: p > 0 ? `${v} ≠ 0` : undefined,
    };
  };

  /** Multiply both sides by the variable, anchored by dropping it onto an exponent position */
  const tryMultiplyBothSidesByX = (v: Variable = "x"): MoveResult => {
    if (hasGroups) return "distribute the parentheses first";
    if (hasFuncs) return "unwrap the function first";
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
    if (mixedWith(v)) return "x and y can't share a fraction — beyond this playground";
    if (!powersInRange(1)) return "that would push a power past x⁹ — far enough";
    const multiply = (t: EqTerm) =>
      t.kind === "leaf" ? leaf(t.num, (t.power + 1) as Power, t.den, t.power === 0 ? v : varOf(t)) : t;
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    return {
      next,
      label: `multiplied both sides by ${v}`,
      dangerous: true,
      note: `multiplying by ${v} can add ${v} = 0 as a false solution`,
      pill: `${v} ≠ 0`,
    };
  };

  /** Multiply both sides by the variable: every power rises by one. Hides the original ≠ 0 domain. */
  const tryMultiplyByX = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power !== -1) return null;
    const v = varOf(source);
    if (hasGroups) return "distribute the parentheses first";
    if (hasFuncs) return "unwrap the function first";
    if (hasTerminal) return "frozen values (√, arc…) can't be scaled — move them, pick a ± branch, or rewind";
    if (mixedWith(v)) return "x and y can't share a fraction — beyond this playground";
    if (!powersInRange(1)) return "that would push a power past x⁹ — far enough";
    const multiply = (t: EqTerm) =>
      t.kind === "leaf" ? leaf(t.num, (t.power + 1) as Power, t.den, t.power === 0 ? v : varOf(t)) : t;
    const next = { left: combine(equation.left.map(multiply)), right: combine(equation.right.map(multiply)) };
    return {
      next,
      label: `multiplied both sides by ${v}`,
      dangerous: true,
      note: `the original equation required ${v} ≠ 0 — that rule is now invisible`,
      pill: `${v} ≠ 0`,
    };
  };

  /** Take the square root of both sides: x² = c → x = ±√c (both roots kept) */
  const tryTakeSquareRoot = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "leaf" || source.power < 2 || source.power % 2 !== 0) return null;
    if (equation[from].length !== 1) return "move the other terms away first — the squared term must be alone";
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
    const next = { ...equation, [from]: [leaf(1, source.power / 2, 1, varOf(source))], [to]: [result] } as EquationState;
    return { next, label: "took the square root of both sides", note: "keeping ± — both roots survive" };
  };

  /** Unwrap a function by applying its inverse to both sides: fn(x) = c → x = fn⁻¹(c) */
  const tryUnwrapFunction = (termId: string, from: Side, to: Side): MoveResult => {
    if (from === to) return null;
    const source = equation[from].find((t) => t.id === termId);
    if (!source || source.kind !== "func") return null;
    // ln and e^ delegate to the general both-sides transform: the source side
    // unwraps, and the other side takes whatever the inverse legally does to
    // it — so ln(u) = ln(v) cancels straight to u = v
    if (source.fn === "ln") return tryApplyTool("exp");
    if (source.fn === "exp") return tryApplyTool("ln");
    if (equation[from].length !== 1) return "move the other terms away first — the function must be alone on its side";
    if (!(source.num === 1 && source.den === 1)) {
      return source.num < 0
        ? "flip the sign of both sides first — the inverse needs a bare function"
        : "divide away the coefficient first — the inverse needs a bare function";
    }
    const other = equation[to];
    // the same bare function on both sides cancels: fn(u) = fn(v) → u = v.
    // For trig that's the PRINCIPAL choice — these functions aren't
    // one-to-one, so whole solution families are deliberately dropped
    if (
      other.length === 1 &&
      other[0].kind === "func" &&
      other[0].fn === source.fn &&
      other[0].num === 1 &&
      other[0].den === 1
    ) {
      const PERIODIC: Record<"sin" | "cos" | "tan", string> = {
        sin: "sin(u) = sin(v) also holds for u = π − v + 2πk — those solutions are dropped",
        cos: "cos(u) = cos(v) also holds for u = −v + 2πk — those solutions are dropped",
        tan: "tan(u) = tan(v) also holds for u = v + πk — those solutions are dropped",
      };
      const next = {
        ...equation,
        [from]: combine(source.inner.map(reTerm)),
        [to]: combine(other[0].inner.map(reTerm)),
      } as EquationState;
      return {
        next,
        label: `cancelled ${source.fn} on both sides`,
        dangerous: true,
        note: PERIODIC[source.fn as "sin" | "cos" | "tan"],
        pill: "principal value",
      };
    }
    if (other.length !== 1 || other[0].kind !== "leaf" || other[0].power !== 0 || other[0].pm || other[0].radical || other[0].fnVal) {
      return "gather a single plain number on the other side first";
    }
    const c = other[0];
    if ((source.fn === "sin" || source.fn === "cos") && Math.abs(c.num / c.den) > 1) {
      return `${source.fn} never leaves [−1, 1] — no solution here`;
    }
    const INVERSE: Record<"sin" | "cos" | "tan", string> = { sin: "arcsin", cos: "arccos", tan: "arctan" };
    // Exact special values keep the result rational
    const isZero =
      ((source.fn === "sin" || source.fn === "tan") && c.num === 0) ||
      (source.fn === "cos" && c.num === 1 && c.den === 1);
    const result: LeafTerm = isZero ? leaf(0) : { ...leaf(c.num, 0, c.den), fnVal: INVERSE[source.fn] };
    const next = {
      ...equation,
      [from]: combine(source.inner.map(reTerm)),
      [to]: [result],
    } as EquationState;
    return {
      next,
      label: `applied arc${source.fn} to both sides`,
      dangerous: true,
      note: "principal value only — the periodic solutions are dropped",
      pill: "principal value",
    };
  };

  // Typed equation: live pretty-math preview and Enter-to-load
  const inputPreview = useMemo(
    () => (!searchMode && inputText.trim() ? renderMathPreview(inputText) : null),
    [inputText, searchMode]
  );

  // Word search: matches for what's typed — or the whole catalog while the
  // box is empty, so flipping the mode on is immediately visible
  const searchMatches = useMemo(
    () => (searchMode ? (inputText.trim() ? searchCatalog(inputText) : CATALOG) : []),
    [searchMode, inputText]
  );

  // keyboard selection resets when the query (and thus the list) changes,
  // and the highlighted row stays scrolled into view
  useEffect(() => {
    setSearchSel(0);
  }, [inputText, searchMode]);
  useEffect(() => {
    document
      .querySelector(`[data-search-row='${searchSel}']`)
      ?.scrollIntoView({ block: "nearest" });
  }, [searchSel]);

  const applyParse = (result: ParseResult & { ok: true }) => {
    if (result.tree) {
      // frontier mode: the flat model can't hold this — the tree can
      setTreeEq(result.tree);
      setEquation(TREE_DUMMY());
      setHistory([makeTreeStep("start", result.tree)]);
    } else {
      setTreeEq(null);
      setEquation(result.state);
      setHistory([makeStep("start", result.state)]);
    }
    setSelection(null);
    setNotice(null);
    setInputMsg(null);
  };

  const selectCatalogEntry = (entry: CatalogEntry) => {
    const result = parseEquation(entry.text);
    if (!result.ok) return; // catalog rows are pre-vetted — this can't happen
    applyParse(result);
    setInputText("");
    setSearchMode(false); // choosing is the end of the search
    searchInputRef.current?.blur(); // back to default mode — shortcuts work again
  };

  const submitInput = () => {
    if (searchMode) {
      if (searchMatches.length === 0) {
        if (inputText.trim())
          setInputMsg({ kind: "warn", text: 'no function matches — try "bell curve" or "sigmoid"' });
        return;
      }
      // an empty Enter with no navigation shouldn't grab the top row
      if (!inputText.trim() && searchSel === 0) return;
      selectCatalogEntry(searchMatches[Math.min(searchSel, searchMatches.length - 1)]);
      return;
    }
    const result = parseEquation(inputText);
    if (result.ok) {
      applyParse(result);
      searchInputRef.current?.blur(); // loaded — hand focus back to the playground
    } else {
      setInputMsg({ kind: result.stage === "parse" ? "err" : "warn", text: result.message });
    }
  };

  const restoreStep = (index: number) => {
    if (playingRef.current) stopPlayback();
    const step = history[index];
    setTreeEq(step.tree ? cloneTreeEq(step.tree) : null);
    setEquation(cloneState(step.state));
    setHistory((h) => h.slice(0, index + 1));
    setSelection(null);
    setNotice(null);
  };

  // --- Marquee (drag-to-select a block of symbols on empty space) ---
  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (dragActive) finishPointerDrag();
    if (e.button !== 0) return;
    // any press during replay stops it — the equation returns to the latest
    // step before anything else can happen
    if (playingRef.current) {
      stopPlayback();
      return;
    }
    const targetEl = e.target as HTMLElement;
    // word search is modal to its own bar: any press elsewhere exits it
    if (!targetEl.closest("[data-search]")) setSearchMode(false);
    // Toolbox items drag via the pointer engine (click still applies them)
    const toolButton = targetEl.closest("[data-tool]") as HTMLElement | null;
    if (toolButton?.dataset.tool) {
      beginDrag({ kind: "tool", tool: toolButton.dataset.tool as ToolKind }, e);
      return;
    }
    // Open menus dismiss on any press outside themselves — including presses
    // on other panels (the graph pane, the toolbox), which are still data-ui
    if (!targetEl.closest("[data-history]")) setHistoryOpen(false);
    if (!targetEl.closest("[data-toolbox]")) setToolboxOpen(false);
    // Presses inside UI chrome (history menu, presets, input) keep their own
    // click handling — closing the menu here would unmount the button mid-press
    if (targetEl.closest("[data-ui]")) return;
    // Proximity grab: the nearest symbol within reach picks up, even if the
    // press wasn't pixel-perfect on the glyph
    const symbol = nearestSymbol(e.clientX, e.clientY);
    if (symbol) {
      e.preventDefault();
      beginDrag(payloadFromSymbol(symbol), e);
      return;
    }
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
    | { kind: "fn"; termId: string; from: Side }
    | { kind: "numer"; termId: string; from: Side }
    | { kind: "tool"; tool: ToolKind };

  // Tracked in a ref (dataTransfer is unreadable during dragover) so any drop
  // location can route to the opposite side and the target ring is accurate
  const dragPayloadRef = useRef<DragPayload | null>(null);

  /**
   * Toolbox operations apply to BOTH sides at once, each side transformed
   * independently: an inverse structure unwraps (ln over e^u), everything
   * else wraps symbolically. The only rejections are mathematical
   * illegality (ln of a non-positive side) or shapes the term model
   * cannot represent (nested functions, powers beyond x²).
   */
  type SideResult = EqTerm[] | string;

  /** A side as plain leaves: groups distribute silently; functions and frozen values refuse */
  const sideAsLeaves = (terms: EqTerm[]): LeafTerm[] | string => {
    const out: LeafTerm[] = [];
    for (const t of terms) {
      if (t.kind === "group") {
        for (const l of t.inner) {
          if (l.kind !== "leaf" || l.pm || l.radical || l.fnVal)
            return "the nesting inside those parentheses is beyond flattening here";
          out.push(leaf(t.num * l.num, l.power, t.den * l.den, varOf(l)));
        }
      } else if (t.kind === "func") {
        return "a function mixed into a sum can't be wrapped again — this playground can't nest that";
      } else if (t.pm || t.radical || t.fnVal) {
        return "a frozen value (±√, arc…, ln c) sits here — square it away or rewind first";
      } else {
        out.push(t);
      }
    }
    return out;
  };

  /** The side's exact constant value, if it has no x at all */
  const constantOf = (leaves: LeafTerm[]): LeafTerm | null => {
    const c = combine(leaves);
    return c.length === 1 && c[0].kind === "leaf" && c[0].power === 0 && !c[0].pm && !c[0].radical && !c[0].fnVal
      ? c[0]
      : null;
  };

  /** ln applied to one side. Unwraps a·e^u to ln a + u; wraps anything else. */
  const lnOfSide = (
    terms: EqTerm[]
  ): { result: EqTerm[]; assume?: "positive" | "xnotzero"; assumeVar?: Variable } | string => {
    if (terms.length === 1 && terms[0].kind === "func") {
      const f = terms[0];
      if (f.fn !== "exp") return { result: [func("ln", 1, terms.map(reTerm))], assume: "positive" };
      if (f.num <= 0) return "that side is a non-positive multiple of e^( ) — ln needs a positive side";
      const lnCoef = f.num === 1 && f.den === 1 ? [] : [func("ln", 1, [leaf(f.num, 0, f.den)])];
      return { result: combine([...(lnCoef as EqTerm[]), ...f.inner.map(reTerm)]) };
    }
    // ln(e^v) = v — the frozen value thaws
    if (terms.length === 1 && terms[0].kind === "leaf" && terms[0].fnVal === "e^") {
      const t = terms[0];
      if (t.neg) return "ln needs a positive side — this value is negative";
      if (t.pm) return "pick a ± branch first — ln of the − branch isn't real";
      return { result: [leaf(t.num, 0, t.den)] };
    }
    const leaves = sideAsLeaves(terms);
    if (typeof leaves === "string") {
      // sides that mix functions into sums wrap whole — nesting is representable
      return { result: [func("ln", 1, terms.map(reTerm))], assume: "positive" };
    }
    const c = constantOf(leaves);
    if (c) {
      if (c.num <= 0) return "ln is only defined for positive numbers — one side isn't positive";
      if (c.num === 1 && c.den === 1) return { result: [leaf(0)] };
      return { result: [func("ln", 1, [leaf(c.num, 0, c.den)])] };
    }
    const merged = combine(leaves) as LeafTerm[];
    // A positive multiple of a squared variable is positive exactly when it's ≠ 0
    const assume = merged.length === 1 && merged[0].power === 2 && merged[0].num > 0 ? "xnotzero" : "positive";
    return { result: [func("ln", 1, merged)], assume, assumeVar: merged.length === 1 ? varOf(merged[0]) : "x" };
  };

  /** e^( ) applied to one side. Unwraps ln u to u; wraps anything else. */
  const expOfSide = (terms: EqTerm[]): SideResult => {
    if (terms.length === 1 && terms[0].kind === "func") {
      const f = terms[0];
      if (f.fn !== "ln") return [func("exp", 1, terms.map(reTerm))];
      if (!(f.num === 1 && f.den === 1))
        return "divide away the coefficient first — e^(a·ln …) would need arbitrary powers";
      return combine(f.inner.map(reTerm));
    }
    // e^(ln v) = v — the frozen value thaws
    if (terms.length === 1 && terms[0].kind === "leaf" && terms[0].fnVal === "ln") {
      const t = terms[0];
      if (t.pm || t.neg) return "pick the + branch first — e^( ) of a mixed value isn't a single number";
      return [leaf(t.num, 0, t.den)];
    }
    const leaves = sideAsLeaves(terms);
    if (typeof leaves === "string") return [func("exp", 1, terms.map(reTerm))];
    const c = constantOf(leaves);
    if (c && c.num === 0) return [leaf(1)];
    return [func("exp", 1, combine(leaves) as LeafTerm[])];
  };

  /** ( )² applied to one side. Resolves ±/√ values; expands (sum)² exactly. */
  const squareOfSide = (terms: EqTerm[]): SideResult => {
    if (terms.length === 1 && terms[0].kind === "leaf" && (terms[0].pm || terms[0].radical) && !terms[0].fnVal) {
      const t = terms[0];
      // (±√v)² = v ; (±a)² = a²
      return [t.radical ? leaf(t.num, 0, t.den) : leaf(t.num * t.num, 0, t.den * t.den)];
    }
    if (terms.length === 1 && terms[0].kind === "func")
      return "squaring a function isn't representable here — unwrap it first";
    const leaves = sideAsLeaves(terms);
    if (typeof leaves === "string") return leaves;
    const out: LeafTerm[] = [];
    for (const a of leaves)
      for (const b of leaves) {
        if (a.power !== 0 && b.power !== 0 && varOf(a) !== varOf(b))
          return "squaring this would create x·y cross-terms — beyond this playground";
        const p = a.power + b.power;
        if (Math.abs(p) > MAX_POWER) return "squaring this would push a power past x⁹";
        out.push(leaf(a.num * b.num, p as Power, a.den * b.den, a.power !== 0 ? varOf(a) : varOf(b)));
      }
    return combine(out);
  };

  /** 1/( ) applied to one side. Needs the side to be a single simple term. */
  const recipOfSide = (terms: EqTerm[]): SideResult => {
    if (terms.length === 1 && terms[0].kind === "func")
      return "1/fn( ) isn't representable here — unwrap the function first";
    const leaves = sideAsLeaves(terms);
    if (typeof leaves === "string") return leaves;
    const merged = combine(leaves) as LeafTerm[];
    if (merged.length !== 1) return "1/(a sum) isn't representable here — the side must be a single term";
    const t = merged[0];
    if (t.num === 0) return "can't take the reciprocal of 0";
    const sign = t.num < 0 ? -1 : 1;
    return [leaf(sign * t.den, (-t.power) as Power, Math.abs(t.num), varOf(t))];
  };

  /** Human names for the toolbox operations, for rebuild labels */
  const TOOL_NAME: Record<ToolKind, string> = {
    ln: "ln",
    exp: "e^( )",
    sin: "sin",
    cos: "cos",
    tan: "tan",
    sqrt: "√",
    square: "( )²",
    recip: "1/( )",
  };

  /**
   * The BUILDING move: a toolbox symbol dropped onto one term transforms
   * that term alone. This rewrites the equation itself — it is not an
   * equivalence — so the step history restarts from the rebuilt equation.
   */
  const tryTransformTerm = (tool: ToolKind, termId: string, side: Side): MoveResult => {
    const t = equation[side].find((x) => x.id === termId);
    if (!t) return null;
    if (t.kind === "leaf" && t.num === 0) return null;
    if (t.kind === "leaf" && (t.pm || t.radical || t.fnVal))
      return "frozen values can't be rebuilt — rewind instead";
    const asLeaves = (): LeafTerm[] | string => {
      if (t.kind === "leaf") return [leaf(t.num, t.power, t.den, varOf(t))];
      if (t.kind === "group") {
        const out: LeafTerm[] = [];
        for (const l of t.inner) {
          if (l.kind !== "leaf" || l.pm || l.radical || l.fnVal)
            return "the nesting inside those parentheses is beyond flattening here";
          out.push(leaf(t.num * l.num, l.power, t.den * l.den, varOf(l)));
        }
        return out;
      }
      return "__nested__";
    };
    const done = (replacement: EqTerm[], note?: string): MoveResult => {
      const nextSide = equation[side].flatMap((x) => (x.id === termId ? replacement : [x]));
      const next = { ...equation, [side]: combine(nextSide) } as EquationState;
      return {
        next,
        label: `rebuilt: applied ${TOOL_NAME[tool]} to ${termText(t, true).trim()}`,
        note: note ?? "this rewrites the equation itself — the trail restarts here",
        rebuild: true,
      };
    };
    if (tool === "ln" || tool === "exp" || tool === "sin" || tool === "cos" || tool === "tan") {
      const ls = asLeaves();
      if (typeof ls === "string") {
        // functions and unflattenable parentheses wrap whole — nesting is fine
        return done([func(tool as FuncName, 1, [reTerm(t)])]);
      }
      if (tool === "ln") {
        const constant = ls.length === 1 && ls[0].power === 0 ? ls[0] : null;
        if (constant && constant.num <= 0) return "ln needs a positive value — that term isn't";
      }
      return done([func(tool as FuncName, 1, ls)]);
    }
    if (tool === "square") {
      const ls = asLeaves();
      if (typeof ls === "string") return "squaring a function isn't representable here";
      const out: LeafTerm[] = [];
      for (const a of ls)
        for (const b of ls) {
          if (a.power !== 0 && b.power !== 0 && varOf(a) !== varOf(b))
            return "squaring this would create x·y cross-terms — beyond this playground";
          const power = a.power + b.power;
          if (Math.abs(power) > MAX_POWER) return "squaring this would push a power past x⁹";
          out.push(leaf(a.num * b.num, power as Power, a.den * b.den, a.power !== 0 ? varOf(a) : varOf(b)));
        }
      return done(out);
    }
    if (tool === "recip") {
      if (t.kind !== "leaf") return "1/(…) of that isn't representable here";
      const sign = t.num < 0 ? -1 : 1;
      return done([leaf(sign * t.den, -t.power as Power, Math.abs(t.num), varOf(t))]);
    }
    if (tool === "sqrt") {
      if (t.kind !== "leaf") return "√ of that isn't representable here";
      const isSquare = (n: number) => {
        const r = Math.round(Math.sqrt(n));
        return r * r === n;
      };
      if (t.power === 0) {
        if (t.num < 0) return "√ of a negative number isn't real";
        if (isSquare(t.num) && isSquare(t.den))
          return done([leaf(Math.round(Math.sqrt(t.num)), 0, Math.round(Math.sqrt(t.den)))]);
        return done([{ ...leaf(t.num, 0, t.den), radical: true }]);
      }
      if (t.power === 2 && t.num > 0 && isSquare(t.num) && isSquare(t.den)) {
        return done(
          [leaf(Math.round(Math.sqrt(t.num)), 1, Math.round(Math.sqrt(t.den)), varOf(t))],
          `took √ of the term — assumes ${varOf(t)} ≥ 0, and the trail restarts here`
        );
      }
      return "√ of that term isn't representable here — try a constant or a perfect-square x²";
    }
    return null;
  };

  /** sin/cos/tan applied to one side: unwraps its arc-value, else wraps symbolically */
  const trigOfSide = (fn: "sin" | "cos" | "tan", terms: EqTerm[]): SideResult => {
    const inverse = fn === "sin" ? "arcsin" : fn === "cos" ? "arccos" : "arctan";
    if (terms.length === 1 && terms[0].kind === "leaf" && terms[0].fnVal === inverse) {
      const t = terms[0];
      // sin(±arcsin v) = ±v, cos(−arccos v) = v (cos is even), tan odd like sin
      const value = leaf(t.num, 0, t.den);
      if (t.pm) return fn === "cos" ? [value] : [{ ...value, pm: true }];
      if (t.neg) return fn === "cos" ? [value] : [scaleNum(value, -1) as LeafTerm];
      return [value];
    }
    if (terms.length === 1 && terms[0].kind === "func") return [func(fn, 1, terms.map(reTerm))];
    const leaves = sideAsLeaves(terms);
    if (typeof leaves === "string") return [func(fn, 1, terms.map(reTerm))];
    return [func(fn, 1, combine(leaves) as LeafTerm[])];
  };

  const tryApplyTool = (tool: ToolKind): MoveResult => {
    if (tool === "sin" || tool === "cos" || tool === "tan") {
      const l = trigOfSide(tool, equation.left);
      if (typeof l === "string") return l;
      const r = trigOfSide(tool, equation.right);
      if (typeof r === "string") return r;
      return {
        next: { left: combine(l), right: combine(r) },
        label: `took ${tool} of both sides`,
        dangerous: true,
        note: `${tool} isn't one-to-one — new false solutions can appear; check answers`,
        pill: "check solutions",
      };
    }
    if (tool === "ln") {
      const l = lnOfSide(equation.left);
      if (typeof l === "string") return l;
      const r = lnOfSide(equation.right);
      if (typeof r === "string") return r;
      const assumes = [l.assume, r.assume].filter(Boolean);
      const xnz = assumes.length > 0 && assumes.every((a) => a === "xnotzero");
      const nzVar = (l.assume === "xnotzero" ? l.assumeVar : r.assume === "xnotzero" ? r.assumeVar : "x") ?? "x";
      return {
        next: { left: combine(l.result), right: combine(r.result) },
        label: "took the natural log of both sides",
        dangerous: assumes.length > 0,
        note:
          assumes.length > 0
            ? xnz
              ? `ln(${nzVar}²) is only defined when ${nzVar} ≠ 0 — that possible solution is lost`
              : "ln is only defined where both sides are positive — solutions elsewhere are lost"
            : undefined,
        pill: assumes.length > 0 ? (xnz ? `${nzVar} ≠ 0` : "sides > 0") : undefined,
      };
    }
    if (tool === "exp") {
      const l = expOfSide(equation.left);
      if (typeof l === "string") return l;
      const r = expOfSide(equation.right);
      if (typeof r === "string") return r;
      return {
        next: { left: combine(l), right: combine(r) },
        label: "exponentiated both sides (e to each side)",
      };
    }
    if (tool === "sqrt") {
      const findSide = (pred: (t: EqTerm) => boolean): Side | null =>
        equation.left.length === 1 && pred(equation.left[0])
          ? "left"
          : equation.right.length === 1 && pred(equation.right[0])
            ? "right"
            : null;
      const side = findSide(
        (t) => t.kind === "leaf" && !t.pm && !t.radical && !t.fnVal && t.power >= 2 && t.power % 2 === 0
      );
      if (side) return tryTakeSquareRoot(equation[side][0].id, side, opposite(side));
      return "√ needs an x² alone on one side — √(a sum) isn't representable in this playground";
    }
    if (tool === "square") {
      const l = squareOfSide(equation.left);
      if (typeof l === "string") return l;
      const r = squareOfSide(equation.right);
      if (typeof r === "string") return r;
      return {
        next: { left: combine(l), right: combine(r) },
        label: "squared both sides",
        dangerous: true,
        note: "squaring can introduce extraneous solutions — check any answer in the original equation",
        pill: "check roots",
      };
    }
    if (tool === "recip") {
      const l = recipOfSide(equation.left);
      if (typeof l === "string") return l;
      const r = recipOfSide(equation.right);
      if (typeof r === "string") return r;
      const involvesX = [...equation.left, ...equation.right].some((t) => t.kind === "leaf" && t.power !== 0);
      return {
        next: { left: combine(l), right: combine(r) },
        label: "took the reciprocal of both sides",
        dangerous: involvesX,
        note: involvesX ? "assumes x ≠ 0 — both sides must be nonzero to flip" : undefined,
        pill: involvesX ? "x ≠ 0" : undefined,
      };
    }
    return null;
  };


  /** Build a drag payload from a symbol's data attributes (pointer engine) */
  const payloadFromSymbol = (el: HTMLElement): DragPayload => {
    const termId = el.dataset.termId ?? "";
    const side = (el.dataset.side ?? "left") as Side;
    const role = (el.dataset.role ?? "term") as Role;
    // A selected block always moves as a whole, whatever symbol is grabbed
    if (selection && selection.side === side && selection.termIds.includes(termId)) {
      return { kind: "terms", ids: selection.termIds, from: side };
    }
    switch (role) {
      case "coef":
        return { kind: "coef", termId, from: side };
      case "den":
        return { kind: "den", termId, from: side };
      case "neg":
        return { kind: "neg", termId, from: side };
      case "xdiv":
        return { kind: "xdiv", termId, from: side };
      case "xmul":
        return { kind: "xmul", termId, from: side };
      case "factor":
        return { kind: "factor", termId, from: side };
      case "exp":
        return { kind: "exp", termId, from: side };
      case "fn":
        return { kind: "fn", termId, from: side };
      case "numer":
        return { kind: "numer", termId, from: side };
      default:
        return { kind: "terms", ids: [termId], from: side };
    }
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
    setExpHover(null);
    setTermHover(null);
    underHoverRef.current = null;
    termHoverRef.current = null;
  };

  type DropTarget =
    | { kind: "side"; side: Side }
    | { kind: "parens"; termId: string; side: Side }
    | { kind: "under"; termId: string; side: Side }
    | { kind: "onexp"; termId: string; side: Side }
    | { kind: "onterm"; termId: string; side: Side }
    | { kind: "funcparens"; termId: string; side: Side }
    | { kind: "bound"; which: "lo" | "hi" };

  /** The single dispatcher shared by real drops and the mid-drag preview */
  const computeDrop = (payload: DragPayload, target: DropTarget): MoveResult => {
    // Toolbox symbols: dropped ON a term they rebuild that term (a building
    // move — new equation, trail restarts); dropped anywhere else they apply
    // to both sides as a legal move (and some, like squaring a ±√ value, are
    // the way OUT of a frozen state)
    if (payload.kind === "tool") {
      if (target.kind === "onterm") return tryTransformTerm(payload.tool, target.termId, target.side);
      return tryApplyTool(payload.tool);
    }
    // a coefficient dropped on a same-side sibling pulls their common factor out
    if (target.kind === "onterm") {
      if (payload.kind === "coef" || payload.kind === "numer") {
        return tryFactorOut(payload.termId, target.termId, target.side);
      }
      return null;
    }
    // terminal values may MOVE (their sign flips via ±/neg); scaling them is
    // guarded inside the arithmetic moves themselves
    if (target.kind === "parens") {
      if (payload.kind === "factor" && payload.termId === target.termId) {
        return tryDistributeFactor(payload.termId, target.side);
      }
      return null;
    }
    if (target.kind === "funcparens") {
      // Teaching moment: multiplication does not commute into a function
      const fnTerm = equation[target.side].find((t) => t.id === target.termId);
      const fn = fnTerm?.kind === "func" ? fnTerm.fn : "sin";
      if (payload.kind === "coef" || payload.kind === "factor") {
        return `the coefficient can't move inside the function — a·${fn}(x) ≠ ${fn}(a·x)`;
      }
      return null;
    }
    if (target.kind === "onexp") {
      // Exponent position: an x merging into an exponent multiplies both sides by x
      switch (payload.kind) {
        case "xdiv":
        case "xmul":
          {
            const src = equation[payload.from].find((t) => t.id === payload.termId);
            return tryMultiplyBothSidesByX(src && src.kind === "leaf" ? varOf(src) : "x");
          }
        case "coef":
        case "factor":
        case "numer":
        case "terms":
        case "neg":
        case "den":
          return "raising both sides to a power isn't a symbol move — the sides wouldn't stay equal";
        case "exp":
          return "the exponent takes the square root — drag it across the equals sign";
        case "fn":
          return "functions unwrap — drag the name across the equals sign";
      }
    }
    if (target.kind === "under") {
      // Denominator position: the dragged thing divides both sides
      const across = opposite(payload.from);
      switch (payload.kind) {
        case "xdiv":
          return tryDivideByX(payload.termId, payload.from, across);
        case "coef":
        case "factor":
        case "numer":
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
    if (target.kind === "bound") return null; // handled before dispatch
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
      case "numer":
        // Beside the terms, a term's body (its x or its numerator) moves the
        // whole term; under a term it divides both sides
        return tryMoveTerms([payload.termId], payload.from, to);
      case "xmul":
        return tryMultiplyByX(payload.termId, payload.from, to);
      case "exp":
        return tryTakeSquareRoot(payload.termId, payload.from, to);
      case "fn":
        return tryUnwrapFunction(payload.termId, payload.from, to);
    }
  };

  // --- Tree (frontier) moves: the same engine, dispatched to tree rewrites --

  /** The addend a tree symbol id (L0, R1, L0@x, …) points at */
  const treeAddend = (id: string): TNode | null => {
    if (!treeEq) return null;
    const side: Side = id.startsWith("L") ? "left" : "right";
    const list = addendsOf(treeEq[side]);
    const i = parseInt(id.slice(1), 10);
    return list[i] ?? null;
  };

  /** The constant part of an addend — what its coefficient handle divides by */
  const coefExprOf = (id: string): TNode | null => {
    const a = treeAddend(id);
    if (!a) return null;
    const { num, den, core } = splitCoef(a);
    const constParts = core.filter((f) => varsIn(f).size === 0);
    const parts: TNode[] = [
      ...(Math.abs(num) === 1 && den === 1 ? [] : [tc(Math.abs(num), den)]),
      ...constParts,
    ];
    if (parts.length === 0) return null;
    return simplifyTree(parts.length === 1 ? parts[0] : tmul(...parts));
  };

  /** The fraction part a handle id (L0@n1, R0@d0) points at */
  const treeFactorOf = (id: string): { expr: TNode; zone: "n" | "d" } | null => {
    const m = id.match(/^([LR]\d+)@([nd])(\d+)$/);
    if (!m) return null;
    const addend = treeAddend(m[1]);
    if (!addend) return null;
    const factors = addend.kind === "mul" ? addend.factors : [addend];
    const numer: TNode[] = [];
    const denom: TNode[] = [];
    for (const f of factors) {
      if (f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0) {
        denom.push(simplifyTree(tpow(f.base, tc(-f.exp.num, f.exp.den))));
      } else numer.push(f);
    }
    const list = m[2] === "n" ? numer : denom;
    const expr = list[Number(m[3])];
    return expr !== undefined ? { expr, zone: m[2] as "n" | "d" } : null;
  };

  const computeTreeDrop = (payload: DragPayload, target: DropTarget): TreeMoveResult => {
    if (!treeEq) return null;
    if (payload.kind === "tool") {
      if (target.kind === "onterm")
        return "rebuilding single terms arrives with the full tree grammar — click the symbol to apply it to both sides";
      return applyToolT(payload.tool, treeEq);
    }
    if (payload.kind === "coef") {
      const expr = coefExprOf(payload.termId);
      if (!expr) return null;
      return divideBothT(treeEq, expr, printNode(expr));
    }
    if (payload.kind === "xdiv") {
      // a bare variable handle: under → divide both sides by it; beside → the term moves
      const v = payload.termId.split("@")[1] as Variable | undefined;
      if (!v) return null;
      if (target.kind === "under") return divideBothT(treeEq, tv(v), v);
      if (target.kind === "side") return moveTermsT(treeEq, [payload.termId], payload.from, target.side);
      return null;
    }
    if (payload.kind === "numer") {
      // a compound numerator factor: under → divide both sides by it
      const f = treeFactorOf(payload.termId);
      if (!f) return null;
      if (target.kind === "under") return divideBothT(treeEq, f.expr, printNode(f.expr));
      if (target.kind === "side") return moveTermsT(treeEq, [payload.termId], payload.from, target.side);
      return null;
    }
    if (payload.kind === "den") {
      // a denominator factor multiplies both sides — its nonzero-ness is
      // already part of the equation's own domain
      const f = treeFactorOf(payload.termId);
      if (!f) return null;
      if (target.kind === "under") return "a denominator multiplies — drop it beside the other side";
      if (target.kind === "side") return multiplyBothT(treeEq, f.expr, printNode(f.expr));
      return null;
    }
    if (payload.kind === "terms") {
      if (target.kind === "under") {
        const a = treeAddend(payload.ids[0]);
        if (!a) return null;
        return divideBothT(treeEq, a, printNode(a));
      }
      if (target.kind === "side") return moveTermsT(treeEq, payload.ids, payload.from, target.side);
      return null;
    }
    return null;
  };

  const commitTreeOutcome = (o: TreeOutcome) => {
    if (o.flatNext) {
      // the escape hatch: the equation fits the flat model again — the full
      // move grammar takes over from here
      setTreeEq(null);
      setEquation(o.flatNext);
      setHistory((h) => [...h, makeStep(o.label, o.flatNext!, o.dangerous, o.note, o.pill)]);
    } else if (o.treeNext) {
      setTreeEq(o.treeNext);
      setEquation(TREE_DUMMY());
      setHistory((h) => [...h, makeTreeStep(o.label, o.treeNext!, o.dangerous, o.note, o.pill)]);
    }
    setSelection(null);
    setNotice(null);
  };

  /** Live outcome preview: what would happen if the drag were released here */
  const updatePreview = (payload: DragPayload, target: DropTarget) => {
    const key = JSON.stringify([payload, target]);
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;
    if (target.kind === "bound") {
      const v = boundValueOf(payload);
      if (v === null) setDragPreview({ kind: "reject", text: "only a plain number can set a bound" });
      else setDragPreview({ kind: "ok", text: `set the ${target.which === "lo" ? "lower" : "upper"} bound to ${v}` });
      return;
    }
    const result =
      oddRootPayload(payload) && payload.kind === "exp" && target.kind === "side"
        ? tryOddRoot(payload.termId, payload.from)
        : treeEq
          ? computeTreeDrop(payload, target)
          : computeDrop(payload, target);
    if (result === null) setDragPreview({ kind: "cancel", text: "" });
    else if (typeof result === "string") setDragPreview({ kind: "reject", text: result });
    else {
      const text =
        "next" in result
          ? equationText(result.next)
          : result.flatNext
            ? equationText(result.flatNext)
            : printTreeEq(result.treeNext!);
      setDragPreview({ kind: "ok", text });
    }
  };

  // ---- Pointer drag engine (Notion-style: no native HTML5 DnD) ----------
  // Activation is by proximity: pressing within GRAB_RADIUS of a symbol's
  // box picks it up after a small movement slop. Targets are computed from
  // live geometry, so no invisible strip elements are needed.
  const GRAB_RADIUS = 28;
  const DRAG_SLOP = 5;
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const pointerDragRef = useRef<{ payload: DragPayload; started: boolean; x0: number; y0: number } | null>(null);

  const nearestSymbol = (x: number, y: number): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestDistance = GRAB_RADIUS;
    equationRef.current?.querySelectorAll<HTMLElement>("[data-symbol]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const dx = x - Math.max(r.left, Math.min(x, r.right));
      const dy = y - Math.max(r.top, Math.min(y, r.bottom));
      const d = Math.hypot(dx, dy); // 0 when inside the box
      if (d < bestDistance) {
        bestDistance = d;
        best = el;
      }
    });
    return best;
  };

  /** Where would a release at (x, y) land? Pure geometry over live rects. */
  const findTarget = (x: number, y: number, payload: DragPayload): DropTarget | null => {
    const eq = equationRef.current;
    if (!eq) return null;
    // integral bounds (area view): plain terms can be dropped onto a handle
    if (payload.kind === "terms") {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-bound]"))) {
        const r = el.getBoundingClientRect();
        if (x >= r.left - 16 && x <= r.right + 16 && y >= r.top - 16 && y <= r.bottom + 16) {
          return { kind: "bound", which: el.dataset.bound as "lo" | "hi" };
        }
      }
    }
    // Parenthesis zones (most specific) — only for the matching factor/coef
    if (payload.kind === "factor" || payload.kind === "coef") {
      for (const paren of Array.from(eq.querySelectorAll<HTMLElement>("[data-parens-for]"))) {
        const r = paren.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom + 4) {
          if (paren.dataset.parensFor === payload.termId) {
            return {
              kind: paren.dataset.parensKind === "func" ? "funcparens" : "parens",
              termId: paren.dataset.parensFor!,
              side: paren.dataset.side as Side,
            };
          }
        }
      }
    }
    // Sticky term-acquisition for tools: the wrap ghosts change the layout,
    // so hold an acquired term within a generous live box
    if (payload.kind === "tool" && termHoverRef.current) {
      const held = eq.querySelector<HTMLElement>(`[data-term-wrap="${termHoverRef.current}"]`);
      if (held) {
        const r = held.getBoundingClientRect();
        if (x >= r.left - 34 && x <= r.right + 34 && y >= r.top - 24 && y <= r.bottom + 30) {
          return { kind: "onterm", termId: termHoverRef.current, side: held.dataset.side as Side };
        }
      }
    }
    // Sticky under-acquisition: hover targets change the layout (the morph,
    // the side ghost chip), which can move the zone out from under a still
    // pointer. Once a term is acquired, a generous live box holds it — only
    // clearly leaving releases.
    if (underHoverRef.current) {
      const held = eq.querySelector<HTMLElement>(`[data-term-wrap="${underHoverRef.current}"]`);
      if (held) {
        const r = held.getBoundingClientRect();
        if (x >= r.left - 40 && x <= r.right + 40 && y >= r.top + r.height * 0.25 && y <= r.bottom + 44) {
          return { kind: "under", termId: underHoverRef.current, side: held.dataset.side as Side };
        }
      }
    }
    // Term zones: under (bottom band) and exponent (top-right, x-ish payloads)
    for (const wrap of Array.from(eq.querySelectorAll<HTMLElement>("[data-term-wrap]"))) {
      const r = wrap.getBoundingClientRect();
      const pad = 6;
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad + 26) {
        const termId = wrap.dataset.termWrap!;
        const side = wrap.dataset.side as Side;
        if (payload.kind === "tool") return { kind: "onterm", termId, side };
        if (
          (payload.kind === "coef" || payload.kind === "numer") &&
          payload.termId !== termId &&
          payload.from === side &&
          y <= r.top + r.height * 0.6
        ) {
          return { kind: "onterm", termId, side };
        }
        const xish = payload.kind === "xdiv" || payload.kind === "xmul";
        if (xish && wrap.dataset.expOk === "1" && x > r.left + r.width * 0.55 && y < r.top + r.height * 0.42) {
          return { kind: "onexp", termId, side };
        }
        if (y > r.top + r.height * 0.6) return { kind: "under", termId, side };
        return { kind: "side", side };
      }
    }
    // Side halves within a generous band around the equation
    const band = eq.getBoundingClientRect();
    if (y >= band.top - 60 && y <= band.bottom + 90 && x >= band.left - 200 && x <= band.right + 200) {
      const equals = eq.querySelector<HTMLElement>("[data-equals]");
      const mid = equals ? (equals.getBoundingClientRect().left + equals.getBoundingClientRect().right) / 2 : (band.left + band.right) / 2;
      return { kind: "side", side: x < mid ? "left" : "right" };
    }
    return null;
  };

  const applyHoverTarget = (payload: DragPayload, target: DropTarget | null) => {
    underHoverRef.current = target?.kind === "under" ? target.termId : null;
    setUnderHover(underHoverRef.current);
    termHoverRef.current = target?.kind === "onterm" ? target.termId : null;
    setTermHover(termHoverRef.current);
    setExpHover(target?.kind === "onexp" ? target.termId : null);
    setParenHover(target?.kind === "parens" || target?.kind === "funcparens" ? target.termId : null);
    setDragOver(
      target?.kind === "side" && payload.kind !== "tool" && payload.from !== target.side ? target.side : null
    );
    if (target) {
      updatePreview(payload, target);
    } else {
      previewKeyRef.current = "off-equation";
      setDragPreview({ kind: "cancel", text: "" });
    }
  };

  const finishPointerDrag = () => {
    pointerDragRef.current = null;
    setGhostPos(null);
    finishDrag();
  };

  const beginDrag = (payload: DragPayload, e: ReactPointerEvent) => {
    pointerDragRef.current = { payload, started: false, x0: e.clientX, y0: e.clientY };
    const move = (ev: PointerEvent) => {
      const st = pointerDragRef.current;
      if (!st) return;
      if (!st.started) {
        if (Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) < DRAG_SLOP) return;
        st.started = true;
        dragPayloadRef.current = st.payload;
        setDragActive(true);
        setHoveredTermId(null);
      }
      setGhostPos({ x: ev.clientX, y: ev.clientY });
      applyHoverTarget(st.payload, findTarget(ev.clientX, ev.clientY, st.payload));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
      const st = pointerDragRef.current;
      pointerDragRef.current = null;
      if (st?.started) {
        const target = findTarget(ev.clientX, ev.clientY, st.payload);
        if (target) performDrop(st.payload, target);
      }
      finishPointerDrag();
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", esc);
        finishPointerDrag();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", esc);
  };

  /**
   * Odd roots are bijections — x³ = c and x = c^(1/3) have exactly the same
   * solutions, no branches, no pill. The result may live in the tree
   * (5^(1/3)) or fold back flat (8^(1/3) = 2).
   */
  const tryOddRoot = (termId: string, from: Side): TreeMoveResult => {
    const t = equation[from].find((x) => x.id === termId);
    if (!t || t.kind !== "leaf" || t.power < 3 || t.power % 2 === 0) return null;
    if (equation[from].length !== 1) return "move the other terms away first — the power must be alone on its side";
    if (!(t.num === 1 && t.den === 1)) return "divide away the coefficient first — the root needs a bare power";
    const q = t.power;
    const rootWord = q === 3 ? "cube" : `${q}th`;
    const newFrom = tv(varOf(t));
    const newTo = tpow(flatToTree(equation[opposite(from)]), tc(1, q));
    return finalize(
      from === "left" ? newFrom : newTo,
      from === "left" ? newTo : newFrom,
      `took the ${rootWord} root of both sides`
    );
  };

  /** Is this exp-payload drag an odd-root move? (flat mode only) */
  const oddRootPayload = (payload: DragPayload): boolean => {
    if (treeEq || payload.kind !== "exp") return false;
    const t = equation[payload.from].find((x) => x.id === payload.termId);
    return !!t && t.kind === "leaf" && t.power >= 3 && t.power % 2 === 1;
  };

  /** The numeric value of a dragged constant term, for setting a bound */
  const boundValueOf = (payload: DragPayload): number | null => {
    if (payload.kind !== "terms" || payload.ids.length !== 1) return null;
    if (treeEq) {
      const a = treeAddend(payload.ids[0]);
      if (!a || varsIn(a).size > 0) return null;
      return constValue(a);
    }
    const t = equation[payload.from].find((x) => x.id === payload.ids[0]);
    if (!t) return null;
    if (sideMentions([t], "x") || sideMentions([t], "y")) return null;
    const v = evalSide([t], 0);
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  };

  const performDrop = (payload: DragPayload, target: DropTarget) => {
    if (target.kind === "bound") {
      const v = boundValueOf(payload);
      if (v === null) flashNotice("Only a plain number can set an integral bound.");
      else setBounds((b) => ({ ...b, [target.which]: v }));
      return;
    }
    if (oddRootPayload(payload) && payload.kind === "exp" && target.kind === "side") {
      const result = tryOddRoot(payload.termId, payload.from);
      if (result === null) return;
      if (typeof result === "string") {
        flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
        return;
      }
      commitTreeOutcome(result);
      return;
    }
    if (treeEq) {
      const result = computeTreeDrop(payload, target);
      if (result === null) return;
      if (typeof result === "string") {
        flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
        return;
      }
      commitTreeOutcome(result);
      return;
    }
    const result = computeDrop(payload, target);
    if (result === null) return;
    if (typeof result === "string") {
      flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
      return;
    }
    commitMove(result.label, result.next, result.dangerous, result.note, result.pill, result.rebuild, result.story);
  };

  // --- Rendering ---
  const symHandlers: SymbolHandlers = {
    hover: (id) => {
      if (!dragPayloadRef.current) setHoveredTermId(id);
    },
  };

  /** What the dragged thing reads as, for ghost slots */
  const payloadGlyph = (p: DragPayload): string => {
    if (p.kind === "tool") {
      const GLYPH: Record<ToolKind, string> = {
        ln: "ln",
        exp: "e^",
        sin: "sin",
        cos: "cos",
        tan: "tan",
        sqrt: "√",
        square: "( )²",
        recip: "1/( )",
      };
      return GLYPH[p.tool];
    }
    if (treeEq) {
      if (p.kind === "terms") {
        return p.ids
          .map((id) => {
            const a = treeAddend(id);
            return a ? printNode(a) : "?";
          })
          .join(", ");
      }
      if (p.kind === "coef") {
        const expr = coefExprOf(p.termId);
        return expr ? printNode(expr) : "?";
      }
      if (p.kind === "xdiv") return p.termId.split("@")[1] ?? "x";
      if (p.kind === "numer" || p.kind === "den") {
        const f = treeFactorOf(p.termId);
        return f ? printNode(f.expr) : "?";
      }
      return "?";
    }
    const findTerm = (id: string) => equation[p.from].find((t) => t.id === id);
    switch (p.kind) {
      case "xdiv":
      case "xmul": {
        const t = findTerm(p.termId);
        return t && t.kind === "leaf" ? varOf(t) : "x";
      }
      case "coef":
      case "factor":
      case "numer": {
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
    if (!p || p.kind === "tool" || p.from === side) return null;
    let text: string | null = null;
    if (p.kind === "terms") {
      const ts = equation[p.from].filter((t) => p.ids.includes(t.id));
      text = ts.map((t, i) => termText(scaleNum(t, -1), i === 0)).join("").trim();
    } else if (p.kind === "xdiv" || p.kind === "numer") {
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
    } else if (p.kind === "fn") {
      const t = equation[p.from].find((t) => t.id === p.termId);
      if (t && t.kind === "func") {
        const INV: Record<FuncName, string> = { sin: "arcsin", cos: "arccos", tan: "arctan", ln: "e^( )", exp: "ln( )" };
        text = INV[t.fn];
      }
    }
    if (!text) return null;
    return (
      <span className="ml-4 self-center rounded-md border-2 border-dashed border-amber-400 px-2 py-1 text-[0.45em] leading-none text-amber-500">
        {text}
      </span>
    );
  };

  /**
   * The whole-equation preview: any operation that hits BOTH SIDES shows
   * itself on every term (or around every side) while dragging, not just at
   * the drop point — dividing fractions everything, multiplying appends the
   * factor, negation and function wraps embrace each side.
   */
  type SpreadPreview =
    | { kind: "divide"; text: string }
    | { kind: "multiply"; text: string }
    | { kind: "wrap"; before: string; after: string }
    | { kind: "wrapTerm"; termId: string; before: string; after: string };

  const spread = ((): SpreadPreview | null => {
    const p = dragPayloadRef.current;
    if (!dragActive || !p) return null;
    if (dragPreview?.kind !== "ok") return null; // only preview moves that will land
    if (p.kind === "tool") {
      const WRAP: Record<ToolKind, [string, string]> = {
        ln: ["ln(", ")"],
        exp: ["e^(", ")"],
        sin: ["sin(", ")"],
        cos: ["cos(", ")"],
        tan: ["tan(", ")"],
        sqrt: ["√(", ")"],
        square: ["(", ")²"],
        recip: ["1/(", ")"],
      };
      const [before, after] = WRAP[p.tool];
      // hovering one term = the building move: the wrap embraces just that term
      if (termHover) return { kind: "wrapTerm", termId: termHover, before, after };
      return { kind: "wrap", before, after };
    }
    const findTermBy = (id: string) => equation[p.from].find((t) => t.id === id);
    // denominator position: divide both sides
    if (underHover) {
      switch (p.kind) {
        case "xdiv": {
          const t = findTermBy(p.termId);
          return { kind: "divide", text: t && t.kind === "leaf" ? varOf(t) : "x" };
        }
        case "coef":
        case "factor":
        case "numer": {
          const t = findTermBy(p.termId);
          return t ? { kind: "divide", text: String(Math.abs(t.num)) } : null;
        }
        case "terms": {
          const ts = equation[p.from].filter((x) => p.ids.includes(x.id));
          const text = ts.map((x, i) => termText(x, i === 0)).join("").trim();
          return text ? { kind: "divide", text } : null;
        }
        case "neg": {
          const t = findTermBy(p.termId);
          return t ? { kind: "divide", text: termText(t, true).trim() } : null;
        }
        default:
          return null;
      }
    }
    // exponent position: multiply both sides by the variable
    if (expHover) {
      if (p.kind === "xdiv" || p.kind === "xmul") {
        const t = findTermBy(p.termId);
        return { kind: "multiply", text: t && t.kind === "leaf" ? varOf(t) : "x" };
      }
      return null;
    }
    if (parenHover) return null; // distribution reshapes one term, not the equation
    if (!dragOver) return null; // remaining both-sides ops need a cross-side target
    switch (p.kind) {
      case "coef":
      case "factor": {
        const t = findTermBy(p.termId);
        return t && Math.abs(t.num) > 1 ? { kind: "divide", text: String(Math.abs(t.num)) } : null;
      }
      case "den": {
        const t = findTermBy(p.termId);
        return t && t.den > 1 ? { kind: "multiply", text: String(t.den) } : null;
      }
      case "xmul": {
        const t = findTermBy(p.termId);
        return { kind: "multiply", text: t && t.kind === "leaf" ? varOf(t) : "x" };
      }
      case "neg":
        return { kind: "wrap", before: "−(", after: ")" };
      case "fn": {
        const t = findTermBy(p.termId);
        if (t?.kind === "func") {
          const INV: Record<FuncName, [string, string]> = {
            sin: ["arcsin(", ")"],
            cos: ["arccos(", ")"],
            tan: ["arctan(", ")"],
            ln: ["e^(", ")"],
            exp: ["ln(", ")"],
          };
          const [before, after] = INV[t.fn];
          return { kind: "wrap", before, after };
        }
        return null;
      }
      case "exp":
        return { kind: "wrap", before: "√(", after: ")" };
      default:
        return null; // a plain term move touches one term only
    }
  })();

  /**
   * Positional drop zones around a term. The lower half of every term is a
   * "denominator zone": hovering it morphs the equation in place — every
   * term shrinks into numerator position over a bar (dividing both sides
   * hits all of them), and the hovered term shows the dashed landing slot.
   */
  const withZones = (t: EqTerm, side: Side, content: ReactNode) => {
    const payload = dragPayloadRef.current;
    const hoveredHere = !!(dragActive && underHover === t.id && payload && payload.kind !== "tool");
    const fractioned = spread?.kind === "divide";
    const expGhosted = !!(dragActive && expHover === t.id && payload && payload.kind !== "tool");
    // the exp-target term shows its ² ghost instead of the ·x everyone else gets
    const multiplied = spread?.kind === "multiply" && expHover !== t.id;
    return (
      <span
        key={t.id}
        data-term-wrap={t.id}
        data-side={side}
        data-exp-ok={
          t.kind === "leaf" && !t.pm && !t.radical && !t.fnVal && t.power >= 1 ? "1" : undefined
        }
        className="relative inline-flex items-center"
      >
        {fractioned ? (
          <span className="inline-flex flex-col items-center self-center text-[0.62em] leading-none">
            <span className="inline-flex items-center">{content}</span>
            <span
              className={`my-[0.12em] h-[0.09em] w-full min-w-[1.2em] rounded ${
                hoveredHere ? "bg-amber-400" : "bg-amber-400/60"
              }`}
              aria-hidden
            />
            {hoveredHere && payload ? (
              <span className="whitespace-nowrap rounded-md border-2 border-dashed border-amber-400 bg-background px-[0.3em] py-[0.05em] text-[0.75em] leading-tight text-amber-500">
                {payloadGlyph(payload)}
              </span>
            ) : (
              <span className="whitespace-nowrap rounded-md border-2 border-transparent px-[0.3em] py-[0.05em] text-[0.75em] leading-tight text-amber-500/80">
                {spread?.kind === "divide" ? spread.text : ""}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center">
            {spread?.kind === "wrapTerm" && spread.termId === t.id && (
              <span className="mr-[0.08em] self-center whitespace-nowrap text-[0.6em] leading-none text-amber-500/90">
                {spread.before}
              </span>
            )}
            {content}
            {spread?.kind === "wrapTerm" && spread.termId === t.id && (
              <span className="ml-[0.08em] self-center whitespace-nowrap text-[0.6em] leading-none text-amber-500/90">
                {spread.after}
              </span>
            )}
            {multiplied && spread?.kind === "multiply" && (
              <span className="ml-[0.1em] self-center whitespace-nowrap text-[0.55em] italic leading-none text-amber-500/90">
                ·{spread.text}
              </span>
            )}
          </span>
        )}
        {expGhosted && (
          <span className="pointer-events-none absolute -right-[0.5em] -top-[0.3em] z-30 rounded border-2 border-dashed border-amber-400 bg-background px-[0.12em] text-[0.45em] leading-tight text-amber-500">
            {t.kind === "leaf" ? t.power + 1 : 2}
          </span>
        )}
      </span>
    );
  };

  /** The magnitude portion of a leaf term (numeral, x, fraction) */
  const renderLeafBody = (
    t: LeafTerm,
    side: Side,
    highlighted: boolean,
    opts: { termId?: string; inert?: boolean; innerRole?: Role } = {}
  ) => {
    const termId = opts.termId ?? t.id;
    const inert = opts.inert ?? false;
    const innerRole: Role = opts.innerRole ?? "term";
    const magnitude = Math.abs(t.num);
    const canDivide = !inert && magnitude > 1;
    const divideTitle = `Drag across the equals sign to divide both sides by ${magnitude}`;
    if (t.power >= 1) {
      return (
        <>
          {!(magnitude === 1 && t.den === 1) &&
            (t.den === 1 ? (
              <Sym
                termId={termId}
                side={side}
                role={inert ? innerRole : "coef"}
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
            role={inert ? innerRole : "xdiv"}
            highlighted={highlighted}
            blue={!inert}
            handlers={symHandlers}
            title={
              inert
                ? undefined
                : `Drag beside the other side to move the term — or under a term to divide both sides by ${varOf(t)}`
            }
            className="italic"
          >
            {varOf(t)}
          </Sym>
          {t.power >= 2 && (
            <Sym
              termId={termId}
              side={side}
              role={inert ? innerRole : "exp"}
              highlighted={highlighted}
              blue={!inert}
              handlers={symHandlers}
              title={
                inert
                  ? undefined
                  : t.power % 2 === 0
                    ? "Drag across the equals sign to take the square root of both sides"
                    : `Drag across the equals sign to take the ${t.power === 3 ? "cube" : `${t.power}th`} root of both sides`
              }
              className="self-start mt-[0.08em] text-[0.5em] leading-none"
            >
              {t.power}
            </Sym>
          )}
        </>
      );
    }
    if (t.power === 0) {
      return t.den === 1 ? (
        <Sym termId={termId} side={side} role={inert ? innerRole : "term"} highlighted={highlighted} handlers={symHandlers}>
          {magnitude}
        </Sym>
      ) : (
        <Fraction
          termId={termId}
          side={side}
          highlighted={highlighted}
          numText={magnitude}
          numRole="numer"
          numBlue={!inert}
          numTitle={inert ? undefined : "Drag beside the other side to move the term — or under a term to divide both sides by the numerator"}
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
        numRole="numer"
        numBlue={!inert}
        numTitle={inert ? undefined : "Drag beside the other side to move the term — or under a term to divide both sides by the numerator"}
        denNumber={t.den === 1 ? null : t.den}
        denX
        denVarText={varOf(t)}
        denVarPower={-t.power}
        inert={inert}
        handlers={symHandlers}
      />
    );
  };

  /** Inert renderer for nested arguments: leaves via renderLeafBody, nested
   *  groups/functions recursively — every glyph grabs the OWNING term */
  const renderInertTerm = (
    l: EqTerm,
    side: Side,
    highlighted: boolean,
    ownerId: string,
    role: Role
  ): ReactNode => {
    if (l.kind === "leaf") {
      if (l.pm || l.radical || l.fnVal) {
        const arg = l.den === 1 ? String(l.num) : `${l.num}/${l.den}`;
        return (
          <Sym termId={ownerId} side={side} role={role} highlighted={highlighted} handlers={symHandlers}>
            {l.pm ? "±" : ""}
            {l.radical ? `√${arg}` : l.fnVal === "e^" ? `e^${arg}` : `${l.fnVal}(${arg})`}
          </Sym>
        );
      }
      return renderLeafBody(l, side, highlighted, { termId: ownerId, inert: true, innerRole: role });
    }
    const coefMag = Math.abs(l.num);
    const coefText =
      coefMag === 1 && l.den === 1 ? "" : l.den === 1 ? String(coefMag) : `(${coefMag}/${l.den})`;
    const bits = l.inner.map((m, j) => (
      <span key={m.id} className="inline-flex items-center">
        {(j > 0 || negOf(m)) && (
          <Sym
            termId={ownerId}
            side={side}
            role={role}
            highlighted={highlighted}
            handlers={symHandlers}
            className={j > 0 ? "mx-2" : "mr-0.5"}
          >
            {j > 0 ? (negOf(m) ? "−" : "+") : "−"}
          </Sym>
        )}
        {renderInertTerm(m, side, highlighted, ownerId, role)}
      </span>
    ));
    if (l.kind === "group") {
      return (
        <span className="inline-flex items-center">
          <Sym termId={ownerId} side={side} role={role} highlighted={highlighted} handlers={symHandlers}>
            {coefText}(
          </Sym>
          {bits}
          <Sym termId={ownerId} side={side} role={role} highlighted={highlighted} handlers={symHandlers}>
            )
          </Sym>
        </span>
      );
    }
    if (l.fn === "exp") {
      return (
        <span className="inline-flex items-center">
          <Sym
            termId={ownerId}
            side={side}
            role={role}
            highlighted={highlighted}
            handlers={symHandlers}
            className="italic"
          >
            {coefText}e
          </Sym>
          <span className="mt-[0.08em] inline-flex items-center self-start text-[0.55em] leading-none">
            {bits}
          </span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center">
        <Sym
          termId={ownerId}
          side={side}
          role={role}
          highlighted={highlighted}
          handlers={symHandlers}
          className="mr-0.5 text-[0.75em]"
        >
          {coefText}
          {l.fn}
        </Sym>
        <Sym termId={ownerId} side={side} role={role} highlighted={highlighted} handlers={symHandlers}>
          (
        </Sym>
        {bits}
        <Sym termId={ownerId} side={side} role={role} highlighted={highlighted} handlers={symHandlers}>
          )
        </Sym>
      </span>
    );
  };

  const renderSide = (terms: EqTerm[], side: Side) => (
    <span
      className={`inline-flex items-center rounded-xl px-2 py-1 transition-shadow ${
        dragOver === side ? "ring-2 ring-amber-300" : ""
      }`}
    >
      {spread?.kind === "wrap" && (
        <span className="mr-1 self-center whitespace-nowrap text-[0.6em] leading-none text-amber-500/90">
          {spread.before}
        </span>
      )}
      {terms.map((t, i) => {
        // The lone "0" placeholder is display-only
        if (t.num === 0) {
          return (
            <span key={t.id} className="select-none">
              0
            </span>
          );
        }
        // ± / radical / inverse-function results are terminal VALUES — they
        // move as whole terms, and the ± is a clickable branch chooser
        if (t.kind === "leaf" && (t.pm || t.radical || t.fnVal)) {
          const arg = t.den === 1 ? String(t.num) : `${t.num}/${t.den}`;
          const termHighlighted =
            !!(selection?.side === side && selection.termIds.includes(t.id)) || hoveredTermId === t.id;
          const body = t.radical ? (
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
            <span>ln&thinsp;{arg}</span>
          ) : t.fnVal ? (
            <span className="inline-flex items-center">
              <span className="mr-1 text-[0.7em]">{t.fnVal}</span>({arg})
            </span>
          ) : (
            <span>{arg}</span>
          );
          return withZones(t, side, (
            <span className="inline-flex items-center">
              {(i > 0 || t.neg) && (
                <Sym
                  termId={t.id}
                  side={side}
                  role="term"
                  highlighted={termHighlighted}
                  handlers={symHandlers}
                  className={i > 0 ? "mx-4" : "mr-1"}
                >
                  {t.neg ? "−" : "+"}
                </Sym>
              )}
              {t.pm && (
                <span className="relative inline-flex">
                  <button
                    data-ui
                    onClick={() => setBranchPick((cur) => (cur === t.id ? null : t.id))}
                    className="mr-2 cursor-pointer rounded transition-colors hover:text-amber-500"
                    title="Click to keep just one branch: + or −"
                  >
                    ±
                  </button>
                  {branchPick === t.id && (
                    <span
                      data-ui
                      className="absolute bottom-[calc(100%+0.15em)] left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-lg border border-border bg-card p-1 font-sans text-[0.22em] leading-none shadow-lg"
                    >
                      <button
                        onClick={() => pickBranch(t.id, side, 1)}
                        className="whitespace-nowrap rounded-md px-2 py-1 transition-colors hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/30"
                      >
                        keep +
                      </button>
                      <button
                        onClick={() => pickBranch(t.id, side, -1)}
                        className="whitespace-nowrap rounded-md px-2 py-1 transition-colors hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/30"
                      >
                        keep −
                      </button>
                    </span>
                  )}
                </span>
              )}
              <Sym termId={t.id} side={side} role="term" highlighted={termHighlighted} handlers={symHandlers}>
                {body}
              </Sym>
            </span>
          ));
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
                data-parens-for={t.id}
                data-parens-kind="group"
                data-side={side}
              >
                <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                  (
                </Sym>
                {t.inner.map((l, j) => (
                  <span key={l.id} className="inline-flex items-center">
                    {(j > 0 || negOf(l)) && (
                      <Sym
                        termId={t.id}
                        side={side}
                        role="term"
                        highlighted={highlighted}
                        handlers={symHandlers}
                        className={j > 0 ? "mx-3" : "mr-0.5"}
                      >
                        {j > 0 ? (negOf(l) ? "−" : "+") : "−"}
                      </Sym>
                    )}
                    {renderInertTerm(l, side, highlighted, t.id, "term")}
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
          const argTitle =
            t.fn === "exp"
              ? "Drag the exponent down to the other side to take ln of both sides"
              : `Drag the argument out to the other side to apply arc${t.fn === "ln" ? "" : t.fn} — same as dragging the name`;
          const funcParensZone = {
            "data-parens-for": t.id,
            "data-parens-kind": "func",
            "data-side": side,
          };
          const inner = t.inner.map((l, j) => (
            <span key={l.id} className="inline-flex items-center">
              {(j > 0 || negOf(l)) && (
                <Sym
                  termId={t.id}
                  side={side}
                  role="fn"
                  highlighted={highlighted}
                  blue
                  title={argTitle}
                  handlers={symHandlers}
                  className={j > 0 ? "mx-3" : "mr-0.5"}
                >
                  {j > 0 ? (negOf(l) ? "−" : "+") : "−"}
                </Sym>
              )}
              {renderInertTerm(l, side, highlighted, t.id, "fn")}
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
                  <span
                    className={`mt-[0.08em] inline-flex items-center self-start text-[0.5em] leading-none ${
                      parenHover === t.id ? "rounded bg-amber-100 text-amber-600 dark:bg-amber-950/40" : ""
                    }`}
                    {...funcParensZone}
                  >
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
                  <span
                    className={`inline-flex items-center rounded-lg transition-colors ${
                      parenHover === t.id ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40" : ""
                    }`}
                    {...funcParensZone}
                  >
                    <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                      (
                    </Sym>
                    {inner}
                    <Sym termId={t.id} side={side} role="term" highlighted={highlighted} handlers={symHandlers}>
                      )
                    </Sym>
                  </span>
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
      {spread?.kind === "wrap" && (
        <span className="ml-1 self-center whitespace-nowrap text-[0.6em] leading-none text-amber-500/90">
          {spread.after}
        </span>
      )}
      {dragActive && dragOver === side && !underHover && !spread && sideGhost(side)}
    </span>
  );

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center bg-background text-foreground"
      onPointerDown={onBackgroundPointerDown}
    >
      {/* Typed equation input with live parse preview; the magnifier toggles
          word search over the function catalog */}
      <div className="absolute left-1/2 top-4 z-50 w-[min(560px,75vw)] -translate-x-1/2" data-ui data-search>
        <div
          className={`flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-sm transition-colors focus-within:border-foreground/40 ${
            searchMode ? "border-amber-300" : "border-border"
          }`}
        >
          <button
            onClick={() => {
              setSearchMode((on) => !on);
              setInputMsg(null);
            }}
            title={searchMode ? "Back to typing equations" : "Search famous functions by name (/ or Ctrl+K)"}
            className={`shrink-0 transition-colors ${
              searchMode ? "text-amber-500" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="h-4 w-4" />
          </button>
          <input
            ref={searchInputRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              setInputMsg(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitInput();
              if (e.key === "Escape") {
                // Escape steps outward: search mode off, then focus released
                if (searchMode) setSearchMode(false);
                (e.target as HTMLInputElement).blur();
              }
              if (searchMode && searchMatches.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchSel((i) => (i + 1) % searchMatches.length);
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchSel((i) => (i - 1 + searchMatches.length) % searchMatches.length);
                }
              }
            }}
            placeholder={
              searchMode ? 'search a function… try "bell curve" or "sigmoid"' : "type an equation… e.g. 2(x + 3) = 8"
            }
            spellCheck={false}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        {/* suggestions — the whole catalog on activation, narrowing as you type */}
        {searchMode && searchMatches.length > 0 && (
          <div className="absolute left-0 right-0 z-40 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border bg-card py-1 shadow-lg">
            {searchMatches.map((entry, i) => {
              const q = inputText.trim().toLowerCase();
              const bold = q && entry.name.toLowerCase().startsWith(q) ? entry.name.slice(q.length) : null;
              return (
                <button
                  key={entry.name}
                  data-search-row={i}
                  onClick={() => selectCatalogEntry(entry)}
                  onMouseEnter={() => setSearchSel(i)}
                  className={`flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm transition-colors ${
                    i === searchSel ? "bg-muted" : ""
                  }`}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="flex-none">
                    {bold !== null ? (
                      <>
                        {entry.name.slice(0, q.length)}
                        <span className="font-semibold">{bold}</span>
                      </>
                    ) : (
                      entry.name
                    )}
                  </span>
                  <span className="ml-auto truncate font-serif text-xs text-muted-foreground/70">{entry.text}</span>
                </button>
              );
            })}
          </div>
        )}
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

      {/* Symbol toolbox */}
      <div className="absolute left-4 top-4 z-30" data-ui data-toolbox>
        <div
          className="relative"
          onMouseEnter={() => {
            if (toolGroupTimer.current) clearTimeout(toolGroupTimer.current);
            setToolboxOpen(true);
          }}
          onMouseLeave={() => {
            toolGroupTimer.current = setTimeout(() => setToolboxOpen(false), 250);
          }}
        >
          <button
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-serif text-base shadow-sm transition-colors ${
              toolboxOpen
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                : "border-border bg-card hover:border-foreground/40"
            }`}
            onClick={() => setToolboxOpen((cur) => !cur)}
          >
            ƒ
            <span className="font-sans text-xs text-muted-foreground">Symbols</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${toolboxOpen ? "rotate-180" : ""}`}
            />
          </button>
          {toolboxOpen && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-40 w-max rounded-lg border border-border bg-card p-2 shadow-lg">
              {TOOLBOX.map((toolGroup) => (
                <div key={toolGroup.id} className="mb-2 last:mb-0">
                  <div className="mb-0.5 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {toolGroup.label}
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {toolGroup.items.map((item) => (
                      <button
                        key={item.glyph}
                        data-tool={item.tool || undefined}
                        data-action={item.action || undefined}
                        disabled={!item.tool && !(item.action && ddxReady)}
                        title={
                          item.tool
                            ? item.title
                            : item.action
                              ? ddxReady
                                ? item.action === "ddx"
                                  ? "Differentiate the function — a new equation about the same function"
                                  : "Integrate the function — one antiderivative, + C rides along"
                                : `${item.action === "ddx" ? "d/dx" : "∫"} needs y = f(x) — isolate the function first`
                              : "coming soon"
                        }
                        onClick={() => {
                          if (playingRef.current) return; // replay owns the stage
                          if (item.action) {
                            if (!ddxReady) return;
                            setToolboxOpen(false);
                            if (item.action === "ddx") applyDdx();
                            else applyIntegral();
                            return;
                          }
                          if (!item.tool) return;
                          if (treeEq) {
                            const result = applyToolT(item.tool, treeEq);
                            if (result === null) return;
                            setToolboxOpen(false);
                            if (typeof result === "string") {
                              flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
                            } else {
                              commitTreeOutcome(result);
                            }
                            return;
                          }
                          const result = tryApplyTool(item.tool);
                          if (result === null) return;
                          // choosing dismisses the menu — it must not linger
                          // over the equation and swallow the next grab
                          setToolboxOpen(false);
                          if (typeof result === "string") {
                            flashNotice(result.charAt(0).toUpperCase() + result.slice(1) + ".");
                          } else {
                            commitMove(result.label, result.next, result.dangerous, result.note, result.pill);
                          }
                        }}
                        className={`relative flex h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-md border border-transparent px-1.5 font-serif text-sm transition-all hover:z-10 ${
                          item.tool || (item.action && ddxReady)
                            ? "cursor-grab hover:scale-105 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
                            : "cursor-not-allowed opacity-35"
                        }`}
                      >
                        {item.glyph}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="mt-1.5 whitespace-nowrap border-t border-border pt-1 text-center text-[10px] text-muted-foreground">
                click = both sides (a legal move) · drag onto one term = rebuild it (a new equation)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dev: visualize grab regions and drop zones (not in embeds) */}
      {!isEmbed && (
      <label
        className="absolute bottom-6 left-4 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
        data-ui
      >
        <input
          type="checkbox"
          checked={devHitboxes}
          onChange={(e) => setDevHitboxes(e.target.checked)}
          className="h-3 w-3 accent-amber-500"
        />
        hit areas
        {devHitboxes && (
          <span className="text-muted-foreground/70">— grab activates on the nearest symbol within 28px</span>
        )}
      </label>
      )}
      {devHitboxes && (
        <style>{`
          [data-symbol] { outline: 1.5px dashed rgba(244, 63, 94, 0.55); outline-offset: -1px; }
          [data-term-wrap] { outline: 1.5px dashed rgba(245, 158, 11, 0.5); outline-offset: 4px; }
          [data-parens-for] { outline: 1.5px dashed rgba(20, 184, 166, 0.6); outline-offset: 2px; }
        `}</style>
      )}

      {/* History menu button, with replay and share beside it */}
      <div className="absolute right-4 top-4 flex items-center gap-2" data-ui data-history>
        <button
          onClick={copyShare}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Copy a link to this equation and its whole step history"
        >
          {copied ? "copied ✓" : "⧉ share"}
        </button>
        <button
          onClick={copyEmbed}
          className="rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Copy an iframe of this exact derivation — plug it into any page"
        >
          {copiedEmbed ? "copied ✓" : "</>"}
        </button>
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
          <div className="absolute right-0 top-[calc(100%+8px)] z-40 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-lg">
            {history.length > 1 && (
              <button
                onClick={() => (playing ? stopPlayback() : startPlayback())}
                className={`mb-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs transition-colors ${
                  playing
                    ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                    : "border-border text-muted-foreground hover:border-amber-300 hover:text-amber-700"
                }`}
              >
                {playing ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? "stop replay" : "replay the derivation"}
              </button>
            )}
            {history.map((step, i) => (
              <button
                key={step.id}
                onClick={() => restoreStep(i)}
                title={i < history.length - 1 ? "Click to rewind to this step" : "Current state"}
                className={`block w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted ${
                  step.dangerous ? "bg-amber-50 dark:bg-amber-950/30" : ""
                } ${
                  playing
                    ? i === playIndex
                      ? "ring-1 ring-amber-400"
                      : ""
                    : i === history.length - 1
                      ? "ring-1 ring-border"
                      : ""
                }`}
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
          solvedContradiction || (flatStatus ?? treeStatus) === "contradiction"
            ? "text-rose-500"
            : solved || treeSolved || (flatStatus ?? treeStatus) === "identity"
              ? "text-emerald-600"
              : ""
        }`}
      >
        {treeEq ? (
          <>
            <TreeSideView
              node={treeEq.left}
              side="left"
              hoveredTermId={hoveredTermId}
              selectedIds={selection?.side === "left" ? selection.termIds : null}
              onHover={symHandlers.hover}
            />
            <span className="mx-5 select-none" data-equals>=</span>
            <TreeSideView
              node={treeEq.right}
              side="right"
              hoveredTermId={hoveredTermId}
              selectedIds={selection?.side === "right" ? selection.termIds : null}
              onHover={symHandlers.hover}
            />
          </>
        ) : (
          <>
            {renderSide(left, "left")}
            <span className="mx-5 select-none" data-equals>=</span>
            {renderSide(right, "right")}
          </>
        )}
      </div>

      {/* State line: notice, solved, or a neutral hint — plus the active assumption */}
      <div className="mt-10 flex h-6 items-center gap-3 text-sm text-muted-foreground">
        {playing ? (
          <span className="font-medium text-amber-600">
            step {playIndex} of {history.length - 1} — {history[playIndex]?.label}
          </span>
        ) : dragPreview ? (
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
            {solvedVar} = 0 — but a step assumed {solvedVar} ≠ 0 (see history). No valid solution survives.
          </span>
        ) : solved ? (
          <span className="font-medium text-emerald-600">
            Solved — {solvedVar} = {solvedValue}
            {solvedApprox !== null && <span className="text-emerald-600/70"> ≈ {solvedApprox}</span>}
          </span>
        ) : treeSolved ? (
          <span className="font-medium text-emerald-600">
            Solved — {treeSolved.v} = {treeSolved.text}
            {treeSolved.approx !== null && <span className="text-emerald-600/70"> ≈ {treeSolved.approx}</span>}
          </span>
        ) : (flatStatus ?? treeStatus) === "identity" ? (
          <span className="font-medium text-emerald-600">Always true — the two sides are equal for every value</span>
        ) : (flatStatus ?? treeStatus) === "contradiction" ? (
          <span className="font-medium text-rose-500">No solution — the two sides can never be equal</span>
        ) : null}
        {!solvedContradiction &&
          assumptions.map((assumption) => (
            <span
              key={assumption}
              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            >
              {/^[xy] ≠ 0$/.test(assumption) ? `assuming ${assumption}` : assumption}
            </span>
          ))}
      </div>

      {/* Open-world reveals: isolate y and the input→output machine appears
          (with a curve & slope view — the home of d/dx); otherwise the curve
          view shows for nonlinear x-only equations. Tree equations earn the
          same panes through their own evaluator. */}
      {(() => {
        const fn = treeEq
          ? treePane?.kind === "mapping"
            ? {
                f: (t: number) => evalNode(treePane.rhs, { [treePane.input]: t }),
                depKey: printNode(treePane.rhs),
                input: treePane.input,
                output: treePane.out,
              }
            : null
          : functionMode
            ? {
                f: (x: number) => evalSide(functionMode.rhs, x),
                depKey: sideTextOf(functionMode.rhs),
                input: functionMode.input,
                output: functionMode.output,
              }
            : null;
        if (fn) {
          return (
            <>
              {fnView === "mapping" ? (
                <MappingPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} outputVar={fn.output} />
              ) : fnView === "slope" ? (
                <TangentPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} outputVar={fn.output} />
              ) : (
                <AreaPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} bounds={bounds} onBounds={setBounds} />
              )}
              <div className="mt-2 flex items-center gap-1.5 text-[11px]" data-ui>
                {(["mapping", "slope", "area"] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setFnView(view)}
                    className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                      fnView === view
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                    }`}
                  >
                    {view === "mapping" ? "input → output" : view === "slope" ? "curve & slope" : "area ∫"}
                  </button>
                ))}
              </div>
            </>
          );
        }
        if (treeEq && treePane?.kind === "graph") {
          return (
            <GraphView
              fl={(x) => evalNode(treeEq.left, { x })}
              fr={(x) => evalNode(treeEq.right, { x })}
              depKey={printTreeEq(treeEq)}
            />
          );
        }
        if (!treeEq && !mentionsY && isFunctionEquation(equation)) {
          return <GraphPane left={left} right={right} />;
        }
        return null;
      })()}

      {/* Reset, kept out of the way — equations arrive via typing or search */}
      <div className="absolute bottom-6 flex flex-wrap items-center justify-center gap-2 px-4" data-ui>
        <button
          onClick={() => restoreStep(0)}
          className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Reset the current equation"
        >
          ↺ Reset
        </button>
      </div>

      {/* Ghost chip following the pointer during a drag */}
      {ghostPos && dragActive && dragPayloadRef.current && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-amber-300 bg-amber-50/95 px-2 py-0.5 font-serif text-2xl text-amber-700 shadow-sm dark:bg-amber-950/80 dark:text-amber-400"
          style={{ left: ghostPos.x, top: ghostPos.y - 10 }}
        >
          {payloadGlyph(dragPayloadRef.current)}
        </div>
      )}

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
