/**
 * Contextual actions attached to mathematical operators, not drag hitboxes.
 *
 * A special glyph (the e in e^u, an exponent n, sin, ln, a radical) is a tap
 * anchor for exactly one inverse operation. Dragging from the same pixels is
 * still owned by the surrounding addend/factor; the pointer layer decides tap
 * versus drag after movement slop.
 */
import type { Side } from "./model";
import { constValue, type TFnName, type TNode, type TreeEq, tfn } from "./tree";
import {
  applyToolT,
  finalize,
  raiseBothT,
  rootBothT,
  type TreeMoveResult,
} from "./treemoves";

export type SpecialActionKind =
  | "ln"
  | "exp"
  | "root"
  | "raise"
  | "square"
  | "asin"
  | "acos"
  | "atan";

export interface SpecialActionRef {
  kind: SpecialActionKind;
  /** Integer root/power index, present for root and raise. */
  n?: number;
  /** Stable semantic owner that supplied the visible operator. */
  nodeId: string;
  side: Side;
}

const ordinal = (n: number): string => {
  if (n === 2) return "square";
  if (n === 3) return "cube";
  const mod100 = n % 100;
  const suffix =
    n % 10 === 1 && mod100 !== 11
      ? "st"
      : n % 10 === 2 && mod100 !== 12
        ? "nd"
        : n % 10 === 3 && mod100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
};

export function specialActionLabel(action: SpecialActionRef): string {
  switch (action.kind) {
    case "ln":
      return "Take ln of both sides";
    case "exp":
      return "Exponentiate both sides";
    case "root":
      return `Take the ${ordinal(action.n ?? 2)} root of both sides`;
    case "raise":
      return `Raise both sides to the power ${action.n ?? 2}`;
    case "square":
      return "Square both sides";
    case "asin":
      return "Apply arcsin to both sides";
    case "acos":
      return "Apply arccos to both sides";
    case "atan":
      return "Apply arctan to both sides";
  }
}

type InverseTrigAction = "asin" | "acos" | "atan";

const INVERSE_TRIG: Record<
  InverseTrigAction,
  { direct: "sin" | "cos" | "tan"; inverse: TFnName; name: string }
> = {
  asin: { direct: "sin", inverse: "asin", name: "arcsin" },
  acos: { direct: "cos", inverse: "acos", name: "arccos" },
  atan: { direct: "tan", inverse: "atan", name: "arctan" },
};

/** Apply an inverse trig function to one side, unwrapping a matching shell. */
const inverseTrigSide = (side: TNode, action: InverseTrigAction): TNode | string => {
  const { direct, inverse } = INVERSE_TRIG[action];
  if (side.kind === "fn" && side.fn === direct) return side.arg;
  const value = constValue(side);
  if (action !== "atan" && value !== null && Math.abs(value) > 1) {
    return `${INVERSE_TRIG[action].name} is only real between −1 and 1`;
  }
  return tfn(inverse, side);
};

/** Execute the single operation advertised by a special-symbol bubble. */
export function applySpecialActionT(te: TreeEq, action: SpecialActionRef): TreeMoveResult {
  switch (action.kind) {
    case "ln":
      return applyToolT("ln", te);
    case "exp":
      return applyToolT("exp", te);
    case "root":
      return rootBothT(te, action.n ?? 2);
    case "raise":
      return raiseBothT(te, action.n ?? 2);
    case "square":
      return applyToolT("square", te);
    case "asin":
    case "acos":
    case "atan": {
      const spec = INVERSE_TRIG[action.kind];
      const source = te[action.side];
      if (source.kind !== "fn" || source.fn !== spec.direct) {
        return `isolate ${spec.direct}(…) on its side before applying ${spec.name}`;
      }
      const left = inverseTrigSide(te.left, action.kind);
      if (typeof left === "string") return left;
      const right = inverseTrigSide(te.right, action.kind);
      if (typeof right === "string") return right;
      return finalize(
        left,
        right,
        `applied ${spec.name} to both sides`,
        {
          dangerous: true,
          note: `${spec.name} keeps its principal branch — check solutions in the original equation`,
          pill: "check branches",
        }
      );
    }
  }
}
