import { Fragment, useEffect, useMemo, useRef, useState, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { BookOpen, ChevronDown, History, Play, Search, Square, TriangleAlert, X } from "lucide-react";
import { Side } from "./model";
import { parseEquation, renderMathPreview, type ParseResult } from "./parse";
import { CATALOG, searchCatalog, type CatalogEntry } from "./catalog";
import { GraphView } from "./graph";
import { MappingPane } from "./mapping";
import {
  TNode,
  TreeEq,
  cloneTreeEq,
  constValue,
  ensureTreeEqIds,
  evalNode,
  printNode,
  printTreeEq,
  simplify as simplifyTree,
  tadd,
  tc,
  tmul,
  tv,
  varsIn,
} from "./tree";
import { TangentPane } from "./tangent";
import { AreaPane } from "./area";
import { sharedFromUrl, shareUrl, type MoveStory } from "./share";
import {
  equationRevision,
  makeEquationDocument,
  predicateFromText,
  reconcileSymbols,
  symbolsInEquation,
  type EquationDocument,
  type EquationEvent,
  type Predicate,
  type SymbolRecord,
} from "./document";
import {
  applyEquationCommand,
  inspectEquationNodes,
  listApplicableEquationOperations,
  type EquationCommand,
  type EquationToolApi,
} from "./engine";
import { EquationSessionService } from "./session";
import { EQUATION_PROTOCOL_VERSION, type EquationProtocolApi } from "./protocol";
import {
  EquationRemoteSessionClient,
  equationSessionServiceUrl,
  liveShareUrl,
  sharedSessionKeyFromUrl,
  type RemoteConnectionState,
} from "./remote-session";
import type { SharedSessionSnapshot } from "./shared-session";
import { isEmbed } from "../../lib/embed";
import {
  applyToolT,
  divideBothT,
  finalize,
  normalizeOnLoad,
  thawExpLn,
  type TreeMoveResult,
  type TreeOutcome,
} from "./treemoves";
import { TreeSideView, type FactorizationHintView } from "./treeview";
import {
  isAtomicTreeFactorId,
  ownerOfTreeHandleId,
  resolveTreeFactor,
  resolveTreeFactorGroup,
  treeMarqueeSelection,
} from "./treeunits";
import {
  computeTreeOperation,
  previewTreeOperation,
  treeAddendExpression,
  treeCoefficientExpression,
  type DragPayload,
  type DropTarget,
  type ToolKind,
} from "./operations";
import { toggleTreeFactorSelection, type SymbolSelection } from "./selection";
import { treeActorDestinationTerm, treeAnimationStages, treeMoveStory } from "./treeanimation";
import {
  specialActionLabel,
  type SpecialActionKind,
  type SpecialActionRef,
} from "./specialactions";
import { detectFactorizationsEq, type Rewrite } from "./rewrites";
import {
  analyzeRelation,
  isViewSpecValid,
  isolationForView,
  unambiguousView,
  viewSpecKey,
  type ViewSpec,
} from "./relation";
import {
  derivedSymbolName,
  emptyDifferentiationContext,
  emptyIntegrationContext,
  inferCalculusDefaults,
  integrationDefaultsFrom,
  validateCalculusContext,
  type DifferentiationContext,
  type IntegrationContext,
} from "./calculus";
import { CalculusContextPanel, VisualizationSetup } from "./contextpanels";
import { TOOL_ROWS } from "./registry";
import { ImplicitRelationPane, ScalarFieldPane } from "./multivariable";

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

/**
 * The equation on first load — everything else arrives via typing or search.
 * ONE shared instance: the live state and the step-0 snapshot must carry the
 * SAME term ids, or move stories (which reference live ids) can never find
 * their actors when the history replays.
 */
const BOOT_TREE: TreeEq = ensureTreeEqIds({
  left: tadd(tmul(tc(2), tv("x")), tc(-3)),
  right: tc(-7),
});
const freshDocumentId = () =>
  `eq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** x³ etc. in plain text */
export const supText = (n: number): string =>
  (n < 0 ? "⁻" : "") + String(Math.abs(n)).split("").map((d) => SUP[Number(d)]).join("");

/**
 * Verdict for two whole sides: identity (Always true) when their difference is
 * zero everywhere, contradiction (No solution) when it's a fixed nonzero
 * constant, null when it still depends on a variable (needs a move to decide).
 * Decided by SAMPLING the difference at several generic points — this sees
 * through factored forms (2(x+1) vs 2x+2, a − (b+c)) that the simplifier
 * deliberately leaves un-distributed. Enough irrational-ish points that a
 * non-identity can't coincidentally read as zero at all of them.
 */
const STATUS_PTS: [number, number][] = [
  [0.317, 1.713],
  [2.114, -0.921],
  [-1.437, 3.229],
  [5.512, 0.634],
  [1.101, 2.318],
  [-3.246, -1.559],
];
const decideStatus = (L: TNode, R: TNode): "identity" | "contradiction" | null => {
  const diffs = STATUS_PTS.map(([x, y]) => evalNode(L, { x, y }) - evalNode(R, { x, y })).filter((d) =>
    Number.isFinite(d)
  );
  if (diffs.length < 4) return null; // too many undefined samples — don't claim
  const d0 = diffs[0];
  if (!diffs.every((d) => Math.abs(d - d0) < 1e-9)) return null; // varies → undecided
  return Math.abs(d0) < 1e-9 ? "identity" : "contradiction";
};

/**
 * Is old→new an honest in-place morph (a value swap), or an alias? Only equal
 * text, a number→number change (5→3, coefficient/sink swaps), or a sign flip
 * may morph a glyph; anything else (e→sin, 2→"(") is two different glyphs the
 * animation must NOT fuse — it fades one out and the other in instead.
 */
const isValueSwap = (a: string, b: string): boolean => {
  if (a === b) return true;
  const isNum = (s: string) => /^\d+$/.test(s);
  if (isNum(a) && isNum(b)) return true;
  const isSign = (s: string) => s === "+" || s === "−" || s === "-";
  return isSign(a) && isSign(b);
};
interface Step {
  id: number;
  label: string;
  note?: string;
  dangerous?: boolean;
  /** A standing assumption this step introduced (e.g. "x ≠ 0", "principal value") */
  pill?: string;
  /** The canonical equation state at this step. */
  tree: TreeEq;
  /** Literal operation result before simplification; replay's paper state. */
  intermediateTree?: TreeEq;
  /** how this step's move happened — drives the replay choreography */
  story?: MoveStory;
  /** Machine-replayable semantic operation. Step zero and old links omit it. */
  event?: EquationEvent;
  /** Document-level predicates not necessarily born from a semantic event (legacy/import boundary). */
  assumptions?: Predicate[];
  text: string;
}

const predicatesForSteps = (steps: Step[]): Predicate[] => {
  const predicates = new Map<string, Predicate>();
  for (const step of steps) {
    for (const predicate of step.assumptions ?? []) predicates.set(predicate.id, predicate);
    for (const predicate of step.event?.assumptionsAdded ?? []) predicates.set(predicate.id, predicate);
    if (step.pill) {
      const predicate = predicateFromText(step.pill);
      if (!predicates.has(predicate.id)) predicates.set(predicate.id, predicate);
    }
  }
  return Array.from(predicates.values());
};

/**
 * A lossless recording of ONE replay transition (dev capture mode). Screen
 * video is the worst channel for reading an animation — lossy compression and
 * unpredictable frame timing force positions to be reverse-engineered from
 * pixels. This is the opposite: every animating clone's exact on-screen box,
 * opacity, role and text, sampled every frame, with the phase windows labeled.
 * It reconstructs the choreography precisely and renders back to a filmstrip
 * (scripts/trace-to-filmstrip.cjs).
 */
interface TraceGlyphDef {
  id: number;
  key: string;
  bar: boolean;
}
interface TraceCloneFrame {
  id: number;
  x: number; // on-screen box, viewport px (includes transform + scale)
  y: number;
  w: number;
  h: number;
  op: number; // computed opacity, 0..1
  r: string; // animation role (actor / follower / equals / sink / died / born …)
  t: string; // current text (captures the sink's mid-merge value swap)
}
interface TraceFrame {
  t: number; // ms since the transition's first sampled frame
  clones: TraceCloneFrame[];
}
interface TraceStep {
  index: number;
  label: string;
  from: string;
  to: string;
  meta: Record<string, unknown>;
  phases: { name: string; t0: number; t1: number }[];
  curtain: number;
  viewport: { w: number; h: number };
  glyphs: TraceGlyphDef[];
  frames: TraceFrame[];
}

let stepCounter = 0;
let commandCounter = 0;

const makeTreeStep = (
  label: string,
  tree: TreeEq,
  dangerous?: boolean,
  note?: string,
  pill?: string,
  story?: MoveStory,
  intermediateTree?: TreeEq,
  event?: EquationEvent
): Step => ({
  id: stepCounter++,
  label,
  note,
  dangerous,
  pill,
  story,
  event,
  tree: cloneTreeEq(tree),
  intermediateTree: intermediateTree ? cloneTreeEq(intermediateTree) : undefined,
  text: printTreeEq(tree),
});

type Role = "term" | "coef" | "numer" | "den" | "xdiv" | "lnbase" | "root" | "raise";

/** Toolbox operations that apply to both sides of the equation */
interface ToolItem {
  glyph: string;
  tool?: ToolKind; // absent = shown as roadmap, disabled
  /** click-only operators with their own gate (calculus needs function mode) */
  action?: "ddx" | "int" | "calculus-custom";
  title?: string;
}

// Tool titles come from the operations registry — the glyphs and grouping
// are presentation, the operation inventory is the registry's.
const TOOLBOX: { id: string; label: string; items: ToolItem[] }[] = [
  {
    id: "functions",
    label: "Functions",
    items: [
      { glyph: "ln", tool: "ln", title: TOOL_ROWS.ln.title },
      { glyph: "eˣ", tool: "exp", title: TOOL_ROWS.exp.title },
      { glyph: "sin", tool: "sin", title: TOOL_ROWS.sin.title },
      { glyph: "cos", tool: "cos", title: TOOL_ROWS.cos.title },
      { glyph: "tan", tool: "tan", title: TOOL_ROWS.tan.title },
    ],
  },
  {
    id: "powers",
    label: "Powers",
    items: [
      { glyph: "√", tool: "sqrt", title: TOOL_ROWS.sqrt.title },
      { glyph: "( )²", tool: "square", title: TOOL_ROWS.square.title },
      { glyph: "1⁄( )", tool: "recip", title: TOOL_ROWS.recip.title },
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    items: [
      { glyph: "d⁄dx", action: "ddx" },
      { glyph: "∫", action: "int" },
      { glyph: "⚙", action: "calculus-custom" },
    ],
  },
];

interface SymbolHandlers {
  hover: (termId: string | null) => void;
}

const EquationBuilderTool = () => {
  // The tree is THE runtime model — non-null by construction. Legacy flat
  // share links convert at the decode boundary (share.ts) and never enter.
  const [treeEq, setTreeEq] = useState<TreeEq>(() => cloneTreeEq(BOOT_TREE));
  const [history, setHistory] = useState<Step[]>(() => [makeTreeStep("start", BOOT_TREE)]);
  const [documentId, setDocumentId] = useState(freshDocumentId);
  const [remoteSessionKey, setRemoteSessionKey] = useState<string | null>(() => sharedSessionKeyFromUrl());
  const [remoteConnection, setRemoteConnection] = useState<RemoteConnectionState>(() =>
    sharedSessionKeyFromUrl() ? "connecting" : equationSessionServiceUrl() ? "offline" : "disabled"
  );
  const remoteClientRef = useRef<EquationRemoteSessionClient | null>(null);
  const remoteSequenceRef = useRef(-1);
  const remoteDocumentJsonRef = useRef<string | null>(null);
  const remoteSnapshotHandlerRef = useRef<(snapshot: SharedSessionSnapshot) => void>(() => undefined);
  const remoteSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const protocolServiceRef = useRef<EquationSessionService | null>(null);
  if (!protocolServiceRef.current) protocolServiceRef.current = new EquationSessionService();
  const [symbolRecords, setSymbolRecords] = useState<SymbolRecord[]>(() => symbolsInEquation(BOOT_TREE));
  const [symbolBookOpen, setSymbolBookOpen] = useState(false);
  const [hoveredSymbolId, setHoveredSymbolId] = useState<string | null>(null);
  /** Mathematical view state belongs to the shareable document, not transient UI. */
  const [fnView, setFnView] = useState<"mapping" | "slope" | "area">("slope");
  const [bounds, setBounds] = useState<{ lo: number; hi: number }>({ lo: 0, hi: 2 });
  const [probeValue, setProbeValue] = useState(1);
  const [viewSpec, setViewSpec] = useState<ViewSpec | null>(() =>
    unambiguousView(analyzeRelation(BOOT_TREE))
  );
  const [planeProbe, setPlaneProbe] = useState({ x: 1, y: 1 });
  const [calculusOpen, setCalculusOpen] = useState<"differentiate" | "integrate" | null>(null);
  const [differentiationContext, setDifferentiationContext] = useState<DifferentiationContext>(
    emptyDifferentiationContext
  );
  const [integrationContext, setIntegrationContext] = useState<IntegrationContext>(
    emptyIntegrationContext
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragOver, setDragOver] = useState<Side | null>(null);
  const [parenHover, setParenHover] = useState<string | null>(null);
  const [selection, setSelection] = useState<SymbolSelection | null>(null);
  const [hoveredTermId, setHoveredTermId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ kind: "ok" | "reject" | "cancel"; text: string } | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<DropTarget | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [specialBubble, setSpecialBubble] = useState<{
    action: SpecialActionRef;
    ownerId: string;
    x: number;
    y: number;
  } | null>(null);
  const [factorizationDetection, setFactorizationDetection] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("vmt:factorization-detection") === "1";
    } catch {
      return false;
    }
  });
  const [dismissedFactorizationHints, setDismissedFactorizationHints] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [devHitboxes, setDevHitboxes] = useState(false);
  /** dev: record each replay transition as a lossless JSON trace (see below) */
  const [devCapture, setDevCapture] = useState(false);
  const capturingRef = useRef(false);
  const captureStepsRef = useRef<TraceStep[]>([]);
  const captureLabelRef = useRef<{ label: string; from: string; to: string }>({ label: "", from: "", to: "" });
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [underHover, setUnderHover] = useState<string | null>(null);
  const underHoverRef = useRef<string | null>(null);
  const [termHover, setTermHover] = useState<string | null>(null);
  const termHoverRef = useRef<string | null>(null);
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

  /** Meanings queued for symbols a calculus step is about to birth (y′, z_x). */
  const pendingSymbolMeaningsRef = useRef<Map<string, string>>(new Map());
  /** Dependency edges declared by typed function notation (y(x) = …), applied on reconcile. */
  const pendingDependenciesRef = useRef<Record<string, string[]> | null>(null);
  useEffect(() => {
    setSymbolRecords((current) => {
      const reconciled = reconcileSymbols(treeEq, current);
      const pending = pendingSymbolMeaningsRef.current;
      const declaredEdges = pendingDependenciesRef.current;
      pendingDependenciesRef.current = null;
      const withEdges = declaredEdges
        ? reconciled.map((record) =>
            declaredEdges[record.name]
              ? {
                  ...record,
                  dependsOn: declaredEdges[record.name],
                  provenance: { ...record.provenance, confirmedByHuman: true },
                }
              : record
          )
        : reconciled;
      if (pending.size === 0) return withEdges;
      const enriched = withEdges.map((record) =>
        pending.has(record.name) && !record.meaning
          ? { ...record, meaning: pending.get(record.name)! }
          : record
      );
      pending.clear();
      return enriched;
    });
  }, [treeEq]);

  const relationAnalysis = useMemo(
    () => analyzeRelation(treeEq),
    [treeEq]
  );
  /** Declared dependency edges from the symbol book, keyed by symbol name. */
  const declaredDependencies = useMemo(
    () =>
      Object.fromEntries(
        symbolRecords
          .filter((record) => (record.dependsOn ?? []).length > 0)
          .map((record) => [record.name, record.dependsOn!])
      ),
    [symbolRecords]
  );
  /** Which of the four calculus readiness states this relation is in. */
  const calculusReadiness = useMemo(
    () => relationAnalysis
      ? inferCalculusDefaults({ ...relationAnalysis, dependencies: declaredDependencies })
      : null,
    [relationAnalysis, declaredDependencies]
  );
  const analyzedRevisionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!relationAnalysis) return;
    const revision = equationRevision(treeEq);
    if (analyzedRevisionRef.current === revision) return;
    analyzedRevisionRef.current = revision;
    setViewSpec((current) =>
      current && isViewSpecValid(current, relationAnalysis)
        ? current
        : unambiguousView(relationAnalysis)
    );
    const known = new Set(relationAnalysis.symbols);
    setDifferentiationContext((current) => ({
      ...current,
      withRespectTo: known.has(current.withRespectTo) ? current.withRespectTo : "",
      dependent: current.dependent.filter((name) => known.has(name)),
      heldConstant: current.heldConstant.filter((name) => known.has(name)),
    }));
    setIntegrationContext((current) => ({
      ...current,
      withRespectTo: known.has(current.withRespectTo) ? current.withRespectTo : "",
      dependent: current.dependent.filter((name) => known.has(name)),
      heldConstant: current.heldConstant.filter((name) => known.has(name)),
    }));
  }, [treeEq, relationAnalysis]);

  useEffect(() => {
    if (!symbolBookOpen) return;
    const closeOnOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-symbol-book]")) setSymbolBookOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSymbolBookOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [symbolBookOpen]);

  useEffect(() => {
    if (!calculusOpen) return;
    const closeOnOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-calculus-context]") && !target?.closest("[data-action]")) {
        setCalculusOpen(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalculusOpen(null);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [calculusOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem("vmt:factorization-detection", factorizationDetection ? "1" : "0");
    } catch {
      // Private browsing and embedded browsers may deny storage. The toggle
      // still works for this session.
    }
  }, [factorizationDetection]);

  const factorizationCandidates = useMemo(
    () =>
      factorizationDetection ? detectFactorizationsEq(treeEq) : [],
    [factorizationDetection, treeEq]
  );

  // --- Replay: animate the derivation from step 0 to the latest form ------
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const playingRef = useRef(false);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const downloadTrace = () => {
    const steps = captureStepsRef.current;
    if (steps.length === 0) return;
    const trace = {
      format: "vmt-anim-trace",
      version: 1,
      steps,
    };
    const blob = new Blob([JSON.stringify(trace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `anim-trace-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    captureStepsRef.current = [];
  };

  const stopPlayback = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    playTimer.current = null;
    playingRef.current = false;
    setPlaying(false);
    clearOverlay();
    if (capturingRef.current) downloadTrace();
    setHistory((h) => {
      const last = h[h.length - 1];
      setTreeEq(cloneTreeEq(last.tree));
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
    side: Side | null;
  }

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
        role: el.dataset.role ?? owner?.dataset.role ?? null,
        side: (owner?.dataset.side as Side | undefined) ?? null,
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
    clone.setAttribute("data-anim", g.isBar ? "bar" : "glyph");
    clone.setAttribute("data-anim-key", g.key);
    clone.style.cssText =
      `position:fixed;left:${g.rect.left}px;top:${g.rect.top}px;` +
      `width:${g.rect.width}px;height:${g.rect.height}px;margin:0;padding:0;` +
      `display:flex;align-items:center;justify-content:center;white-space:pre;` +
      `font:${g.font};color:${g.color};line-height:1;transform-origin:0 0;` +
      `will-change:transform,opacity;transition:color .25s ease;` +
      (g.isBar ? `background:${g.color};border-radius:2px;` : "");
    overlay.appendChild(clone);
    return clone;
  };

  /**
   * The spec's engine. BEFORE the state switches, the old view is rebuilt as
   * an overlay of self-styled clones and the real container hides —
   * pixel-identical, so no frame is ever blank, doubled, or ghosted.
   *
   * Every token gets exactly one classification (unchanged / moved /
   * mutated / created / destroyed) and the timeline plays in phases:
   *   1. emphasis  — the actor pulses so the eye locks on
   *   2. travel    — ONLY the actor moves, along a gentle arc
   *   3. land      — consequences fire at the landing instant: mutations
   *                  swap-and-pulse, merge partners collapse, results are born
   *   4. reflow    — everyone else glides to the new layout (the = included,
   *                  which is frozen until here)
   * Opacity animates only on true births and deaths. Survivors MOVE.
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
          type Clone = (typeof clones)[number];

          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          // Travel curve: the old ease-OUT (0.2,0.8,…) front-loaded everything —
          // ~90% of the distance was covered in the first third of the window,
          // so the term LUNGED then crept, reading as "too fast" no matter how
          // long the window. This spreads the motion evenly (25/50/75/90% of the
          // distance at ~22/38/56/72% of the time): a prompt but unhurried glide
          // that starts without a ramp-in and decelerates into the landing.
          const TRAVEL = "cubic-bezier(0.3, 0.2, 0.5, 1)";
          const SETTLE = "cubic-bezier(0.2, 0.6, 0.3, 1)";
          // Reflow curve: for a small flat settle SETTLE is fine, but on a tree
          // step the reflow IS the whole motion (many glyphs restructuring at
          // once), and SETTLE's front load made a big move lunge-then-creep.
          // This even curve spreads the glide across the window and eases into
          // rest — same shape as TRAVEL, applied to the followers.
          const REFLOW = "cubic-bezier(0.3, 0.2, 0.5, 1)";
          const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          const unionCenter = (rects: DOMRect[]) => {
            const left = Math.min(...rects.map((r) => r.left));
            const right = Math.max(...rects.map((r) => r.right));
            const top = Math.min(...rects.map((r) => r.top));
            const bottom = Math.max(...rects.map((r) => r.bottom));
            return { x: (left + right) / 2, y: (top + bottom) / 2 };
          };

          // ---- classification: every token gets exactly one transition ----
          const actorRole = new Map<string, string | null>();
          story?.actors.forEach((a) => actorRole.set(a.term, a.role ?? null));
          const siteSet = new Set(story?.site ?? []);
          const bornSet = new Set(story?.born ?? []);

          const isActorGlyph = (g: Glyph) =>
            !!g.term &&
            actorRole.has(g.term) &&
            (actorRole.get(g.term) === null || g.role === actorRole.get(g.term));
          const actorClones = clones.filter((c) => isActorGlyph(c.g));
          const siteClones = clones.filter((c) => c.g.term && siteSet.has(c.g.term) && !isActorGlyph(c.g));
          const bornGlyphs = news.filter((g) => g.term && bornSet.has(g.term));

          const restClones = clones.filter((c) => !actorClones.includes(c) && !siteClones.includes(c));
          const bornGlyphSet = new Set(bornGlyphs);
          const restNews = news.filter((g) => !bornGlyphSet.has(g));

          // pair actor glyphs with their own new home (a surviving traveler).
          // The ROLE filter matters: when only the coefficient acts (divide),
          // the term's surviving x is a follower, not the actor's home.
          const actorNewByTerm = new Map<string, Glyph[]>();
          restNews.forEach((g) => {
            if (g.term && isActorGlyph(g)) {
              if (!actorNewByTerm.has(g.term)) actorNewByTerm.set(g.term, []);
              actorNewByTerm.get(g.term)!.push(g);
            }
          });
          // A tree factor's handle encodes its owner and fraction zone. After
          // crossing the equals sign both legitimately change, even though the
          // mathematical factor is the same. Match that destination as one
          // semantic chunk by its glyph sequence on the named target side.
          if (story?.to && actorClones.length > 0 && actorNewByTerm.size === 0) {
            const destinationTerm = treeActorDestinationTerm(
              actorClones.map((clone) => clone.g),
              restNews,
              story
            );
            const destination = destinationTerm
              ? restNews.filter((glyph) => glyph.term === destinationTerm)
              : null;
            if (destination) {
              actorClones.forEach((c) => {
                if (c.g.term) actorNewByTerm.set(c.g.term, destination);
              });
            }
          }
          const claimedNew = new Set<Glyph>();

          // pair followers by term id first, then by content, nearest-first
          const pairs: { c: Clone; n: Glyph }[] = [];
          const mutations: { c: Clone; n: Glyph }[] = [];
          const actorTravels: { c: Clone; n: Glyph | null }[] = [];
          const deaths: Clone[] = [];
          const births: Glyph[] = [];

          // actor terms: same-key glyphs travel to their own new rects;
          // leftovers (the flipping sign) travel too, mutating mid-flight
          const actorMutations: { c: Clone; n: Glyph }[] = [];
          const actorByTerm = new Map<string, Clone[]>();
          actorClones.forEach((c) => {
            if (!c.g.term) return;
            if (!actorByTerm.has(c.g.term)) actorByTerm.set(c.g.term, []);
            actorByTerm.get(c.g.term)!.push(c);
          });
          actorByTerm.forEach((termClones, termId) => {
            const homes = actorNewByTerm.get(termId) ?? [];
            const usedHome = new Set<Glyph>();
            const leftoverClones: Clone[] = [];
            for (const c of termClones) {
              const match = homes.find((h) => !usedHome.has(h) && !claimedNew.has(h) && h.key === c.g.key);
              if (match) {
                usedHome.add(match);
                claimedNew.add(match);
                actorTravels.push({ c, n: match });
              } else {
                leftoverClones.push(c);
              }
            }
            const leftoverHomes = homes.filter((h) => !usedHome.has(h));
            leftoverClones.sort((a, b) => a.g.rect.left - b.g.rect.left);
            leftoverHomes.sort((a, b) => a.rect.left - b.rect.left);
            const k = Math.min(leftoverClones.length, leftoverHomes.length);
            for (let i = 0; i < k; i++) {
              claimedNew.add(leftoverHomes[i]);
              actorMutations.push({ c: leftoverClones[i], n: leftoverHomes[i] });
            }
            leftoverClones.slice(k).forEach((c) => actorTravels.push({ c, n: null })); // consumed traveler
          });

          // followers
          const oldByTerm = new Map<string, Clone[]>();
          restClones.forEach((c) => {
            if (!c.g.term) return;
            if (!oldByTerm.has(c.g.term)) oldByTerm.set(c.g.term, []);
            oldByTerm.get(c.g.term)!.push(c);
          });
          const followerNews = restNews.filter((g) => !claimedNew.has(g));
          const inTermNews = new Map<string, Glyph[]>();
          const globalNews: Glyph[] = [];
          followerNews.forEach((g) => {
            if (g.term && oldByTerm.has(g.term) && !actorRole.has(g.term)) {
              if (!inTermNews.has(g.term)) inTermNews.set(g.term, []);
              inTermNews.get(g.term)!.push(g);
            } else {
              globalNews.push(g);
            }
          });
          const claimedOld = new Set<Clone>();
          inTermNews.forEach((termNews, termId) => {
            const termOlds = (oldByTerm.get(termId) ?? []).filter((c) => !claimedOld.has(c));
            const usedOld = new Set<Clone>();
            const leftoverNews: Glyph[] = [];
            for (const n of termNews) {
              const match = termOlds.find((c) => !usedOld.has(c) && c.g.key === n.key);
              if (match) {
                usedOld.add(match);
                claimedOld.add(match);
                pairs.push({ c: match, n });
              } else {
                leftoverNews.push(n);
              }
            }
            const leftoverOlds = termOlds.filter((c) => !usedOld.has(c));
            leftoverOlds.sort((a, b) => a.g.rect.left - b.g.rect.left);
            leftoverNews.sort((a, b) => a.rect.left - b.rect.left);
            const k = Math.min(leftoverOlds.length, leftoverNews.length);
            for (let i = 0; i < k; i++) {
              claimedOld.add(leftoverOlds[i]);
              // A morph is only honest as a VALUE swap (exponent 5→3, a
              // coefficient, a sign flip). Positional tree ids can alias
              // unrelated glyphs across a restructure (e² cancels, "sin"
              // slides into e's slot → a bogus e→sin morph). Reject those:
              // fade the old out, the new in, instead of morphing one letter
              // into a different word.
              if (isValueSwap(leftoverOlds[i].g.key, leftoverNews[i].key)) {
                mutations.push({ c: leftoverOlds[i], n: leftoverNews[i] });
              } else {
                deaths.push(leftoverOlds[i]);
                births.push(leftoverNews[i]);
              }
            }
            leftoverOlds.slice(k).forEach((c) => {
              claimedOld.add(c);
              deaths.push(c);
            });
            leftoverNews.slice(k).forEach((n) => births.push(n));
          });
          // global content matching for whatever term pairing could not claim
          const leftOld = restClones.filter((c) => !claimedOld.has(c));
          const leftNew = globalNews.filter((g) => !claimedNew.has(g));
          const byKey = new Map<string, { olds: Clone[]; news: Glyph[] }>();
          const bucket = (k: string) => {
            if (!byKey.has(k)) byKey.set(k, { olds: [], news: [] });
            return byKey.get(k)!;
          };
          leftOld.forEach((c) => bucket(c.g.key).olds.push(c));
          leftNew.forEach((g) => bucket(g.key).news.push(g));
          byKey.forEach(({ olds: os, news: ns }) => {
            const used = new Set<number>();
            for (const n of ns.sort((a, b) => a.rect.left - b.rect.left)) {
              let best = -1;
              let bestDist = Infinity;
              os.forEach((c, i) => {
                if (used.has(i)) return;
                const d = Math.abs(c.g.rect.left - n.rect.left) + Math.abs(c.g.rect.top - n.rect.top) * 2;
                if (d < bestDist) {
                  bestDist = d;
                  best = i;
                }
              });
              if (best >= 0) {
                used.add(best);
                pairs.push({ c: os[best], n });
              } else {
                births.push(n);
              }
            }
            os.forEach((c, i) => {
              if (!used.has(i)) deaths.push(c);
            });
          });

          // ---- the timeline: the v2 choreography ---------------------------
          // emphasis (orange + 1.07) → travel alone (arc, in-flight sign
          // morph) → INTERMEDIATE landing anchored to the sink's CURRENT
          // rect → HOLD the paper state → merge into the sink (content swap
          // + pulse at 60%) → reflow last. Divide-style ops instead aim at
          // the final layout while everything early-reflows beneath (§4).
          // Opacity animates only on true births and deaths.
          const EMPH = "#e0740c";
          const unionRect = (rects: DOMRect[]): DOMRect => {
            const left = Math.min(...rects.map((r) => r.left));
            const right = Math.max(...rects.map((r) => r.right));
            const top = Math.min(...rects.map((r) => r.top));
            const bottom = Math.max(...rects.map((r) => r.bottom));
            return new DOMRect(left, top, right - left, bottom - top);
          };
          const rcenter = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

          const consumedActors = actorTravels.filter((t) => t.n === null);
          const hasActor = actorTravels.length > 0 || actorMutations.length > 0;

          // Tree steps carry no traveling actor; they name the acted-on unit(s)
          // in story.emphasize. Exact factor ids light one factor; an addend or
          // product handle lights every factor owned by that semantic addend.
          const emphIds = story?.emphasize ?? [];
          const emphSet = new Set(emphIds);
          const emphMatch = (term: string | null): boolean => {
            if (!term) return false;
            if (emphSet.has(term)) return true;
            for (const id of emphIds) {
              const owner = ownerOfTreeHandleId(id);
              const broad = id === owner || id.startsWith("product:");
              if (broad && ownerOfTreeHandleId(term) === owner) return true;
            }
            return false;
          };
          const emphClones = hasActor ? [] : clones.filter((c) => emphMatch(c.g.term));
          const hasEmphasis = !hasActor && emphClones.length > 0;

          // The sink: a resident term whose id SURVIVED with changed glyphs.
          // Stable ids make this exact — no landing-on-heuristics.
          const oldTermText = new Map<string, string>();
          clones.forEach(({ g }) => {
            if (g.term) oldTermText.set(g.term, (oldTermText.get(g.term) ?? "") + g.key);
          });
          const newTermText = new Map<string, string>();
          news.forEach((g) => {
            if (g.term) newTermText.set(g.term, (newTermText.get(g.term) ?? "") + g.key);
          });
          const mutatedTermIds = Array.from(oldTermText.keys()).filter(
            (id) => !actorRole.has(id) && newTermText.has(id) && newTermText.get(id) !== oldTermText.get(id)
          );
          const actorUnion =
            actorClones.length > 0 ? unionRect(actorClones.map((c) => c.g.rect)) : null;

          // divide/factor: the coefficient dives below a bar — its home is the
          // matching glyph in denominator position of the FINAL layout
          let divideDest: Glyph | null = null;
          const coefActor = (story?.actors ?? []).find((a) => a.role === "coef" || a.role === "factor");
          if (coefActor && consumedActors.length > 0 && actorUnion) {
            const key0 = consumedActors[0].c.g.key;
            const midY = rcenter(actorUnion).y;
            divideDest =
              news.find(
                (g) =>
                  !claimedNew.has(g) &&
                  g.key === key0 &&
                  (g.role === "den" || g.role === "xdiv" || g.rect.top > midY + 8)
              ) ?? null;
            if (divideDest) {
              claimedNew.add(divideDest);
              const bi = births.indexOf(divideDest);
              if (bi >= 0) births.splice(bi, 1);
            }
          }

          let sinkTermId: string | null = null;
          if (!divideDest && consumedActors.length > 0 && actorUnion) {
            if (story?.sink && oldTermText.has(story.sink)) {
              // the script NAMES its sink — recorded by the operation itself
              sinkTermId = story.sink;
            } else if (mutatedTermIds.length > 0) {
              // old share links carry no sink: fall back to the
              // survived-with-changed-glyphs heuristic
              const eqOld = clones.find((c) => c.g.key === "=");
              const eqX = eqOld ? rcenter(eqOld.g.rect).x : actorUnion.left;
              const actorSideRight = rcenter(actorUnion).x > eqX;
              const candidates = mutatedTermIds
                .map((id) => ({
                  id,
                  rect: unionRect(clones.filter((c) => c.g.term === id).map((c) => c.g.rect)),
                }))
                .filter((cand) => cand.rect.width > 0);
              const oppositeSide = candidates.filter(
                (cand) => rcenter(cand.rect).x > eqX !== actorSideRight
              );
              const pick = (oppositeSide.length ? oppositeSide : candidates)[0];
              sinkTermId = pick ? pick.id : null;
            }
          }
          const sinkUnion = sinkTermId
            ? unionRect(clones.filter((c) => c.g.term === sinkTermId).map((c) => c.g.rect))
            : null;
          const hasMerge = consumedActors.length > 0 && !!sinkUnion;
          // dividing when the result REDUCES: no denominator survives into the
          // final layout, so the fraction is SYNTHESIZED on the overlay — the
          // coefficient dives under the sink, a bar rises mid-flight, the
          // paper state (−4/2) holds, then it simplifies (testbed: divide sides)
          const divisionForm = !!coefActor && hasMerge && !divideDest;
          // legacy share links carry site/born ids instead of surviving sinks
          const legacySite = !hasMerge && !divideDest && (siteClones.length > 0 || bornGlyphs.length > 0);
          const earlyReflow = !!divideDest;

          // phase times (ms): emphasis / travel / hold / merge / reflow.
          //   move across =     70 / 600 / 260 / 320 / 240
          //   divide sides      70 / 680 / 260 / 360 / 240
          // Emphasis is a brief fixation cue, not a stall — a long pause before
          // motion reads as lag; travel is stretched so a term reads as PLACED,
          // not flung (a slower arc is easier for the eye to track).
          const isDivide = divisionForm || earlyReflow;
          const EMPH_MS = hasActor || hasEmphasis ? 70 : 0;
          const TRAVEL_MS = hasActor ? (isDivide ? 680 : 600) : 0;
          const T_TRAVEL_START = EMPH_MS;
          const T_LAND = T_TRAVEL_START + TRAVEL_MS;
          const HOLD_MS = hasMerge || legacySite ? 260 : hasActor ? 60 : 0;
          const MERGE_MS = hasMerge || legacySite ? (isDivide ? 360 : 320) : 0;
          const T_MERGE = T_LAND + HOLD_MS;
          // Reflow duration scales with how far the followers actually travel,
          // so perceived speed stays roughly constant (Material/Carbon "duration
          // ∝ distance"). A small flat settle stays ~240ms; a big tree
          // restructure gets up to ~500ms instead of cramming 370px into 240ms.
          const reflowDist = [...pairs, ...mutations].reduce(
            (m, { c, n }) => Math.max(m, Math.hypot(n.rect.left - c.g.rect.left, n.rect.top - c.g.rect.top)),
            0
          );
          const REFLOW_MS = Math.round(Math.min(500, Math.max(240, 170 + reflowDist * 0.7)));
          const T_REFLOW = earlyReflow ? T_TRAVEL_START : T_MERGE + MERGE_MS + (hasMerge || legacySite ? 30 : 0);
          const CURTAIN = reduced
            ? 120
            : earlyReflow
              ? T_LAND + 220
              : T_REFLOW + REFLOW_MS + 80;

          const siteCenter =
            siteClones.length > 0
              ? unionCenter(siteClones.map((c) => c.g.rect))
              : bornGlyphs.length > 0
                ? unionCenter(bornGlyphs.map((g) => g.rect))
                : null;

          // ── test instrumentation: tag every clone with its animation role
          // and publish the phase timeline. Read by the phase-verification
          // harness (scripts/test-anim-phases.cjs); inert in normal use. ──
          {
            const tag = (node: HTMLElement, role: string) => node.setAttribute("data-anim-role", role);
            restClones.forEach((c) => tag(c.node, c.g.key === "=" ? "equals" : "follower"));
            pairs.forEach((p) => tag(p.c.node, p.c.g.key === "=" ? "equals" : "follower"));
            mutations.forEach((m) => tag(m.c.node, m.c.g.term === sinkTermId ? "sink" : "mutate"));
            actorTravels.forEach((t) => tag(t.c.node, t.n ? "actor" : "actor-consumed"));
            actorMutations.forEach((m) => tag(m.c.node, "actor"));
            actorClones.forEach((c) => { if (!c.node.getAttribute("data-anim-role")) tag(c.node, "actor"); });
            siteClones.forEach((c) => tag(c.node, "site"));
            clones.forEach((c) => { if (c.g.term === sinkTermId && !c.node.getAttribute("data-anim-role")) tag(c.node, "sink"); });
            deaths.forEach((c) => tag(c.node, "died"));
            emphClones.forEach((c) => { if (!c.node.getAttribute("data-anim-role")) tag(c.node, "emph"); });
            (window as unknown as { __animPhases?: unknown }).__animPhases = {
              start: performance.now(),
              hasActor, hasMerge, hasEmphasis, divisionForm, earlyReflow, reduced,
              phases: reduced
                ? [{ name: "reduced", t0: 0, t1: CURTAIN }]
                : [
                    { name: "emphasis", t0: 0, t1: EMPH_MS },
                    { name: "travel", t0: T_TRAVEL_START, t1: T_LAND },
                    { name: "hold", t0: T_LAND, t1: T_MERGE },
                    ...(hasMerge || legacySite ? [{ name: "merge", t0: T_MERGE, t1: T_MERGE + MERGE_MS }] : []),
                    { name: "reflow", t0: T_REFLOW, t1: T_REFLOW + REFLOW_MS },
                  ],
              curtain: CURTAIN,
            };
          }

          // ── dev capture: sample every animating clone each frame into a
          // lossless JSON trace, until the curtain. Inert unless capturing. ──
          if (capturingRef.current) {
            const phases = [
              ...(reduced
                ? [{ name: "reduced", t0: 0, t1: CURTAIN }]
                : [
                    { name: "emphasis", t0: 0, t1: EMPH_MS },
                    { name: "travel", t0: T_TRAVEL_START, t1: T_LAND },
                    { name: "hold", t0: T_LAND, t1: T_MERGE },
                    ...(hasMerge || legacySite ? [{ name: "merge", t0: T_MERGE, t1: T_MERGE + MERGE_MS }] : []),
                    { name: "reflow", t0: T_REFLOW, t1: T_REFLOW + REFLOW_MS },
                  ]),
            ];
            const rec: TraceStep = {
              index: captureStepsRef.current.length,
              label: captureLabelRef.current.label,
              from: captureLabelRef.current.from,
              to: captureLabelRef.current.to,
              meta: { hasActor, hasMerge, divisionForm, earlyReflow, reduced, legacySite },
              phases,
              curtain: CURTAIN,
              viewport: { w: window.innerWidth, h: window.innerHeight },
              glyphs: [],
              frames: [],
            };
            const idOf = new Map<HTMLElement, number>();
            let t0 = -1;
            const sample = () => {
              if (overlayRef.current !== overlay) {
                captureStepsRef.current.push(rec);
                return;
              }
              const now = performance.now();
              if (t0 < 0) t0 = now;
              const t = Math.round(now - t0);
              const frame: TraceFrame = { t, clones: [] };
              overlay.querySelectorAll<HTMLElement>("[data-anim]").forEach((node) => {
                let id = idOf.get(node);
                if (id === undefined) {
                  id = rec.glyphs.length;
                  idOf.set(node, id);
                  rec.glyphs.push({
                    id,
                    key: node.getAttribute("data-anim-key") ?? "",
                    bar: node.getAttribute("data-anim") === "bar",
                  });
                }
                const r = node.getBoundingClientRect();
                const cs = getComputedStyle(node);
                frame.clones.push({
                  id,
                  x: Math.round(r.left * 10) / 10,
                  y: Math.round(r.top * 10) / 10,
                  w: Math.round(r.width * 10) / 10,
                  h: Math.round(r.height * 10) / 10,
                  op: Math.round(parseFloat(cs.opacity || "1") * 100) / 100,
                  r: node.getAttribute("data-anim-role") ?? "born",
                  t: node.textContent ?? "",
                });
              });
              rec.frames.push(frame);
              if (t >= CURTAIN) {
                captureStepsRef.current.push(rec);
                return;
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }

          const later = (fn: () => void, ms: number) =>
            setTimeout(() => {
              if (overlayRef.current === overlay) fn();
            }, ms);

          if (!reduced) {
            // Tree fixation cue: the acted-on unit pulses (orange + a gentle
            // scale) while the rest holds still, THEN the reflow begins at
            // T_REFLOW (= EMPH_MS, since there is no travel). The anticipation
            // beat flat moves get, so a tree step no longer just reflows cold.
            // Colour, not a transform: the clone's transform is owned by its
            // reflow/death animation, so a composite scale doesn't reliably
            // show. An orange flash (the actor cue's primary signal) is
            // conflict-free and reads clearly. makeClone gives it a .25s
            // colour transition, so setting then reverting fades in and out.
            if (hasEmphasis) {
              for (const c of emphClones) {
                const orig = c.g.color;
                c.node.style.transition = "color .12s ease-out";
                c.node.style.color = EMPH;
                later(() => {
                  c.node.style.transition = "color .18s ease-in";
                  c.node.style.color = orig;
                }, EMPH_MS + 90);
              }
            }
            // the intermediate landing offset for consumed movers: AFTER the
            // sink's current right edge (a term joining the side), or BELOW
            // it when a fraction is forming (the divisor dives under)
            let landDX = 0;
            let landDY = 0;
            let numeratorLift = 0;
            let barY = 0;
            // the denominator renders smaller than line-level glyphs
            const DEN_SCALE = 0.85;
            if (divisionForm && sinkUnion && actorUnion) {
              // §10: the fraction centers on the MATH AXIS — the bar aligns
              // with the ='s crossbar (the sink's vertical center), numerator
              // above it, denominator below. Never a fraction dangling under
              // the baseline.
              const axisY = rcenter(sinkUnion).y;
              numeratorLift = Math.max(0, sinkUnion.bottom - (axisY - 6));
              barY = axisY + 2;
              landDX = rcenter(sinkUnion).x - rcenter(actorUnion).x;
              landDY = barY + 10 + (actorUnion.height * DEN_SCALE) / 2 - rcenter(actorUnion).y;
            } else if (hasMerge && sinkUnion && actorUnion) {
              const gap = Math.min(18, Math.max(8, sinkUnion.height * 0.25));
              landDX = sinkUnion.right + gap - actorUnion.left;
              landDY = rcenter(sinkUnion).y - rcenter(actorUnion).y;
            } else if (legacySite && siteCenter && actorUnion) {
              landDX = siteCenter.x - rcenter(actorUnion).x;
              landDY = siteCenter.y - rcenter(actorUnion).y;
            }

            // mode B survivors land at an intermediate spot anchored to a
            // frozen neighbor, not the final layout (§4): shift the final
            // rect by the anchor's not-yet-happened reflow delta
            let anchorDX = 0;
            let anchorDY = 0;
            if (pairs.length > 0 && actorTravels.some((t) => t.n)) {
              const target = actorTravels.find((t) => t.n)!.n!;
              let best: { c: Clone; n: Glyph } | null = null;
              let bestD = Infinity;
              for (const p of pairs) {
                const d =
                  Math.abs(p.n.rect.left - target.rect.left) +
                  Math.abs(p.n.rect.top - target.rect.top);
                if (d < bestD) {
                  bestD = d;
                  best = p;
                }
              }
              if (best) {
                anchorDX = best.c.g.rect.left - best.n.rect.left;
                anchorDY = best.c.g.rect.top - best.n.rect.top;
              }
            }

            const flipOf = (k: string) => (k === "\u2212" ? "+" : k === "+" ? "\u2212" : null);

            // ---- phase 1+2: emphasis, then the actor travels ALONE --------
            const launch = (
              c: Clone,
              dx: number,
              dy: number,
              opts: { toFinal?: boolean; morphTo?: string | null; endScale?: number }
            ) => {
              const dist = Math.hypot(dx, dy);
              const lift = Math.min(34, Math.max(10, dist * 0.16));
              c.node.style.transformOrigin = "50% 50%";
              c.node.style.zIndex = "10";
              c.node.style.color = EMPH; // emphasis: orange + slight scale
              c.node.animate([{ transform: "scale(1)" }, { transform: "scale(1.07)" }], {
                duration: EMPH_MS,
                easing: "ease-out",
                fill: "forwards",
              });
              const travelAnim = c.node.animate(
                [
                  { transform: "translate(0,0) scale(1.07)", offset: 0 },
                  { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.05)`, offset: 0.55 },
                  { transform: `translate(${dx}px, ${dy}px) scale(${opts.endScale ?? 1})`, offset: 1 },
                ],
                // forwards, not both: a "both" fill would snap the clone to
                // this first keyframe during the emphasis delay
                { duration: TRAVEL_MS, delay: T_TRAVEL_START, easing: TRAVEL, fill: "forwards" }
              );
              // Chrome auto-removes a finished fill:forwards animation once a
              // later animation covers the same property — which would snap
              // the traveler back to its origin. Pin it.
              (travelAnim as { persist?: () => void }).persist?.();
              // the sign flips exactly as it crosses: squash — swap — spring,
              // one self-neutralizing additive animation
              if (opts.morphTo) {
                later(() => {
                  c.node.animate(
                    [
                      { transform: "scaleY(1)" },
                      { transform: "scaleY(0.08)", offset: 0.4 },
                      { transform: "scaleY(1.15)", offset: 0.75 },
                      { transform: "scaleY(1)" },
                    ],
                    { duration: 170, easing: "ease-in-out", composite: "add" }
                  );
                  later(() => {
                    c.node.textContent = opts.morphTo!;
                  }, 68); // at full squash
                }, T_TRAVEL_START + TRAVEL_MS * 0.46);
              }
              // emphasis retires at first contact: the landing (§3)
              later(() => {
                c.node.style.color = c.g.color;
              }, T_LAND);
            };

            // consumed movers: to the intermediate landing (or divide home)
            for (const { c } of consumedActors) {
              if (divideDest) {
                const to = rcenter(divideDest.rect);
                const from = center(c.g.rect);
                launch(c, to.x - from.x, to.y - from.y, { toFinal: true, morphTo: null });
              } else if (divisionForm) {
                launch(c, landDX, landDY, { morphTo: null, endScale: DEN_SCALE });
              } else if (hasMerge || legacySite) {
                launch(c, landDX, landDY, { morphTo: flipOf(c.g.key) });
              } else {
                // no destination at all: a true death, at the travel beat
                c.node.animate(
                  [
                    { transform: "scale(1)", opacity: 1 },
                    { transform: "scale(0.7)", opacity: 0 },
                  ],
                  { duration: 200, delay: T_TRAVEL_START + 60, easing: "ease-in", fill: "both" }
                );
              }
            }
            // surviving movers: to their final rect shifted by the anchor
            for (const { c, n } of actorTravels) {
              if (!n) continue;
              const dx = n.rect.left - c.g.rect.left + anchorDX;
              const dy = n.rect.top - c.g.rect.top + anchorDY;
              launch(c, dx, dy, { morphTo: null });
              // ride the reflow home with everyone else
              if (Math.abs(anchorDX) + Math.abs(anchorDY) > 0.5) {
                c.node.animate(
                  [{ transform: "translate(0,0)" }, { transform: `translate(${-anchorDX}px, ${-anchorDY}px)` }],
                  { duration: REFLOW_MS, delay: T_REFLOW, easing: SETTLE, composite: "add", fill: "both" }
                );
              }
            }
            // the mover's own morphing glyph (a sign with a changed home)
            for (const { c, n } of actorMutations) {
              const dx = n.rect.left - c.g.rect.left + anchorDX;
              const dy = n.rect.top - c.g.rect.top + anchorDY;
              launch(c, dx, dy, { morphTo: n.text });
              if (Math.abs(anchorDX) + Math.abs(anchorDY) > 0.5) {
                c.node.animate(
                  [{ transform: "translate(0,0)" }, { transform: `translate(${-anchorDX}px, ${-anchorDY}px)` }],
                  { duration: REFLOW_MS, delay: T_REFLOW, easing: SETTLE, composite: "add", fill: "both" }
                );
              }
            }

            // ---- phase 3: hold, then merge into the sink -------------------
            if (hasMerge && sinkUnion) {
              // the divisor fuses UP into the (lifted) numerator when a
              // synthesized fraction simplifies; plain merges aim at rest
              const sinkC = { x: rcenter(sinkUnion).x, y: rcenter(sinkUnion).y - numeratorLift };
              const s0 = divisionForm ? DEN_SCALE : 1; // fuse-up starts at the dive scale
              for (const { c } of consumedActors) {
                const from = center(c.g.rect);
                const mx = sinkC.x - from.x;
                const my = sinkC.y - from.y;
                c.node.animate(
                  [
                    { transform: `translate(${landDX}px, ${landDY}px) scale(${s0})`, opacity: 1 },
                    {
                      transform: `translate(${(landDX + mx) / 2}px, ${(landDY + my) / 2}px) scale(${s0 * 0.9})`,
                      opacity: 1,
                      offset: 0.55,
                    },
                    { transform: `translate(${mx}px, ${my}px) scale(0.45)`, opacity: 0 },
                  ],
                  { duration: MERGE_MS, delay: T_MERGE, easing: TRAVEL, fill: "forwards" }
                );
              }
            }
            if (legacySite) {
              for (const c of siteClones) {
                c.node.style.transformOrigin = "50% 50%";
                c.node.animate(
                  [
                    { transform: "scale(1)", opacity: 1 },
                    { transform: "scale(0.7)", opacity: 0 },
                  ],
                  { duration: 180, delay: T_MERGE + MERGE_MS * 0.4, easing: "ease-in", fill: "both" }
                );
              }
              for (const { c } of consumedActors) {
                c.node.animate([{ opacity: 1 }, { opacity: 0 }], {
                  duration: 160,
                  delay: T_MERGE + MERGE_MS * 0.5,
                  easing: "ease-in",
                  fill: "both",
                });
              }
              for (const n of bornGlyphs) {
                const born = makeClone(n, overlay);
                born.style.transformOrigin = "50% 50%";
                born.animate(
                  [
                    { transform: "scale(0.6)", opacity: 0 },
                    { transform: "scale(1.12)", opacity: 1, offset: 0.6 },
                    { transform: "scale(1)", opacity: 1 },
                  ],
                  { duration: 220, delay: T_MERGE + MERGE_MS * 0.55, easing: "ease-out", fill: "both" }
                );
              }
            }

            // resident mutations: one node, text swap + pulse at the
            // meaningful instant — the merge beat if there is one
            const T_SWAP = hasMerge ? T_MERGE + MERGE_MS * 0.6 : Math.max(0, T_LAND - 20);
            for (const { c, n } of mutations) {
              const dx = n.rect.left - c.g.rect.left;
              const dy = n.rect.top - c.g.rect.top;
              const swapAt = hasMerge && c.g.term === sinkTermId ? T_SWAP : Math.max(0, T_LAND - 20);
              later(() => {
                c.node.textContent = n.text;
                c.node.animate(
                  [{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }],
                  { duration: 180, easing: "ease-out", composite: "add" }
                );
              }, swapAt);
              c.node.animate(
                [{ transform: "translate(0,0)" }, { transform: `translate(${dx}px, ${dy}px)` }],
                earlyReflow
                  ? { duration: TRAVEL_MS * 0.62, delay: T_TRAVEL_START + TRAVEL_MS * 0.22, easing: SETTLE, fill: "both" }
                  : { duration: REFLOW_MS, delay: T_REFLOW, easing: REFLOW, fill: "both" }
              );
            }

            // ---- phase 4: reflow — followers (the = included) glide --------
            for (const { c, n } of pairs) {
              const dx = n.rect.left - c.g.rect.left;
              const dy = n.rect.top - c.g.rect.top;
              const sx = c.g.rect.width > 0 ? n.rect.width / c.g.rect.width : 1;
              const sy = c.g.rect.height > 0 ? n.rect.height / c.g.rect.height : 1;
              if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.02) continue;
              c.node.animate(
                [
                  { transform: "translate(0,0) scale(1,1)" },
                  { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                ],
                earlyReflow
                  ? { duration: TRAVEL_MS * 0.62, delay: T_TRAVEL_START + TRAVEL_MS * 0.22, easing: SETTLE, fill: "both" }
                  : { duration: REFLOW_MS, delay: T_REFLOW, easing: REFLOW, fill: "both" }
              );
            }
            // division formation — created AFTER the reflow glides so the
            // additive lift/drop sit HIGHER in composite order (a replace-mode
            // glide created later would wipe an additive lift from t=0)
            if (divisionForm && sinkUnion && actorUnion) {
              const sinkCloneList = clones.filter((c) => c.g.term === sinkTermId);
              for (const c of sinkCloneList) {
                const lift = c.node.animate(
                  [{ transform: "translate(0,0)" }, { transform: `translate(0, ${-numeratorLift}px)` }],
                  {
                    duration: TRAVEL_MS * 0.5,
                    delay: T_TRAVEL_START + TRAVEL_MS * 0.28,
                    easing: SETTLE,
                    composite: "add",
                    fill: "forwards",
                  }
                );
                (lift as { persist?: () => void }).persist?.();
                // ...and drops back to the line as the result simplifies
                const drop = c.node.animate(
                  [{ transform: "translate(0,0)" }, { transform: `translate(0, ${numeratorLift}px)` }],
                  {
                    duration: MERGE_MS * 0.4,
                    delay: T_MERGE + MERGE_MS * 0.6,
                    easing: SETTLE,
                    composite: "add",
                    fill: "forwards",
                  }
                );
                (drop as { persist?: () => void }).persist?.();
              }
              const barW = Math.max(sinkUnion.width, actorUnion.width * DEN_SCALE) + 10;
              const barLeft = rcenter(sinkUnion).x - barW / 2;
              const bar = document.createElement("div");
              // tagged so the dev capture + phase harness see the synthesized
              // fraction bar too (it is a real animating element, not a clone)
              bar.setAttribute("data-anim", "bar");
              bar.setAttribute("data-anim-key", "—fraction-bar—");
              bar.setAttribute("data-anim-role", "born");
              bar.style.cssText =
                `position:fixed;left:${barLeft}px;top:${barY}px;width:${barW}px;height:3px;` +
                `margin:0;padding:0;background:${clones.find((c) => c.g.term === sinkTermId)?.g.color ?? "currentColor"};` +
                `border-radius:2px;transform-origin:50% 50%;will-change:transform,opacity;`;
              overlay.appendChild(bar);
              bar.animate(
                [
                  { transform: "scaleX(0)", opacity: 0 },
                  { transform: "scaleX(1)", opacity: 1 },
                ],
                {
                  duration: TRAVEL_MS * 0.5,
                  delay: T_TRAVEL_START + TRAVEL_MS * 0.28,
                  easing: "ease-out",
                  fill: "both",
                }
              );
              // the bar dissolves at the simplify beat — its fraction is gone
              bar.animate(
                [
                  { transform: "scaleX(1)", opacity: 1 },
                  { transform: "scaleX(0.2)", opacity: 0 },
                ],
                { duration: MERGE_MS * 0.5, delay: T_MERGE + MERGE_MS * 0.5, easing: "ease-out", fill: "forwards" }
              );
            }

            for (const c of deaths) {
              c.node.style.transformOrigin = "50% 50%";
              c.node.animate(
                [
                  { transform: "scale(1)", opacity: 1 },
                  { transform: "scale(0.8)", opacity: 0 },
                ],
                { duration: 180, delay: hasActor ? T_TRAVEL_START + 60 : 40, easing: "ease-in", fill: "both" }
              );
            }
            for (const n of births) {
              const b = makeClone(n, overlay);
              b.style.transformOrigin = "50% 50%";
              b.animate(
                [
                  { transform: "scale(0.7)", opacity: 0 },
                  { transform: "scale(1)", opacity: 1 },
                ],
                {
                  duration: 200,
                  // a forming structure (a fraction bar) rises mid-flight (§8);
                  // ordinary births wait for the reflow
                  delay: earlyReflow ? T_TRAVEL_START + TRAVEL_MS * 0.4 : T_REFLOW + 40,
                  easing: "ease-out",
                  fill: "both",
                }
              );
            }
          }

          // hand the stage back: reveal the real equation, then drop the overlay
          later(() => {
            if (equationRef.current) equationRef.current.style.opacity = "";
            requestAnimationFrame(() => {
              if (overlayRef.current === overlay) {
                overlay.remove();
                overlayRef.current = null;
              }
            });
          }, CURTAIN);
        })
      );
    };
  };

  const startPlayback = () => {
    if (playingRef.current) return;
    captureStepsRef.current = [];
    setHistory((h) => {
      if (h.length < 2) return h;
      playingRef.current = true;
      setPlaying(true);
      let i = 0;
      const showStep = () => {
        const step = h[i];
        if (i === 0) {
          setTreeEq(cloneTreeEq(step.tree));
          setPlayIndex(0);
          i++;
          playTimer.current = setTimeout(showStep, 450);
          return;
        }
        const finalTree = cloneTreeEq(step.tree);
        const stages = treeAnimationStages(finalTree, step.intermediateTree, step.story);
        let stageIndex = 0;
        const showStage = () => {
          const stage = stages[stageIndex];
          if (capturingRef.current) {
            const from =
              stageIndex === 0
                ? h[i - 1].text
                : printTreeEq(stages[stageIndex - 1].tree);
            captureLabelRef.current = {
              label: `${step.label} — ${stage.kind}`,
              from,
              to: printTreeEq(stage.tree),
            };
          }
          // Snapshot the current paper state, switch the real DOM, then let
          // the overlay carry it into the next state. A simplification stage
          // starts only after the literal moved form has been readable.
          const retarget = beginGlyphTransition(stage.story);
          setTreeEq(cloneTreeEq(stage.tree));
          setPlayIndex(i);
          retarget();

          const stageMs = stage.kind === "simplify" ? 760 : 1780;
          if (stageIndex < stages.length - 1) {
            stageIndex++;
            playTimer.current = setTimeout(showStage, stageMs);
          } else if (i >= h.length - 1) {
            playTimer.current = setTimeout(stopPlayback, stageMs + 300);
          } else {
            i++;
            playTimer.current = setTimeout(showStep, stageMs + 300);
          }
        };
        showStage();
      };
      showStep();
      return h;
    });
  };

  // --- Share: the whole derivation in a link ----
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const buildCurrentDocument = (): EquationDocument =>
    makeEquationDocument(treeEq, {
      documentId,
      symbols: symbolRecords,
      assumptions: predicatesForSteps(history),
      history: history.map((step) => step.event).filter((event): event is EquationEvent => !!event),
      presentation: {
        functionView: fnView,
        integrationBounds: [bounds.lo, bounds.hi],
        probeValue,
        planeProbe: [planeProbe.x, planeProbe.y],
        viewSpec: viewSpec ?? undefined,
        lastDifferentiationContext: differentiationContext,
        lastIntegrationContext: integrationContext,
      },
    });
  const currentShareUrl = () => {
    const document = buildCurrentDocument();
    return shareUrl({
      schemaVersion: 3,
      document: {
        documentId: document.documentId,
        revision: document.revision,
        symbols: document.symbols,
        assumptions: document.assumptions,
        presentation: document.presentation,
      },
      steps: history.map((s) => ({
        label: s.label,
        note: s.note,
        dangerous: s.dangerous,
        pill: s.pill,
        tree: s.tree,
        intermediateTree: s.intermediateTree,
        story: s.story,
        event: s.event,
      })),
    });
  };
  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const copyShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      let url: string;
      if (remoteSessionKey) {
        url = liveShareUrl(remoteSessionKey);
      } else if (equationSessionServiceUrl()) {
        const created = await EquationRemoteSessionClient.create(buildCurrentDocument());
        setRemoteSessionKey(created.sessionKey);
        remoteSequenceRef.current = created.sequence;
        remoteDocumentJsonRef.current = JSON.stringify(created.document);
        url = liveShareUrl(created.sessionKey);
        window.history.replaceState(window.history.state, "", url);
      } else {
        url = currentShareUrl();
      }
      await navigator.clipboard?.writeText(url);
      markCopied();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The live share could not be created.");
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    } finally {
      setSharing(false);
    }
  };

  // Restore a shared derivation from the URL, once, on mount
  useEffect(() => {
    const shared = sharedFromUrl();
    if (!shared) return;
    const steps: Step[] = shared.steps.map((s) => {
      // decodeHistory already converted any legacy flat snapshot — every
      // decoded step carries canonical tree state.
      const tree = cloneTreeEq(s.tree);
      return {
        id: stepCounter++,
        label: s.label,
        note: s.note,
        dangerous: s.dangerous,
        pill: s.pill,
        story: s.story,
        event: s.event,
        tree,
        intermediateTree: s.intermediateTree ? cloneTreeEq(s.intermediateTree) : undefined,
        text: printTreeEq(tree),
      };
    });
    const last = steps[steps.length - 1];
    if (shared.document && steps[0]) {
      steps[0].assumptions = shared.document.assumptions.map((predicate) => ({ ...predicate }));
    }
    setHistory(steps);
    setTreeEq(cloneTreeEq(last.tree));
    if (shared.document) {
      setDocumentId(shared.document.documentId);
      setSymbolRecords(reconcileSymbols(last.tree, shared.document.symbols));
      const presentation = shared.document.presentation;
      if (presentation?.functionView) setFnView(presentation.functionView);
      if (presentation?.integrationBounds) {
        setBounds({ lo: presentation.integrationBounds[0], hi: presentation.integrationBounds[1] });
      }
      if (typeof presentation?.probeValue === "number") setProbeValue(presentation.probeValue);
      if (presentation?.planeProbe) {
        setPlaneProbe({ x: presentation.planeProbe[0], y: presentation.planeProbe[1] });
      }
      if (presentation?.viewSpec) setViewSpec(presentation.viewSpec);
      if (presentation?.lastDifferentiationContext) {
        setDifferentiationContext(presentation.lastDifferentiationContext);
      }
      if (presentation?.lastIntegrationContext) {
        setIntegrationContext(presentation.lastIntegrationContext);
      }
    } else {
      setSymbolRecords(symbolsInEquation(last.tree!));
    }
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

  // The "dangerous switches": standing assumptions introduced by past steps
  const assumptions = useMemo(
    () => Array.from(new Set(history.flatMap((step) => [
      step.pill,
      ...(step.assumptions?.map((predicate) => predicate.expression) ?? []),
      ...(step.event?.assumptionsAdded.map((predicate) => predicate.expression) ?? []),
    ]).filter((predicate): predicate is string => !!predicate))),
    [history]
  );
  useEffect(() => {
    const predicates = assumptions.map((assumption) => predicateFromText(assumption));
    setSymbolRecords((records) => {
      let changed = false;
      const next = records.map((record) => {
        // human-declared facts persist; operation pills re-sync around them
        const declared = record.assumptions.filter((assumption) => assumption.source === "human");
        const relevant = predicates.filter((predicate) =>
          !declared.some((existing) => existing.id === predicate.id) &&
          new RegExp(`(^|[^A-Za-z0-9_])${record.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`).test(predicate.expression)
        );
        const merged = [...declared, ...relevant];
        const same = merged.length === record.assumptions.length &&
          merged.every((predicate, index) => predicate.id === record.assumptions[index]?.id);
        if (same) return record;
        changed = true;
        return { ...record, assumptions: merged };
      });
      return changed ? next : records;
    });
  }, [assumptions]);
  const xNonZeroAssumed = assumptions.includes("x ≠ 0");

  /**
   * The full standing-fact context: every pill a step declared plus every
   * fact the human wrote into the symbol book. This is what licenses
   * conditional simplifications from here on (Phase C of the architecture
   * review) — assumptions are durable state, not one-shot move parameters.
   */
  const standingAssumptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...assumptions,
          ...symbolRecords.flatMap((record) =>
            record.assumptions
              .filter((assumption) => assumption.source === "human")
              .map((assumption) => assumption.expression)
          ),
        ])
      ),
    [assumptions, symbolRecords]
  );

  const flashNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2800);
  };


  // --- Tree (frontier) mode: solved detection + which pane the equation earns
  const treeSolved = useMemo(() => {
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
    if (treeSolved) return null;
    return decideStatus(treeEq.left, treeEq.right);
  }, [treeEq, treeSolved]);

  /** Calculus is available for any canonical relation with at least one symbol. */
  const calculusReady = !!relationAnalysis && relationAnalysis.symbols.length > 0;
  const calculusValidationMessage = useMemo(() => {
    if (!calculusOpen) return undefined;
    const validation = validateCalculusContext(
      treeEq,
      calculusOpen === "differentiate" ? differentiationContext : integrationContext
    );
    return validation.ok ? undefined : validation.message;
  }, [treeEq, calculusOpen, differentiationContext, integrationContext]);

  // Typed equation: live pretty-math preview and Enter-to-load. Once the
  // text IS the loaded equation the preview disappears — leaving it up keeps
  // a stale "press Enter to load" hint floating in a z-50 data-ui box that
  // swallows stage taps beneath it (tall superscripts poke into exactly that
  // area, killing their inverse-operation bubbles). Editing brings it back.
  const [loadedText, setLoadedText] = useState("");
  const inputPreview = useMemo(
    () =>
      !searchMode && inputText.trim() && inputText.trim() !== loadedText.trim()
        ? renderMathPreview(inputText)
        : null,
    [inputText, searchMode, loadedText]
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
    // Parse directly into the canonical tree. Load-only conditional
    // normalizations record their assumptions on step zero. Typed function
    // notation (y(x) = …) lands as dependency edges when records reconcile.
    if (result.dependencies) pendingDependenciesRef.current = result.dependencies;
    const norm = normalizeOnLoad(result.tree);
    setTreeEq(norm.te);
    setHistory([makeTreeStep("start", norm.te, norm.changed, norm.note, norm.pill)]);
    setDocumentId(freshDocumentId());
    setSelection(null);
    setSpecialBubble(null);
    setDismissedFactorizationHints(new Set());
    setNotice(null);
    setInputMsg(null);
  };

  const selectCatalogEntry = (entry: CatalogEntry) => {
    const result = parseEquation(entry.text);
    if (!result.ok) return; // catalog rows are pre-vetted — this can't happen
    applyParse(result);
    setInputText("");
    setLoadedText("");
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
      setLoadedText(inputText);
      searchInputRef.current?.blur(); // loaded — hand focus back to the playground
    } else {
      setInputMsg({ kind: result.stage === "parse" ? "err" : "warn", text: result.message });
    }
  };

  const restoreStep = (index: number) => {
    if (playingRef.current) stopPlayback();
    const step = history[index];
    setTreeEq(cloneTreeEq(step.tree));
    setHistory((h) => h.slice(0, index + 1));
    setSelection(null);
    setSpecialBubble(null);
    setDismissedFactorizationHints(new Set());
    setNotice(null);
  };

  type PointerTapIntent = { kind: "special"; action: SpecialActionRef; ownerId: string; x: number; y: number };

  const tapPointFor = (el: HTMLElement): { x: number; y: number } => {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(112, Math.min(window.innerWidth - 112, rect.left + rect.width / 2)),
      y: Math.max(72, rect.top - 8),
    };
  };

  const specialActionFromElement = (el: HTMLElement): SpecialActionRef | null => {
    const kind = el.dataset.specialAction as SpecialActionKind | undefined;
    const nodeId = el.dataset.specialNode;
    const side = el.dataset.side as Side | undefined;
    if (!kind || !nodeId || (side !== "left" && side !== "right")) return null;
    const rawN = el.dataset.specialN;
    const n = rawN === undefined || rawN === "" ? undefined : Number(rawN);
    return {
      kind,
      nodeId,
      side,
      n: n !== undefined && Number.isFinite(n) ? n : undefined,
      targetId: el.dataset.specialTarget || undefined,
      exprText: el.dataset.specialExpr || undefined,
    };
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
    if (!targetEl.closest("[data-context-bubble]")) {
      setSpecialBubble(null);
    }
    // word search is modal to its own bar: any press elsewhere exits it
    if (!targetEl.closest("[data-search]")) setSearchMode(false);
    // Toolbox items drag via the pointer engine (click still applies them)
    const toolButton = targetEl.closest("[data-tool]") as HTMLElement | null;
    if (toolButton?.dataset.tool) {
      e.preventDefault();
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
    // Safari decides whether a finger owns a browser pan at pointer-down time.
    // The playfield's touch-action CSS is the primary contract; preventing the
    // default here is a second guard for older iOS versions and embedded views.
    if (e.pointerType === "touch") e.preventDefault();
    const specialEl = targetEl.closest<HTMLElement>("[data-special-action]");
    const specialAction = specialEl ? specialActionFromElement(specialEl) : null;
    // Proximity grab: the nearest symbol within reach picks up, even if the
    // press wasn't pixel-perfect on the glyph. A tap-only special anchor never
    // competes for drag ownership; its nearest enclosing algebra unit does.
    const symbol =
      specialEl?.closest<HTMLElement>("[data-symbol]") ??
      nearestSymbol(e.clientX, e.clientY, e.pointerType);
    const ownerId = symbol?.dataset.termId;
    const tapIntent: PointerTapIntent | null = specialAction && specialEl && ownerId
      ? { kind: "special", action: specialAction, ownerId, ...tapPointFor(specialEl) }
      : null;
    if (symbol) {
      e.preventDefault();
      beginDrag(payloadFromSymbol(symbol), e, symbol, tapIntent);
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    const pointerId = e.pointerId;
    const captureEl = e.currentTarget as HTMLElement;
    capturePointer(captureEl, pointerId);
    setSelection(null);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      setMarquee({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      releasePointer(captureEl, pointerId);
      setMarquee(null);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) cleanup();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();

      const rect = {
        left: Math.min(x0, ev.clientX),
        right: Math.max(x0, ev.clientX),
        top: Math.min(y0, ev.clientY),
        bottom: Math.max(y0, ev.clientY),
      };
      if (rect.right - rect.left < 8 && rect.bottom - rect.top < 8) return;

      const additiveHits: Record<Side, Set<string>> = { left: new Set(), right: new Set() };
      const factorHits: Record<Side, Set<string>> = { left: new Set(), right: new Set() };
      const spans = equationRef.current?.querySelectorAll<HTMLElement>("[data-symbol]") ?? [];
      spans.forEach((span) => {
        const b = span.getBoundingClientRect();
        const overlaps = b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top;
        if (!overlaps) return;
        const side = span.dataset.side as Side;
        const termId = span.dataset.termId;
        if (!side || !termId) return;
        if (isAtomicTreeFactorId(termId)) {
          factorHits[side].add(termId);
        } else {
          additiveHits[side].add(ownerOfTreeHandleId(termId));
        }
      });

      // Exact factor hits outrank the overlapping whole-term punctuation.
      // If they form one numerator or denominator chunk, preserve those ids;
      // otherwise fall back to the original additive block selection.
      const hasFactorHits = factorHits.left.size > 0 || factorHits.right.size > 0;
      const side: Side = hasFactorHits
        ? (factorHits.left.size >= factorHits.right.size ? "left" : "right")
        : (additiveHits.left.size >= additiveHits.right.size ? "left" : "right");
      const selected = treeEq
        ? treeMarqueeSelection(treeEq, Array.from(factorHits[side]), Array.from(additiveHits[side]))
        : Array.from(additiveHits[side]);
      if (selected.length === 0) return;
      setSelection({ side, termIds: selected });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // --- Drag & drop ---
  // Tracked in a ref (dataTransfer is unreadable during dragover) so any drop
  // location can route to the opposite side and the target ring is accurate
  const dragPayloadRef = useRef<DragPayload | null>(null);

  /** Build a drag payload from a symbol's data attributes (pointer engine) */
  const payloadFromSymbol = (el: HTMLElement): DragPayload => {
    const termId = el.dataset.termId ?? "";
    const side = (el.dataset.side ?? "left") as Side;
    const role = (el.dataset.role ?? "term") as Role;
    // A selected multiplicative chunk keeps its exact factor ids. Additive
    // selections still acquire from any symbol inside their owning addend.
    const selectedFactor = treeEq
      ? (el.closest<HTMLElement>("[data-factor-handle]")?.dataset.factorHandle ?? null)
      : null;
    const ownerId = ownerOfTreeHandleId(termId);
    if (selection && selection.side === side) {
      if (
        selectedFactor &&
        selection.termIds.includes(selectedFactor) &&
        selection.termIds.every(isAtomicTreeFactorId)
      ) {
        if (selection.termIds.length > 1) return { kind: "factorGroup", ids: selection.termIds, from: side };
        const selected = resolveTreeFactor(treeEq, selectedFactor);
        if (selected) {
          return {
            kind: selected.zone === "d" ? "den" : varsIn(selected.expr).size === 0 ? "coef" : "numer",
            termId: selectedFactor,
            from: side,
          };
        }
      }
      if (selection.termIds.includes(ownerId)) {
        return { kind: "terms", ids: selection.termIds, from: side };
      }
    }
    switch (role) {
      case "coef":
        return { kind: "coef", termId, from: side };
      case "den":
        return { kind: "den", termId, from: side };
      case "xdiv":
        return { kind: "xdiv", termId, from: side };
      case "numer":
        return { kind: "numer", termId, from: side };
      case "lnbase":
        return { kind: "lnbase", termId, from: side };
      case "root":
        return { kind: "root", termId, n: Number(el.dataset.rootN ?? 0), from: side };
      case "raise":
        return { kind: "raise", termId, n: Number(el.dataset.raiseN ?? 0), from: side };
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
    setActiveDropTarget(null);
    setDragActive(false);
    setUnderHover(null);
    setExpHover(null);
    setTermHover(null);
    underHoverRef.current = null;
    termHoverRef.current = null;
  };

  // --- Canonical tree operations (pure dispatcher lives in operations.ts) --

  const treeAddend = (id: string): TNode | null =>
    treeAddendExpression(treeEq, id);

  const coefExprOf = (id: string): TNode | null =>
    treeCoefficientExpression(treeEq, id);

  /** Resolve through the same factor layout used by TreeSideView. */
  const treeFactorOf = (id: string): { expr: TNode; zone: "n" | "d" } | null => {
    return resolveTreeFactor(treeEq, id);
  };

  const computeTreeDrop = (payload: DragPayload, target: DropTarget): TreeMoveResult =>
    computeTreeOperation(treeEq, payload, target);

  const withTreeStory = (o: TreeOutcome, payload: DragPayload, target: DropTarget): TreeOutcome =>
    o.story ? o : { ...o, story: treeMoveStory(treeEq, payload, target) };

  const commitTreeOutcome = (o: TreeOutcome, event?: EquationEvent) => {
    setTreeEq(o.treeNext);
    setHistory((h) => [
      ...h,
      makeTreeStep(o.label, o.treeNext, o.dangerous, o.note, o.pill, o.story, o.treeIntermediate, event),
    ]);
    setSelection(null);
    setSpecialBubble(null);
    setNotice(null);
  };

  /** One semantic command path for pointer gestures, bubbles, rewrites, and AI adapters. */
  const runEquationCommand = (command: EquationCommand) => {
    return applyEquationCommand(treeEq, {
      requestId: `human_${Date.now().toString(36)}_${(commandCounter++).toString(36)}`,
      expectedRevision: equationRevision(treeEq),
      actor: { kind: "human" },
      command,
      standingAssumptions,
    });
  };

  const documentSnapshot = useMemo<EquationDocument>(() =>
    makeEquationDocument(treeEq, {
      documentId,
      symbols: symbolRecords,
      assumptions: predicatesForSteps(history),
      history: history.map((step) => step.event).filter((event): event is EquationEvent => !!event),
      presentation: {
        functionView: fnView,
        integrationBounds: [bounds.lo, bounds.hi],
        probeValue,
        planeProbe: [planeProbe.x, planeProbe.y],
        viewSpec: viewSpec ?? undefined,
        lastDifferentiationContext: differentiationContext,
        lastIntegrationContext: integrationContext,
      },
    }), [
      treeEq,
      documentId,
      symbolRecords,
      history,
      fnView,
      bounds.lo,
      bounds.hi,
      probeValue,
      planeProbe.x,
      planeProbe.y,
      viewSpec,
      differentiationContext,
      integrationContext,
    ]);

  useEffect(() => {
    const equationAtRevision = treeEq;
    const protocolService = protocolServiceRef.current!;
    protocolService.loadDocument(documentSnapshot);
    const protocol: EquationProtocolApi = {
      version: EQUATION_PROTOCOL_VERSION,
      getDocument: () => protocolService.getDocument(documentId) ?? documentSnapshot,
      analyze: () => {
        const analysis = protocolService.analyze(documentId);
        if (!("status" in analysis)) return analysis;
        return {
          relation: analyzeRelation(equationAtRevision),
          symbols: documentSnapshot.symbols.map(({ id, name, meaning, unit }) => ({
            id,
            name,
            meaning,
            unit,
          })),
        };
      },
      listActions: () => {
        const actions = protocolService.listActions(documentId);
        return Array.isArray(actions) ? actions : [];
      },
      previewAction: (request) => protocolService.previewAction(request),
      applyPreview: (request) => {
        const result = protocolService.applyPreview(request);
        if (result.status === "applied") {
          const event = result.event;
          const pill = event.assumptionsAdded[0]?.expression;
          commitTreeOutcome({
            treeNext: cloneTreeEq(event.after),
            treeIntermediate: event.intermediate ? cloneTreeEq(event.intermediate) : undefined,
            label: event.explanation,
            note: event.explanation,
            dangerous: event.assumptionsAdded.length > 0,
            pill,
            story: event.animation,
          }, event);
        }
        return result;
      },
      updateSymbol: (request) => {
        const result = protocolService.updateSymbol(request);
        if (result.status === "updated") setSymbolRecords(result.document.symbols);
        return result;
      },
      setView: (request) => {
        const result = protocolService.setView(request);
        if (result.status === "updated") {
          setViewSpec(result.document.presentation?.viewSpec ?? null);
        }
        return result;
      },
    };
    const api: EquationToolApi = {
      protocol,
      getDocument: () => protocolService.getDocument(documentId) ?? documentSnapshot,
      analyzeRelation: () => analyzeRelation(equationAtRevision),
      setViewSpec: (spec: ViewSpec | null) => {
        const analysis = analyzeRelation(equationAtRevision);
        if (spec && !isViewSpecValid(spec, analysis)) return false;
        setViewSpec(spec);
        return true;
      },
      inspectNodes: () => inspectEquationNodes(equationAtRevision),
      listApplicableOperations: () => listApplicableEquationOperations(equationAtRevision),
      previewCommand: (request: Parameters<typeof applyEquationCommand>[1]) =>
        applyEquationCommand(equationAtRevision, { standingAssumptions, ...request }),
      applyCommand: (request: Parameters<typeof applyEquationCommand>[1]) => {
        const result = applyEquationCommand(equationAtRevision, { standingAssumptions, ...request });
        if (result.status === "applied") {
          const outcome =
            request.command.type === "gesture"
              ? withTreeStory(result.outcome, request.command.payload, request.command.target)
              : result.outcome;
          commitTreeOutcome(outcome, { ...result.event, animation: outcome.story });
        }
        return result;
      },
      updateSymbol: (symbolId: string, patch: Partial<Omit<SymbolRecord, "id">>) => {
        if (!symbolRecords.some((record) => record.id === symbolId)) return false;
        setSymbolRecords((records) => records.map((record) =>
          record.id === symbolId ? { ...record, ...patch, id: record.id } : record
        ));
        return true;
      },
    };
    window.visualMathEquation = api;
    return () => {
      if (window.visualMathEquation === api) delete window.visualMathEquation;
    };
  }, [
    treeEq,
    documentSnapshot,
    symbolRecords,
    history,
    documentId,
    fnView,
    bounds.lo,
    bounds.hi,
    probeValue,
    planeProbe.x,
    planeProbe.y,
    viewSpec,
    differentiationContext,
    integrationContext,
    standingAssumptions,
  ]);

  const applyRemotePresentation = (document: EquationDocument) => {
    setDocumentId(document.documentId);
    setSymbolRecords(reconcileSymbols(document.equation, document.symbols));
    const presentation = document.presentation;
    setFnView(presentation?.functionView ?? "slope");
    if (presentation?.integrationBounds) {
      setBounds({ lo: presentation.integrationBounds[0], hi: presentation.integrationBounds[1] });
    }
    if (typeof presentation?.probeValue === "number") setProbeValue(presentation.probeValue);
    if (presentation?.planeProbe) {
      setPlaneProbe({ x: presentation.planeProbe[0], y: presentation.planeProbe[1] });
    }
    setViewSpec(presentation?.viewSpec ?? unambiguousView(analyzeRelation(document.equation)));
    setDifferentiationContext(
      presentation?.lastDifferentiationContext ?? emptyDifferentiationContext()
    );
    setIntegrationContext(presentation?.lastIntegrationContext ?? emptyIntegrationContext());
  };

  const replaceFromRemoteDocument = (document: EquationDocument) => {
    const events = document.history;
    const startStep = makeTreeStep("start", events[0]?.before ?? document.equation);
    startStep.assumptions = document.assumptions.map((predicate) => ({ ...predicate }));
    const steps: Step[] = events.length === 0
      ? [startStep]
      : [
          startStep,
          ...events.map((event) => makeTreeStep(
            event.explanation,
            event.after,
            event.assumptionsAdded.length > 0,
            event.explanation,
            event.assumptionsAdded[0]?.expression,
            event.animation,
            event.intermediate,
            event
          )),
        ];
    setTreeEq(cloneTreeEq(document.equation));
    setHistory(steps);
    setSelection(null);
    setSpecialBubble(null);
    applyRemotePresentation(document);
  };

  remoteSnapshotHandlerRef.current = (snapshot) => {
    if (snapshot.sessionKey !== remoteSessionKey || snapshot.sequence <= remoteSequenceRef.current) return;
    const incomingJson = JSON.stringify(snapshot.document);
    remoteSequenceRef.current = snapshot.sequence;
    remoteDocumentJsonRef.current = incomingJson;

    // Browser echoes advance the durable cursor without replaying local work.
    if (JSON.stringify(documentSnapshot) === incomingJson) return;

    const event = snapshot.change.event;
    const canAnimate = !!event &&
      snapshot.change.kind === "applied" &&
      documentId === snapshot.document.documentId &&
      equationRevision(treeEq) === event.beforeRevision;
    if (canAnimate && event) {
      applyRemotePresentation(snapshot.document);
      commitTreeOutcome({
        treeNext: cloneTreeEq(event.after),
        treeIntermediate: event.intermediate ? cloneTreeEq(event.intermediate) : undefined,
        label: event.explanation,
        note: event.explanation,
        dangerous: event.assumptionsAdded.length > 0,
        pill: event.assumptionsAdded[0]?.expression,
        story: event.animation,
      }, event);
      return;
    }
    replaceFromRemoteDocument(snapshot.document);
  };

  useEffect(() => {
    const serviceUrl = equationSessionServiceUrl();
    if (!remoteSessionKey || !serviceUrl) {
      remoteClientRef.current = null;
      setRemoteConnection(serviceUrl ? "offline" : "disabled");
      return;
    }
    const client = new EquationRemoteSessionClient(serviceUrl, remoteSessionKey);
    remoteClientRef.current = client;
    let active = true;
    client.snapshot().then((snapshot) => {
      if (!active) return;
      if ("status" in snapshot) {
        setRemoteConnection("offline");
        setNotice(snapshot.message);
        return;
      }
      remoteSnapshotHandlerRef.current(snapshot);
    }).catch(() => {
      if (active) setRemoteConnection("offline");
    });
    const disconnect = client.connect(
      (snapshot) => remoteSnapshotHandlerRef.current(snapshot),
      (state) => { if (active) setRemoteConnection(state); }
    );
    return () => {
      active = false;
      disconnect();
      if (remoteClientRef.current === client) remoteClientRef.current = null;
    };
  }, [remoteSessionKey]);

  useEffect(() => {
    if (!remoteSessionKey || remoteSequenceRef.current < 0) return;
    const client = remoteClientRef.current;
    if (!client) return;
    const documentJson = JSON.stringify(documentSnapshot);
    if (documentJson === remoteDocumentJsonRef.current) return;
    if (remoteSyncTimerRef.current) clearTimeout(remoteSyncTimerRef.current);
    remoteSyncTimerRef.current = setTimeout(() => {
      const expectedSequence = remoteSequenceRef.current;
      client.synchronize({
        expectedSequence,
        requestId: `browser_${Date.now().toString(36)}_${(commandCounter++).toString(36)}`,
        document: documentSnapshot,
        actor: { kind: "human" },
      }).then((result) => {
        if ("status" in result) {
          if (result.code === "stale_sequence") {
            client.snapshot().then((latest) => {
              if (!("status" in latest)) remoteSnapshotHandlerRef.current(latest);
            }).catch(() => setRemoteConnection("offline"));
          } else {
            setNotice(result.message);
          }
          return;
        }
        remoteSnapshotHandlerRef.current(result);
      }).catch(() => setRemoteConnection("offline"));
    }, 180);
    return () => {
      if (remoteSyncTimerRef.current) clearTimeout(remoteSyncTimerRef.current);
      remoteSyncTimerRef.current = null;
    };
  }, [documentSnapshot, remoteSessionKey]);

  const applyCalculusWith = (
    operation: "differentiate" | "integrate",
    context: DifferentiationContext | IntegrationContext,
    announce = false
  ) => {
    const validation = validateCalculusContext(treeEq, context);
    if (!validation.ok) {
      flashNotice(validation.message ?? "Complete the calculus context first.");
      return;
    }
    const result = runEquationCommand(
      operation === "differentiate"
        ? { type: "differentiate", context: context as DifferentiationContext }
        : { type: "integrate", context: context as IntegrationContext }
    );
    if (!result) return;
    if (result.status !== "applied") {
      flashNotice(result.status === "rejected" ? result.reason : "The equation changed — choose the context again.");
      return;
    }
    // Queue symbol-book provenance for derivative-born symbols (y′, z_x)
    // before the commit lands, so reconciliation can attach the meanings.
    if (operation === "differentiate") {
      const dContext = context as DifferentiationContext;
      const style = dContext.notation ?? "leibniz";
      if (style !== "leibniz") {
        const mark = dContext.mode === "partial" ? "∂" : "d";
        for (const dependent of dContext.dependent) {
          pendingSymbolMeaningsRef.current.set(
            derivedSymbolName(dependent, dContext.withRespectTo, style),
            `${mark}${dependent}/${mark}${dContext.withRespectTo} — derivative of ${dependent} with respect to ${dContext.withRespectTo}`
          );
        }
      }
    }
    commitTreeOutcome(result.outcome, result.event);
    if (announce) {
      const receipt = operation === "differentiate"
        ? `Differentiated with respect to ${context.withRespectTo} — ${context.dependent.join(", ") || "identity"} treated as dependent. ⚙ changes the context.`
        : `Integrated with respect to ${context.withRespectTo}. ⚙ changes the context.`;
      flashNotice(receipt);
    }
    setViewSpec(null);
    setCalculusOpen(null);
    setToolboxOpen(false);
  };

  const applyContextualCalculus = (operation: "differentiate" | "integrate") =>
    applyCalculusWith(operation, operation === "differentiate" ? differentiationContext : integrationContext);

  /** Open the context panel, seeded with the best-ranked reading if the
   *  current context would not validate as-is. */
  const openCalculusPanel = (operation: "differentiate" | "integrate") => {
    const inferred = calculusReadiness?.state === "deterministic"
      ? calculusReadiness.context
      : calculusReadiness?.state === "needs-context"
        ? calculusReadiness.suggestion
        : null;
    if (operation === "differentiate") {
      setDifferentiationContext((current) =>
        validateCalculusContext(treeEq, current).ok
          ? current
          : inferred
            ? { ...inferred, dependent: [...inferred.dependent], heldConstant: [...inferred.heldConstant] }
            : current
      );
    } else {
      setIntegrationContext((current) =>
        validateCalculusContext(treeEq, current).ok
          ? current
          : inferred
            ? integrationDefaultsFrom(inferred)
            : current
      );
    }
    setCalculusOpen(operation);
  };

  /**
   * The d⁄dx and ∫ buttons route by readiness state (docs/design/calculus-ux.md):
   * a still-valid previous context or a deterministic reading applies in ONE
   * tap with a receipt; ambiguity opens the panel seeded with the best
   * suggestion; a solution-set equation gets the teachable refusal first.
   * Sticky identity confirmations never auto-reapply — that stays deliberate.
   */
  const quickCalculus = (operation: "differentiate" | "integrate") => {
    if (!calculusReadiness) return;
    const current = operation === "differentiate" ? differentiationContext : integrationContext;
    if (current.dependent.length > 0 && validateCalculusContext(treeEq, current).ok) {
      applyCalculusWith(operation, current, true);
      return;
    }
    if (calculusReadiness.state === "deterministic") {
      const context = operation === "differentiate"
        ? calculusReadiness.context
        : integrationDefaultsFrom(calculusReadiness.context);
      if (operation === "differentiate") setDifferentiationContext(context as DifferentiationContext);
      else setIntegrationContext(context as IntegrationContext);
      applyCalculusWith(operation, context, true);
      return;
    }
    if (calculusReadiness.state === "solution-set") flashNotice(calculusReadiness.explanation);
    openCalculusPanel(operation);
  };

  const runSpecialAction = (action: SpecialActionRef, ownerId: string) => {
    const result = runEquationCommand({ type: "special-action", action });
    setSpecialBubble(null);
    if (!result) return;
    if (result.status !== "applied") {
      const reason = result.status === "rejected" ? result.reason : "the equation changed — try that action again";
      flashNotice(reason.charAt(0).toUpperCase() + reason.slice(1) + ".");
      return;
    }
    const outcome = {
      ...result.outcome,
      story: result.outcome.story ?? {
        actors: [],
        site: [],
        born: [],
        kind: "simplify",
        emphasize: [ownerId],
      },
    } satisfies TreeOutcome;
    commitTreeOutcome(outcome, { ...result.event, animation: outcome.story });
  };

  const runRewrite = (side: Side, rewrite: Rewrite, ownerId: string) => {
    const result = runEquationCommand({ type: "rewrite", side, targetId: rewrite.before.id, kind: rewrite.kind });
    if (!result || result.status !== "applied") {
      if (result?.status === "rejected") flashNotice(result.reason);
      return;
    }
    const outcome = {
      ...result.outcome,
      story: {
        actors: [],
        site: [],
        born: [],
        kind: "simplify",
        emphasize: [ownerId],
      },
    } satisfies TreeOutcome;
    commitTreeOutcome(outcome, { ...result.event, animation: outcome.story });
  };

  /** Live outcome preview: what would happen if the drag were released here */
  const updatePreview = (payload: DragPayload, target: DropTarget) => {
    const key = JSON.stringify([payload, target]);
    if (previewKeyRef.current === key) return;
    previewKeyRef.current = key;
    setActiveDropTarget(target);
    if (target.kind === "bound") {
      const v = boundValueOf(payload);
      if (v === null) setDragPreview({ kind: "reject", text: "only a plain number can set a bound" });
      else setDragPreview({ kind: "ok", text: `set the ${target.which === "lo" ? "lower" : "upper"} bound to ${v}` });
      return;
    }
    const result = computeTreeDrop(payload, target);
    if (result === null) setDragPreview({ kind: "cancel", text: "" });
    else if (typeof result === "string") setDragPreview({ kind: "reject", text: result });
    else setDragPreview({ kind: "ok", text: printTreeEq(result.treeNext) });
  };

  // ---- Pointer drag engine (Notion-style: no native HTML5 DnD) ----------
  // Activation is by proximity: pressing within GRAB_RADIUS of a symbol's
  // box picks it up after a small movement slop. Targets are computed from
  // live geometry, so no invisible strip elements are needed.
  const GRAB_RADIUS = 28;
  const TOUCH_GRAB_RADIUS = 40;
  const DRAG_SLOP = 5;
  const TOUCH_DRAG_SLOP = 10;
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const pointerDragRef = useRef<{
    payload: DragPayload;
    tapIntent: PointerTapIntent | null;
    tapFactorId: string | null;
    tapSide: Side | null;
    tapAdditive: boolean;
    started: boolean;
    x0: number;
    y0: number;
    slop: number;
    pointerId: number;
    captureEl: HTMLElement;
  } | null>(null);

  const capturePointer = (el: HTMLElement, pointerId: number) => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // A browser may have cancelled the pointer before capture. Cleanup still
      // runs through pointercancel, so there is no drag state left behind.
    }
  };

  const releasePointer = (el: HTMLElement, pointerId: number) => {
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture is released automatically after pointerup/cancel.
    }
  };

  const nearestSymbol = (x: number, y: number, pointerType = "mouse"): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestDistance = pointerType === "touch" ? TOUCH_GRAB_RADIUS : GRAB_RADIUS;
    let bestArea = Infinity;
    equationRef.current?.querySelectorAll<HTMLElement>("[data-symbol]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const dx = x - Math.max(r.left, Math.min(x, r.right));
      const dy = y - Math.max(r.top, Math.min(y, r.bottom));
      const d = Math.hypot(dx, dy); // 0 when inside the box
      const area = r.width * r.height;
      // Nested units tie at distance 0 — the SMALLEST box wins. Tree product
      // factors are atomic, so the only intentional overlap is a factor inside
      // its optional whole-numerator row handle.
      if (d < bestDistance - 0.5 || (Math.abs(d - bestDistance) <= 0.5 && area < bestArea)) {
        bestDistance = d;
        bestArea = area;
        best = el;
      }
    });
    return best;
  };

  /**
   * Dev: snapshot the live GRAB MAP as a lossless JSON — every hitbox's role,
   * term-id, side, text and exact box, plus the model. The counterpart to the
   * animation trace, but for "I can't grab X" bugs: a screenshot shows what a
   * region looks like, this shows what it *does* (which symbol nearestSymbol
   * picks where). Render it with scripts/layout-to-svg.cjs.
   */
  const captureLayout = () => {
    const eq = equationRef.current;
    if (!eq) return;
    const rectOf = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const round = (n: number) => Math.round(n * 10) / 10;
      return { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) };
    };
    const symbols = Array.from(eq.querySelectorAll<HTMLElement>("[data-symbol]")).map((el) => ({
      role: el.dataset.role ?? null,
      termId: el.dataset.termId ?? null,
      side: el.dataset.side ?? null,
      text: (el.textContent ?? "").trim(),
      rect: rectOf(el),
    }));
    const wraps = Array.from(eq.querySelectorAll<HTMLElement>("[data-term-wrap]")).map((el) => ({
      termId: el.dataset.termWrap ?? null,
      side: el.dataset.side ?? null,
      rect: rectOf(el),
    }));
    const parens = Array.from(eq.querySelectorAll<HTMLElement>("[data-parens-for]")).map((el) => ({
      parensFor: el.dataset.parensFor ?? null,
      kind: el.dataset.parensKind ?? null,
      side: el.dataset.side ?? null,
      rect: rectOf(el),
    }));
    const data = {
      format: "vmt-layout-capture",
      version: 1,
      equationText: printTreeEq(treeEq),
      mode: "tree",
      model: treeEq,
      grabRadius: GRAB_RADIUS,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      equationRect: rectOf(eq),
      symbols,
      wraps,
      parens,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `layout-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    flashNotice(`grab map: ${symbols.length} handles captured`);
  };

  /** Where would a release at (x, y) land? Pure geometry over live rects. */
  const findTarget = (x: number, y: number, payload: DragPayload): DropTarget | null => {
    const eq = equationRef.current;
    if (!eq) return null;
    // pane handles (area/sum bounds, the limit's approach point): plain terms
    // can be dropped onto one to pin it exactly
    if (payload.kind === "terms") {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-bound]"))) {
        const r = el.getBoundingClientRect();
        if (x >= r.left - 16 && x <= r.right + 16 && y >= r.top - 16 && y <= r.bottom + 16) {
          return { kind: "bound", which: el.dataset.bound as "lo" | "hi" | "at" };
        }
      }
    }
    // Parenthesis zones (most specific) — only for the matching coef
    if (payload.kind === "coef") {
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
    // Unit-on-unit cancellation (tree): a numerator factor dropped onto the
    // matching denominator factor (or the reverse) cancels the pair — the
    // gesture that carries the "expr ≠ 0" pill the simplifier refuses to
    // assume silently
    if (payload.kind === "numer" || payload.kind === "den" || payload.kind === "coef") {
      const zoneOfRole = (role: string | undefined) => (role === "den" ? "d" : "n");
      const myZone = payload.kind === "den" ? "d" : "n";
      for (const el of Array.from(
        eq.querySelectorAll<HTMLElement>("[data-symbol][data-role='numer'],[data-symbol][data-role='den'],[data-symbol][data-role='coef']")
      )) {
        const id = el.dataset.termId ?? "";
        if (!isAtomicTreeFactorId(id) || id === payload.termId) continue;
        if (zoneOfRole(el.dataset.role) === myZone) continue; // cancellation crosses the bar
        const r = el.getBoundingClientRect();
        if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) {
          return { kind: "unit", unitId: id, side: el.dataset.side as Side };
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
        const xish = payload.kind === "xdiv";
        if (xish && wrap.dataset.expOk === "1" && x > r.left + r.width * 0.55 && y < r.top + r.height * 0.42) {
          return { kind: "onexp", termId, side };
        }
        if (y > r.top + r.height * 0.6) return { kind: "under", termId, side };
        return { kind: "side", side };
      }
    }
    // Side halves within a generous band around the equation. Horizontally the
    // band spans the whole row: once the pointer is at the equation's height, a
    // release ANYWHERE left/right of the "=" lands on that side. A narrow
    // equation used to leave a dead zone past ±200px where a far throw silently
    // did nothing (no move, no feedback) — the vertical band is the real gate.
    const band = eq.getBoundingClientRect();
    if (y >= band.top - 60 && y <= band.bottom + 90) {
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
    // both-sides operations (roots, powers, ln) don't need to cross the
    // equals sign — any side is a valid stage for them
    const bothSides = payload.kind === "lnbase" || payload.kind === "root" || payload.kind === "raise";
    setDragOver(
      target?.kind === "side" && payload.kind !== "tool" && (bothSides || payload.from !== target.side)
        ? target.side
        : null
    );
    if (target) {
      updatePreview(payload, target);
    } else {
      previewKeyRef.current = "off-equation";
      setActiveDropTarget(null);
      setDragPreview({ kind: "cancel", text: "" });
    }
  };

  const finishPointerDrag = () => {
    pointerDragRef.current = null;
    setGhostPos(null);
    finishDrag();
  };

  const beginDrag = (
    payload: DragPayload,
    e: ReactPointerEvent,
    sourceSymbol?: HTMLElement,
    tapIntent: PointerTapIntent | null = null
  ) => {
    const captureEl = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const tapFactorId = treeEq
      ? (sourceSymbol?.closest<HTMLElement>("[data-factor-handle]")?.dataset.factorHandle ?? null)
      : null;
    capturePointer(captureEl, pointerId);
    pointerDragRef.current = {
      payload,
      tapIntent,
      tapFactorId,
      tapSide: tapFactorId ? ((sourceSymbol?.dataset.side ?? null) as Side | null) : null,
      // Touch has no modifier key: successive taps build a coherent chunk.
      // Desktop keeps the familiar Ctrl/Cmd toggle, while a plain tap selects.
      tapAdditive: e.pointerType === "touch" || e.ctrlKey || e.metaKey,
      started: false,
      x0: e.clientX,
      y0: e.clientY,
      slop: e.pointerType === "touch" ? TOUCH_DRAG_SLOP : DRAG_SLOP,
      pointerId,
      captureEl,
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
    };
    const move = (ev: PointerEvent) => {
      const st = pointerDragRef.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      if (!st.started) {
        if (Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) < st.slop) return;
        st.started = true;
        setSpecialBubble(null);
        dragPayloadRef.current = st.payload;
        setDragActive(true);
        setHoveredTermId(null);
      }
      setGhostPos({ x: ev.clientX, y: ev.clientY });
      applyHoverTarget(st.payload, findTarget(ev.clientX, ev.clientY, st.payload));
    };
    const up = (ev: PointerEvent) => {
      const active = pointerDragRef.current;
      if (!active || ev.pointerId !== active.pointerId) return;
      cleanup();
      const st = pointerDragRef.current;
      pointerDragRef.current = null;
      if (st?.started) {
        const target = findTarget(ev.clientX, ev.clientY, st.payload);
        if (target) performDrop(st.payload, target);
      } else if (st?.tapIntent?.kind === "special") {
        setSpecialBubble({
          action: st.tapIntent.action,
          ownerId: st.tapIntent.ownerId,
          x: st.tapIntent.x,
          y: st.tapIntent.y,
        });
        setSelection(null);
      } else if (st?.tapFactorId && st.tapSide) {
        setSelection((current) =>
          toggleTreeFactorSelection(treeEq, current, st.tapSide!, st.tapFactorId!, st.tapAdditive)
        );
      }
      if (st) releasePointer(st.captureEl, st.pointerId);
      finishPointerDrag();
    };
    const cancel = (ev: PointerEvent) => {
      const st = pointerDragRef.current;
      if (!st || ev.pointerId !== st.pointerId) return;
      cleanup();
      pointerDragRef.current = null;
      releasePointer(st.captureEl, st.pointerId);
      finishPointerDrag();
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        cleanup();
        const st = pointerDragRef.current;
        pointerDragRef.current = null;
        if (st) releasePointer(st.captureEl, st.pointerId);
        finishPointerDrag();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
  };

  /** The numeric value of a dragged constant term, for setting a bound */
  const boundValueOf = (payload: DragPayload): number | null => {
    if (payload.kind !== "terms" || payload.ids.length !== 1) return null;
    const a = treeAddend(payload.ids[0]);
    if (!a || varsIn(a).size > 0) return null;
    return constValue(a);
  };

  const performDrop = (payload: DragPayload, target: DropTarget) => {
    if (target.kind === "bound") {
      const v = boundValueOf(payload);
      if (v === null) {
        flashNotice("Only a plain number can set a bound.");
      } else {
        setBounds((b) => ({ ...b, [target.which]: v }));
      }
      return;
    }
    const result = runEquationCommand({ type: "gesture", payload, target });
    if (!result) return;
    if (result.status !== "applied") {
      const reason = result.status === "rejected" ? result.reason : "the equation changed — try that move again";
      flashNotice(reason.charAt(0).toUpperCase() + reason.slice(1) + ".");
      return;
    }
    const outcome = withTreeStory(result.outcome, payload, target);
    commitTreeOutcome(outcome, { ...result.event, animation: outcome.story });
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
      if (p.kind === "factorGroup") {
        const group = resolveTreeFactorGroup(treeEq, p.ids);
        return group ? printNode(group.expr) : "?";
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
      if (p.kind === "lnbase") return "ln";
      if (p.kind === "root") return p.n === 2 ? "√" : p.n === 3 ? "∛" : `${p.n}√`;
      if (p.kind === "raise") return `( )${supText(p.n)}`;
    }
    return "?";
  };

  /** Ghost chip appended to a side while it is the drop target (term moves etc.) */
  const sideGhost = (side: Side): ReactNode => {
    const p = dragPayloadRef.current;
    if (!p || p.kind === "tool" || p.from === side) return null;
    let text: string | null = null;
    if (treeEq) {
      // tree units read their ghost from the tree, not the flat terms
      if (p.kind === "terms") {
        const a = treeAddend(p.ids[0]);
        if (a) text = printNode(simplifyTree(tmul(tc(-1), a)));
      } else if (p.kind === "factorGroup") {
        const group = resolveTreeFactorGroup(treeEq, p.ids);
        if (group) text = `${group.zone === "n" ? "÷" : "×"}${printNode(group.expr)}`;
      } else if (p.kind === "coef") {
        const expr = coefExprOf(p.termId);
        if (expr) text = `÷${printNode(expr)}`;
      } else if (p.kind === "numer") {
        const f = treeFactorOf(p.termId);
        if (f) text = `÷${printNode(f.expr)}`;
      } else if (p.kind === "xdiv") {
        text = `÷${p.termId.split("@")[1] ?? "x"}`;
      } else if (p.kind === "den") {
        const f = treeFactorOf(p.termId);
        if (f) text = `×${printNode(f.expr)}`;
      } else if (p.kind === "lnbase") {
        text = "ln( )";
      } else if (p.kind === "root") {
        text = p.n === 2 ? "√( )" : p.n === 3 ? "∛( )" : `${p.n}√( )`;
      } else if (p.kind === "raise") {
        text = `( )${supText(p.n)}`;
      }
      if (!text) return null;
      return (
        <span className="ml-4 self-center rounded-md border-2 border-dashed border-amber-400 px-2 py-1 text-[0.45em] leading-none text-amber-500">
          {text}
        </span>
      );
    }
    return null;
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
    if (treeEq) {
      // The visual and algebra dispatch consume the exact same target. This is
      // what makes a whole-addend x preview identically to an x factor.
      return activeDropTarget ? previewTreeOperation(treeEq, p, activeDropTarget) : null;
    }
    return null;
  })();

  const factorizationHints: Record<Side, Map<string, FactorizationHintView>> = {
    left: new Map(),
    right: new Map(),
  };
  for (const { side, rewrite } of factorizationCandidates) {
    const nodeId = rewrite.before.id;
    const hintKey = `${side}:${nodeId}`;
    // One clear card per algebra group is enough. If the engine can factor the
    // same group in several equivalent ways, its first (most direct) result
    // wins instead of stacking cards over one target.
    if (dismissedFactorizationHints.has(hintKey) || factorizationHints[side].has(nodeId)) continue;
    factorizationHints[side].set(nodeId, {
      nodeId,
      label: rewrite.label,
      before: printNode(rewrite.before),
      after: printNode(rewrite.after),
      onApply: () => runRewrite(side, rewrite, nodeId),
      onDismiss: () => {
        setDismissedFactorizationHints((current) => new Set([...Array.from(current), hintKey]));
      },
    });
  }

  return (
    <div
      className="relative flex h-full w-full touch-none flex-col items-center justify-center overscroll-none bg-background text-foreground"
      onPointerDown={onBackgroundPointerDown}
    >
      {/* Typed equation input with live parse preview; the magnifier toggles
          word search over the function catalog */}
      <div className="absolute left-1/2 top-[4.75rem] z-50 w-[92vw] -translate-x-1/2 sm:top-4 sm:w-[min(560px,75vw)]" data-ui data-search>
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
      <div className="absolute left-4 top-4 z-30 flex items-start gap-2" data-ui data-toolbox>
        <div className="relative">
          <button
            type="button"
            aria-expanded={toolboxOpen}
            aria-controls="equation-operations-menu"
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-serif text-base shadow-sm transition-colors ${
              toolboxOpen
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                : "border-border bg-card hover:border-foreground/40"
            }`}
            onClick={() => {
              setSymbolBookOpen(false);
              setToolboxOpen((cur) => !cur);
            }}
          >
            ƒ
            <span className="font-sans text-xs text-muted-foreground">Operations</span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${toolboxOpen ? "rotate-180" : ""}`}
            />
          </button>
          {toolboxOpen && (
            <div
              id="equation-operations-menu"
              className="absolute left-0 top-[calc(100%+4px)] z-40 w-max rounded-lg border border-border bg-card p-2 shadow-lg"
            >
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
                        disabled={!item.tool && !(item.action && calculusReady)}
                        title={
                          item.tool
                            ? item.title
                            : item.action
                              ? calculusReady
                                ? {
                                    ddx:
                                      calculusReadiness?.state === "deterministic"
                                        ? `Differentiate — ${calculusReadiness.explanation}`
                                        : "Differentiate the relation",
                                    int:
                                      calculusReadiness?.state === "deterministic"
                                        ? `Integrate — ${calculusReadiness.explanation}`
                                        : "Integrate the relation",
                                    "calculus-custom": "Choose the full calculus context — mode, roles, notation",
                                  }[item.action]
                                : calculusReadiness?.state === "no-symbols"
                                  ? calculusReadiness.explanation
                                  : `${item.glyph} needs a relation containing at least one symbol`
                              : "coming soon"
                        }
                        onClick={() => {
                          if (playingRef.current) return; // replay owns the stage
                          if (item.action) {
                            if (!calculusReady) return;
                            setToolboxOpen(false);
                            if (item.action === "calculus-custom") openCalculusPanel("differentiate");
                            else quickCalculus(item.action === "ddx" ? "differentiate" : "integrate");
                            return;
                          }
                          if (!item.tool) return;
                          const result = runEquationCommand({
                            type: "gesture",
                            payload: { kind: "tool", tool: item.tool },
                            target: { kind: "side", side: "left" },
                          });
                          if (!result) return;
                          // choosing dismisses the menu — it must not linger
                          // over the equation and swallow the next grab
                          setToolboxOpen(false);
                          if (result.status !== "applied") {
                            const reason = result.status === "rejected" ? result.reason : "the equation changed — try again";
                            flashNotice(reason.charAt(0).toUpperCase() + reason.slice(1) + ".");
                          } else {
                            commitTreeOutcome(result.outcome, result.event);
                          }
                        }}
                        className={`relative flex h-9 min-w-9 items-center justify-center whitespace-nowrap rounded-md border border-transparent px-1.5 font-serif text-sm transition-all hover:z-10 ${
                          item.tool || (item.action && calculusReady)
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
          {calculusOpen && relationAnalysis && (
            <CalculusContextPanel
              operation={calculusOpen}
              symbols={relationAnalysis.symbols}
              context={calculusOpen === "differentiate" ? differentiationContext : integrationContext}
              onContext={(context) => {
                if (calculusOpen === "differentiate") {
                  setDifferentiationContext(context as DifferentiationContext);
                } else {
                  setIntegrationContext(context as IntegrationContext);
                }
              }}
              validationMessage={calculusValidationMessage}
              onApply={() => applyContextualCalculus(calculusOpen)}
              onClose={() => setCalculusOpen(null)}
              onOperation={openCalculusPanel}
            />
          )}
        </div>

        <div className="relative" data-symbol-book>
          <button
            type="button"
            aria-expanded={symbolBookOpen}
            aria-controls="equation-symbol-book"
            onClick={() => {
              setToolboxOpen(false);
              setCalculusOpen(null);
              setSymbolBookOpen((open) => !open);
            }}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs shadow-sm transition-colors ${
              symbolBookOpen
                ? "border-sky-300 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300"
                : "border-border bg-card hover:border-foreground/40"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Model symbols
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {symbolRecords.length}
            </span>
          </button>

          {symbolBookOpen && (
            <section
              id="equation-symbol-book"
              aria-label="Model symbols"
              className="absolute left-0 top-[calc(100%+6px)] z-50 flex max-h-[min(70vh,34rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:w-[22rem]"
            >
              <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Model symbols</h2>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Definitions travel with the equation and are available to AI tools.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close model symbols"
                  onClick={() => setSymbolBookOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="overflow-y-auto p-2">
                {symbolRecords.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Type an equation with a variable to create its first record.
                  </p>
                ) : (
                  symbolRecords.map((record) => (
                    <article
                      key={record.id}
                      onPointerEnter={() => setHoveredSymbolId(record.id)}
                      onPointerLeave={() => setHoveredSymbolId(null)}
                      className="mb-2 rounded-xl border border-transparent bg-muted/35 p-3 last:mb-0 hover:border-sky-300/70 hover:bg-sky-50/60 dark:hover:bg-sky-950/20"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background px-1.5 font-serif text-xl italic">
                          {record.name}
                          {(record.dependsOn ?? []).length > 0 && (
                            <span className="text-sm not-italic text-muted-foreground">
                              ({record.dependsOn!.join(", ")})
                            </span>
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium">
                            {(record.dependsOn ?? []).length > 0
                              ? `Function of ${record.dependsOn!.join(", ")}`
                              : "Model symbol"}
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{record.id}</div>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-[1fr_5.5rem] gap-2">
                        <label>
                          <span className="sr-only">Meaning of {record.name}</span>
                          <input
                            value={record.meaning ?? ""}
                            onChange={(event) => {
                              const meaning = event.target.value;
                              setSymbolRecords((records) => records.map((item) =>
                                item.id === record.id
                                  ? { ...item, meaning: meaning || undefined, provenance: { ...item.provenance, confirmedByHuman: true } }
                                  : item
                              ));
                            }}
                            placeholder="meaning, e.g. time"
                            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs placeholder:text-muted-foreground/60"
                          />
                        </label>
                        <label>
                          <span className="sr-only">Unit of {record.name}</span>
                          <input
                            value={record.unit ?? ""}
                            onChange={(event) => {
                              const unit = event.target.value;
                              setSymbolRecords((records) => records.map((item) =>
                                item.id === record.id
                                  ? { ...item, unit: unit || undefined, provenance: { ...item.provenance, confirmedByHuman: true } }
                                  : item
                              ));
                            }}
                            placeholder="unit"
                            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs placeholder:text-muted-foreground/60"
                          />
                        </label>
                      </div>

                      {/* Declared domain facts — durable licenses the simplifier queries
                          (x/x cancels once x ≠ 0 stands, no re-asking per move). */}
                      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                        <span className="text-muted-foreground">known:</span>
                        {[`${record.name} > 0`, `${record.name} ≠ 0`].map((expression) => {
                          const active = record.assumptions.some(
                            (assumption) => assumption.source === "human" && assumption.expression === expression
                          );
                          return (
                            <button
                              key={expression}
                              type="button"
                              aria-pressed={active}
                              title={active ? `Stop assuming ${expression}` : `Assume ${expression} from here on`}
                              onClick={() => {
                                setSymbolRecords((records) => records.map((item) => {
                                  if (item.id !== record.id) return item;
                                  const rest = item.assumptions.filter(
                                    (assumption) => !(assumption.source === "human" && assumption.expression === expression)
                                  );
                                  return {
                                    ...item,
                                    assumptions: active ? rest : [predicateFromText(expression, "human"), ...rest],
                                    provenance: { ...item.provenance, confirmedByHuman: true },
                                  };
                                }));
                              }}
                              className={`rounded-full border px-2 py-0.5 font-serif transition-colors ${
                                active
                                  ? "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                  : "border-border text-muted-foreground hover:border-amber-300 hover:text-amber-700"
                              }`}
                            >
                              {expression.slice(record.name.length + 1)}
                            </button>
                          );
                        })}
                      </div>

                      {record.assumptions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                          {record.assumptions.map((assumption) => (
                            <span key={assumption.id} className="rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                              {assumption.expression}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Optional detection and developer diagnostics stay out of the primary toolbar. */}
      {!isEmbed && (
      <div className="absolute bottom-6 left-4 hidden flex-col gap-1 sm:flex" data-ui>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            aria-label="factorization detection"
            checked={factorizationDetection}
            onChange={(event) => {
              const next = event.target.checked;
              setFactorizationDetection(next);
              if (next) setDismissedFactorizationHints(new Set());
            }}
            className="h-3 w-3 accent-sky-500"
          />
          factorization detection
          {factorizationDetection && (
            <span className="text-muted-foreground/70">— suggestions appear above factorable groups</span>
          )}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
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
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={devCapture}
            onChange={(e) => {
              setDevCapture(e.target.checked);
              capturingRef.current = e.target.checked;
            }}
            className="h-3 w-3 accent-amber-500"
          />
          capture animation
          {devCapture && (
            <span className="text-muted-foreground/70">— replay downloads a lossless JSON trace of every frame</span>
          )}
        </label>
        <button
          onClick={captureLayout}
          className="flex w-fit items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Download a lossless JSON of every grab handle (role, term-id, box) — for troubleshooting 'I can't grab X' issues"
        >
          <span className="text-amber-500">⤓</span> grab map
          <span className="text-muted-foreground/70">— downloads the hitbox layout as JSON</span>
        </button>
      </div>
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
        {remoteSessionKey && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${
              remoteConnection === "live"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            }`}
            title={remoteConnection === "live"
              ? "Browser and AI share one durable equation"
              : remoteConnection === "connecting" || remoteConnection === "reconnecting"
                ? "Reconnecting to the shared equation"
                : "The shared equation service is offline or not configured"}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${remoteConnection === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
            {remoteConnection === "live"
              ? "live"
              : remoteConnection === "connecting" || remoteConnection === "reconnecting"
                ? "syncing"
                : "offline"}
          </span>
        )}
        <button
          onClick={copyShare}
          disabled={sharing}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          title={equationSessionServiceUrl()
            ? "Copy a live link that a browser or AI client can continue editing"
            : "Copy a snapshot link to this equation and its whole step history"}
        >
          {copied ? "copied ✓" : sharing ? "sharing…" : remoteSessionKey ? "⧉ live share" : "⧉ share"}
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
          treeStatus === "contradiction"
            ? "text-rose-500"
            : treeSolved || treeStatus === "identity"
              ? "text-emerald-600"
              : ""
        }`}
      >
        {(["left", "right"] as const).map((side, i) => (
              <Fragment key={side}>
                {i === 1 && <span className="mx-5 select-none" data-equals>=</span>}
                {/* drop shell: the target ring, both-sides spread previews,
                    and the landing ghost */}
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
                  <TreeSideView
                    node={treeEq[side]}
                    side={side}
                    hoveredTermId={hoveredTermId}
                    selectedIds={selection?.side === side ? selection.termIds : null}
                    factorizationHints={factorizationHints[side]}
                    highlightedSymbolId={hoveredSymbolId}
                    onHover={symHandlers.hover}
                  />
                  {spread?.kind === "wrap" && (
                    <span className="ml-1 self-center whitespace-nowrap text-[0.6em] leading-none text-amber-500/90">
                      {spread.after}
                    </span>
                  )}
                  {spread?.kind === "divide" && (
                    <span className="ml-1 self-center whitespace-nowrap text-[0.5em] leading-none text-amber-500/90">
                      /{spread.text}
                    </span>
                  )}
                  {spread?.kind === "multiply" && (
                    <span className="ml-1 self-center whitespace-nowrap text-[0.5em] leading-none text-amber-500/90">
                      ·{spread.text}
                    </span>
                  )}
                  {dragActive && dragOver === side && !underHover && !spread && sideGhost(side)}
                </span>
          </Fragment>
        ))}
      </div>

      {/* Contextual math actions are taps, never competing drag hitboxes. */}
      {specialBubble && (
        <div
          data-ui
          data-context-bubble
          role="dialog"
          aria-label="Equation operation"
          className="fixed z-[70] w-max max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-full rounded-2xl border border-border bg-card p-1.5 shadow-xl"
          style={{ left: specialBubble.x, top: specialBubble.y }}
        >
          <button
            type="button"
            onClick={() => runSpecialAction(specialBubble.action, specialBubble.ownerId)}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="text-amber-500">→</span>
            {specialActionLabel(specialBubble.action)}
          </button>
        </div>
      )}

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
        ) : treeSolved ? (
          <span className="font-medium text-emerald-600">
            Solved — {treeSolved.v} = {treeSolved.text}
            {treeSolved.approx !== null && <span className="text-emerald-600/70"> ≈ {treeSolved.approx}</span>}
          </span>
        ) : treeStatus === "identity" ? (
          <span className="font-medium text-emerald-600">Always true — the two sides are equal for every value</span>
        ) : treeStatus === "contradiction" ? (
          <span className="font-medium text-rose-500">No solution — the two sides can never be equal</span>
        ) : null}
        {standingAssumptions.map((assumption) => (
            <span
              key={assumption}
              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            >
              {/^[A-Za-z_][A-Za-z0-9_′″]* [≠>] 0$/.test(assumption) ? `assuming ${assumption}` : assumption}
            </span>
          ))}
      </div>

      {relationAnalysis && (
        <VisualizationSetup
          analysis={relationAnalysis}
          value={viewSpec}
          onChange={setViewSpec}
        />
      )}

      {/* A view is an explicit interpretation of the symmetric relation. */}
      {(() => {
        if (relationAnalysis && viewSpec && isViewSpecValid(viewSpec, relationAnalysis)) {
          const key = `${printTreeEq(treeEq)}:${viewSpecKey(viewSpec)}`;
          if (viewSpec.kind === "function-1d") {
            const isolation = isolationForView(relationAnalysis, viewSpec);
            if (!isolation) return null;
            const f = (input: number) => evalNode(isolation.expression, {
              ...viewSpec.fixed,
              [viewSpec.input]: input,
            });
            const fn = {
              f,
              depKey: key,
              input: viewSpec.input,
              output: viewSpec.output,
            };
            return (
              <>
                {fnView === "slope" ? (
                  <TangentPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} outputVar={fn.output} probeValue={probeValue} onProbeValue={setProbeValue} />
                ) : fnView === "mapping" ? (
                  <MappingPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} outputVar={fn.output} probeValue={probeValue} onProbeValue={setProbeValue} />
                ) : (
                  <AreaPane f={fn.f} depKey={fn.depKey} inputVar={fn.input} bounds={bounds} onBounds={setBounds} />
                )}
                <div className="mt-2 flex items-center gap-1.5 text-[11px]" data-ui>
                  {(["slope", "mapping", "area"] as const).map((view) => (
                    <button
                      key={view}
                      onClick={() => setFnView(view)}
                      className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                        fnView === view
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      }`}
                    >
                      {view === "slope"
                        ? "curve & slope"
                        : view === "mapping"
                          ? "input → output"
                          : "area ∫"}
                    </button>
                  ))}
                </div>
              </>
            );
          }
          if (viewSpec.kind === "relation-1d") {
            const evaluate = (node: TNode, input: number) => evalNode(node, {
              ...viewSpec.fixed,
              [viewSpec.input]: input,
            });
            return (
              <GraphView
                fl={(input) => evaluate(treeEq.left, input)}
                fr={(input) => evaluate(treeEq.right, input)}
                depKey={key}
                inputVar={viewSpec.input}
              />
            );
          }
          if (viewSpec.kind === "implicit-2d") {
            const g = (horizontal: number, vertical: number) => {
              const env = {
                ...viewSpec.fixed,
                [viewSpec.horizontal]: horizontal,
                [viewSpec.vertical]: vertical,
              };
              return evalNode(treeEq.left, env) - evalNode(treeEq.right, env);
            };
            return (
              <ImplicitRelationPane
                g={g}
                depKey={key}
                horizontal={viewSpec.horizontal}
                vertical={viewSpec.vertical}
                probe={planeProbe}
                onProbe={setPlaneProbe}
              />
            );
          }
          const isolation = isolationForView(relationAnalysis, viewSpec);
          if (!isolation) return null;
          return (
            <ScalarFieldPane
              f={(horizontal, vertical) => evalNode(isolation.expression, {
                ...viewSpec.fixed,
                [viewSpec.horizontal]: horizontal,
                [viewSpec.vertical]: vertical,
              })}
              depKey={key}
              horizontal={viewSpec.horizontal}
              vertical={viewSpec.vertical}
              output={viewSpec.output}
              probe={planeProbe}
              onProbe={setPlaneProbe}
            />
          );
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
