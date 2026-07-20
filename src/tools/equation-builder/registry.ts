/**
 * The operations registry — Phase A of docs/design/architecture-review.md.
 *
 * One table of operation rows that THREE consumers derive from, so a new
 * case is a row plus tests instead of three hand-wired code paths:
 *
 *   ENGINE    executes rows (the same function objects specialactions.ts and
 *             treemoves.ts export — dispatch identity, not duplication);
 *   RENDER    derives every tap anchor from anchorsForNode(), so a glyph the
 *             engine can invert is automatically a glyph the hand can tap;
 *   PROTOCOL  enumerates rows via listSpecialOperations()'s tree walk, so an
 *             AI caller discovers the SAME inventory the pointer UI offers —
 *             closing the old root-only ⊂ tap-visible divergence.
 *
 * The registry owns operation SPECS. It deliberately owns no JSX (layout,
 * radical bars, superscript geometry stay in treeview.tsx) and no pills
 * (licenses live in the moves themselves and surface through dry-run, per
 * the whitelist philosophy in tree.ts/treemoves.ts).
 */
import {
  printNode,
  signSplit,
  varsIn,
  type TNode,
  type TreeEq,
} from "./tree";
import { applyToolT, type TreeMoveResult, type TreeToolKind } from "./treemoves";
import {
  SPECIAL_EXECUTORS,
  specialActionLabel,
  type SpecialActionKind,
  type SpecialActionRef,
} from "./specialactions";
import type { Side } from "./model";

/* --- anchor specs -------------------------------------------------------- */

/** Where an anchor sits inside a node's rendered layout. */
export type AnchorSlot = "whole" | "exponent";

export interface AnchorSpec {
  kind: SpecialActionKind;
  slot: AnchorSlot;
  /** → data-special-surface; "operator" lets closest() prefer nested taps. */
  surface: "structure" | "operator";
  n?: number;
  /** The exact tree node the action unwinds (isolate-then-invert kinds). */
  targetId?: string;
  exprText?: string;
  title: string;
}

const ordinalRoot = (n: number): string =>
  n === 2 ? "square" : n === 3 ? "cube" : `${n}th`;

/**
 * Every tap anchor a node offers, derived purely from its structure. This is
 * the single source the renderer wraps its layout with and the enumeration
 * walk reads — the conditions are the former treeview.tsx hand-wired
 * branches, transcribed once.
 */
export function anchorsForNode(node: TNode): AnchorSpec[] {
  if (node.kind === "pow") {
    // Reciprocal displays (x⁻¹, 2^(−x) shown as 1/…) re-render through a
    // projected positive node — anchors come from that recursion, not here.
    const negSplit = node.exp.kind !== "const" ? signSplit(node.exp) : null;
    if ((node.exp.kind === "const" && node.exp.num < 0) || negSplit?.neg) return [];
    // √u / ⁿ√u radical notation: the whole surface raises both sides.
    if (node.exp.kind === "const" && node.exp.num === 1 && node.exp.den >= 2) {
      return [
        {
          kind: "raise",
          slot: "whole",
          surface: "structure",
          n: node.exp.den,
          title: `Tap to raise both sides to the power ${node.exp.den}`,
        },
      ];
    }
    // Integer power: the whole surface takes the n-th root (and deliberately
    // NOT ln — x² is not an exponential).
    if (node.exp.kind === "const" && node.exp.den === 1 && node.exp.num >= 2) {
      return [
        {
          kind: "root",
          slot: "whole",
          surface: "structure",
          n: node.exp.num,
          title: `Tap to take the ${ordinalRoot(node.exp.num)} root of both sides`,
        },
      ];
    }
    // A variable exponent makes the power an EXPONENTIAL (2^x, b^x, x^b):
    // the whole surface takes ln (freeing the exponent) while the exponent
    // itself is the more specific u-th-root surface (freeing the base).
    if (varsIn(node.exp).size > 0) {
      return [
        {
          kind: "ln",
          slot: "whole",
          surface: "structure",
          title: "Tap the exponential to take ln of both sides",
        },
        {
          kind: "rootexpr",
          slot: "exponent",
          surface: "operator",
          targetId: node.id,
          exprText: printNode(node.exp),
          title: `Tap the exponent to take the ${printNode(node.exp)}-th root of both sides`,
        },
      ];
    }
    return [];
  }
  if (node.kind === "fn") {
    if (node.fn === "exp") {
      // e^1 renders as plain e — one ln surface, no exponent layer.
      if (node.arg.kind === "const" && node.arg.num === 1 && node.arg.den === 1) {
        return [
          { kind: "ln", slot: "whole", surface: "structure", title: "Tap to take ln of both sides" },
        ];
      }
      const specs: AnchorSpec[] = [
        {
          kind: "ln",
          slot: "whole",
          surface: "structure",
          title: "Tap the exponential to take ln of both sides",
        },
      ];
      if (node.arg.kind === "const" && node.arg.den === 1 && node.arg.num >= 2) {
        specs.push({
          kind: "root",
          slot: "exponent",
          surface: "operator",
          n: node.arg.num,
          title: `Tap to take the ${ordinalRoot(node.arg.num)} root of both sides`,
        });
      } else if (varsIn(node.arg).size > 0) {
        specs.push({
          kind: "rootexpr",
          slot: "exponent",
          surface: "operator",
          targetId: node.id,
          exprText: printNode(node.arg),
          title: `Tap the exponent to take the ${printNode(node.arg)}-th root of both sides`,
        });
      }
      return specs;
    }
    if (node.fn === "sqrt") {
      return [
        {
          kind: "square",
          slot: "whole",
          surface: "structure",
          title: "Tap the radical to square both sides",
        },
      ];
    }
    const inverse: Partial<Record<string, { kind: SpecialActionKind; applies: string }>> = {
      sin: { kind: "asin", applies: "arcsin" },
      cos: { kind: "acos", applies: "arccos" },
      tan: { kind: "atan", applies: "arctan" },
      ln: { kind: "exp", applies: "e^" },
    };
    const entry = inverse[node.fn];
    if (entry) {
      return [
        {
          kind: entry.kind,
          slot: "whole",
          surface: "structure",
          targetId: node.id,
          title: `Tap ${node.fn}(…) to apply ${entry.applies} to both sides`,
        },
      ];
    }
    return [];
  }
  return [];
}

/* --- rows ---------------------------------------------------------------- */

export interface SpecialActionRow {
  id: string;
  family: "special";
  kind: SpecialActionKind;
  /**
   * Whether execute() depends only on (kind, n) — "global" operations act on
   * whole sides — or on the exact tapped node ("targeted" isolate-then-invert).
   * Drives enumeration dedup.
   */
  scope: "global" | "targeted";
  execute: (te: TreeEq, action: SpecialActionRef) => TreeMoveResult;
  label: (action: SpecialActionRef) => string;
  anchorsFor: (node: TNode) => AnchorSpec[];
}

export interface ToolRow {
  id: string;
  family: "tool";
  tool: TreeToolKind;
  /** Label the protocol/AI inventory shows. */
  protocolLabel: string;
  /** Hover title the toolbox button shows. */
  title: string;
  execute: (te: TreeEq) => TreeMoveResult;
}

export type OperationRow = SpecialActionRow | ToolRow;

const SPECIAL_SCOPE: Record<SpecialActionKind, "global" | "targeted"> = {
  ln: "global",
  exp: "global",
  root: "global",
  raise: "global",
  square: "global",
  rootexpr: "targeted",
  asin: "targeted",
  acos: "targeted",
  atan: "targeted",
};

const specialRow = (kind: SpecialActionKind): SpecialActionRow => ({
  id: `special.${kind}`,
  family: "special",
  kind,
  scope: SPECIAL_SCOPE[kind],
  execute: SPECIAL_EXECUTORS[kind],
  label: specialActionLabel,
  anchorsFor: (node) => anchorsForNode(node).filter((spec) => spec.kind === kind),
});

/** Adding a SpecialActionKind without a row is a compile error — the O(1) contract. */
export const SPECIAL_ROWS: Record<SpecialActionKind, SpecialActionRow> = {
  ln: specialRow("ln"),
  exp: specialRow("exp"),
  root: specialRow("root"),
  raise: specialRow("raise"),
  square: specialRow("square"),
  rootexpr: specialRow("rootexpr"),
  asin: specialRow("asin"),
  acos: specialRow("acos"),
  atan: specialRow("atan"),
};

/** Adding a TreeToolKind without a row is a compile error too. */
export const TOOL_ROWS: Record<TreeToolKind, ToolRow> = {
  ln: { id: "tool.ln", family: "tool", tool: "ln", protocolLabel: "Apply ln to both sides", title: "Take ln of both sides", execute: (te) => applyToolT("ln", te) },
  exp: { id: "tool.exp", family: "tool", tool: "exp", protocolLabel: "Apply exp to both sides", title: "Exponentiate both sides (e to each side)", execute: (te) => applyToolT("exp", te) },
  sin: { id: "tool.sin", family: "tool", tool: "sin", protocolLabel: "Apply sin to both sides", title: "Take sin of both sides", execute: (te) => applyToolT("sin", te) },
  cos: { id: "tool.cos", family: "tool", tool: "cos", protocolLabel: "Apply cos to both sides", title: "Take cos of both sides", execute: (te) => applyToolT("cos", te) },
  tan: { id: "tool.tan", family: "tool", tool: "tan", protocolLabel: "Apply tan to both sides", title: "Take tan of both sides", execute: (te) => applyToolT("tan", te) },
  sqrt: { id: "tool.sqrt", family: "tool", tool: "sqrt", protocolLabel: "Apply sqrt to both sides", title: "Take the square root of both sides", execute: (te) => applyToolT("sqrt", te) },
  square: { id: "tool.square", family: "tool", tool: "square", protocolLabel: "Apply square to both sides", title: "Square both sides", execute: (te) => applyToolT("square", te) },
  recip: { id: "tool.recip", family: "tool", tool: "recip", protocolLabel: "Apply recip to both sides", title: "Take the reciprocal of both sides", execute: (te) => applyToolT("recip", te) },
};

/** Enumeration/toolbar order — matches the engine's historical order exactly. */
export const TOOL_ROW_ORDER: TreeToolKind[] = [
  "ln",
  "exp",
  "sin",
  "cos",
  "tan",
  "sqrt",
  "square",
  "recip",
];

/* --- protocol enumeration ------------------------------------------------ */

export interface EnumeratedSpecial {
  id: string;
  label: string;
  action: SpecialActionRef;
}

const childrenOf = (node: TNode): TNode[] => {
  switch (node.kind) {
    case "add":
      return node.terms;
    case "mul":
      return node.factors;
    case "pow":
      return [node.base, node.exp];
    case "fn":
      return [node.arg];
    case "derivative":
      return [node.expression];
    case "integral":
      return node.bounds
        ? [node.integrand, node.bounds.lower, node.bounds.upper]
        : [node.integrand];
    default:
      return [];
  }
};

/**
 * Every special operation the equation offers, discovered by the SAME
 * anchorsForNode() the renderer uses — a pre-order walk so the outermost
 * occurrence of a global operation wins (stable ids: the root cases keep
 * the exact ids the old root-only enumeration emitted; nested entries are
 * purely additive). Legality is NOT judged here — the caller's dry-run
 * filter prunes refusals, exactly as it always has.
 */
export function listSpecialOperations(te: TreeEq): EnumeratedSpecial[] {
  const out: EnumeratedSpecial[] = [];
  for (const side of ["left", "right"] as const) {
    const seen = new Set<string>();
    const walk = (node: TNode) => {
      for (const spec of anchorsForNode(node)) {
        const dedupKey =
          SPECIAL_SCOPE[spec.kind] === "global"
            ? `${spec.kind}:${spec.n ?? ""}`
            : `${spec.kind}:${spec.targetId}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          const action: SpecialActionRef = {
            kind: spec.kind,
            n: spec.n,
            nodeId: node.id,
            targetId: spec.targetId,
            exprText: spec.exprText,
            side: side as Side,
          };
          out.push({
            id: `special:${side}:${spec.kind}:${node.id}`,
            label: specialActionLabel(action),
            action,
          });
        }
      }
      for (const child of childrenOf(node)) walk(child);
    };
    walk(te[side]);
  }
  return out;
}
