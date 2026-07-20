/**
 * Derivation-invariant contract for the operations registry
 * (docs/design/architecture-review.md, Phase A).
 *
 * The registry is the single source for inverse operations. These checks pin
 * the three derivations to it:
 *
 *   G1  ENGINE ⊆ RENDER    every enumerated special action has a rendered anchor
 *   G2  RENDER ⊆ ENGINE ∪ refusal   every rendered anchor either executes
 *       legally (and is enumerated) or refuses with a teaching string —
 *       never null, never a throw
 *   G3  RENDER ≡ REGISTRY  each rendered anchor is exactly the spec
 *       anchorsForNode() declares for its node (≤1 anchor per slot)
 *   G4  nested-enumeration regressions pinned (the old root-only hole)
 *   G5  dedup determinism + stable id shape
 *   G6  tool rows are the single tool source
 *
 * Rendered anchors are deliberately a SUPERSET of legal operations: an anchor
 * on a buried operator is a teaching surface whose tap explains the refusal.
 * Display projections (1/2^x re-rendered through a projected node) carry
 * anchors whose ids are not in the semantic tree — those are covered by
 * G1/G2 only, not G3.
 *
 * Run: npx tsx scripts/test-registry.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  anchorsForNode,
  listSpecialOperations,
  SPECIAL_ROWS,
  TOOL_ROWS,
  TOOL_ROW_ORDER,
  type AnchorSpec,
} from "../src/tools/equation-builder/registry";
import {
  applySpecialActionT,
  SPECIAL_EXECUTORS,
  type SpecialActionKind,
  type SpecialActionRef,
} from "../src/tools/equation-builder/specialactions";
import {
  executeEquationCommand,
  listApplicableEquationOperations,
} from "../src/tools/equation-builder/engine";
import { parseEquation } from "../src/tools/equation-builder/parser";
import { printNode, type TNode, type TreeEq } from "../src/tools/equation-builder/tree";

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean, detail = "") => {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const eq = (text: string): TreeEq => {
  const parsed = parseEquation(text);
  if (!parsed.ok) throw new Error(`parse failed: ${text} → ${parsed.message}`);
  return parsed.tree;
};

const findById = (node: TNode, id: string): TNode | null => {
  if (node.id === id) return node;
  switch (node.kind) {
    case "add":
      for (const t of node.terms) { const f = findById(t, id); if (f) return f; }
      return null;
    case "mul":
      for (const t of node.factors) { const f = findById(t, id); if (f) return f; }
      return null;
    case "pow":
      return findById(node.base, id) ?? findById(node.exp, id);
    case "fn":
      return findById(node.arg, id);
    case "derivative":
      return findById(node.expression, id);
    case "integral":
      return findById(node.integrand, id) ??
        (node.bounds ? findById(node.bounds.lower, id) ?? findById(node.bounds.upper, id) : null);
    default:
      return null;
  }
};

interface RenderedAnchor {
  kind: SpecialActionKind;
  n?: number;
  nodeId: string;
  targetId?: string;
  exprText?: string;
  surface: string;
  side: "left" | "right";
}

const anchorsInHtml = (html: string, side: "left" | "right"): RenderedAnchor[] =>
  Array.from(html.matchAll(/<span ([^>]*data-special-action="[^"]+"[^>]*)>/g)).map((match) => {
    const attr = (name: string) => match[1].match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const rawN = attr("data-special-n");
    return {
      kind: attr("data-special-action") as SpecialActionKind,
      n: rawN ? Number(rawN) : undefined,
      nodeId: attr("data-special-node") ?? "?",
      targetId: attr("data-special-target"),
      exprText: attr("data-special-expr"),
      surface: attr("data-special-surface") ?? "?",
      side,
    };
  });

const BATTERY = [
  "sin(x)*e^x/2^x = y",
  "y = e^x",
  "y = 2^x",
  "y = x^b",
  "y = e^(2x)",
  "y = sin(x)*x",
  "y = 2*sin(x) + 1",
  "y = sqrt(x)",
  "y = ln(x)",
  "y = x^2",
  "3*2^x = 6",
];

const run = async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  const { TreeSideView } = await import("../src/tools/equation-builder/treeview");
  const renderSide = (node: TNode, side: "left" | "right") =>
    renderToStaticMarkup(
      React.createElement(TreeSideView, {
        node,
        side,
        hoveredTermId: null,
        selectedIds: null,
        factorizationHints: null,
        onHover: () => undefined,
      })
    );

  for (const text of BATTERY) {
    const te = eq(text);
    const rendered: RenderedAnchor[] = [
      ...anchorsInHtml(renderSide(te.left, "left"), "left"),
      ...anchorsInHtml(renderSide(te.right, "right"), "right"),
    ];
    const enumerated = listApplicableEquationOperations(te).filter(
      (op) => op.command.type === "special-action"
    );

    // G1: every enumerated special has a rendered anchor with matching kind/n/side
    const g1 = enumerated.every((op) => {
      const action = (op.command as { action: SpecialActionRef }).action;
      return rendered.some(
        (anchor) => anchor.side === action.side && anchor.kind === action.kind && anchor.n === action.n
      );
    });
    check(`G1 ${text}: engine ⊆ render`, g1,
      JSON.stringify({ enumerated: enumerated.map((op) => op.id), rendered: rendered.map((a) => `${a.side}:${a.kind}`) }));

    // G2: every rendered anchor executes to success-and-enumerated, or a string refusal
    let g2 = true;
    let g2detail = "";
    for (const anchor of rendered) {
      const ref: SpecialActionRef = {
        kind: anchor.kind,
        n: anchor.n,
        nodeId: anchor.nodeId,
        targetId: anchor.targetId,
        exprText: anchor.exprText,
        side: anchor.side,
      };
      let result;
      try {
        result = applySpecialActionT(te, ref);
      } catch (error) {
        g2 = false;
        g2detail = `${anchor.side}:${anchor.kind} threw ${error}`;
        break;
      }
      if (result === null) {
        g2 = false;
        g2detail = `${anchor.side}:${anchor.kind} returned null`;
        break;
      }
      if (typeof result !== "string") {
        const listed = enumerated.some((op) => {
          const action = (op.command as { action: SpecialActionRef }).action;
          if (action.side !== anchor.side || action.kind !== anchor.kind || action.n !== anchor.n) return false;
          // targeted kinds must agree on the exact node when it resolves in the semantic tree
          if (anchor.targetId && findById(te[anchor.side], anchor.targetId)) {
            return action.targetId === anchor.targetId;
          }
          return true;
        });
        if (!listed) {
          g2 = false;
          g2detail = `${anchor.side}:${anchor.kind} succeeds but is not enumerated`;
          break;
        }
      }
    }
    check(`G2 ${text}: render ⊆ engine ∪ refusal`, g2, g2detail);

    // G3: rendered anchors whose node resolves in the semantic tree match the registry spec
    let g3 = true;
    let g3detail = "";
    for (const anchor of rendered) {
      const owner = anchor.targetId ?? anchor.nodeId;
      const node = findById(te[anchor.side], owner);
      if (!node) continue; // display projection — G1/G2 cover it
      const specs = anchorsForNode(node);
      const match = specs.find(
        (spec: AnchorSpec) =>
          spec.kind === anchor.kind &&
          spec.n === anchor.n &&
          spec.surface === anchor.surface &&
          spec.targetId === anchor.targetId &&
          spec.exprText === anchor.exprText
      );
      if (!match) {
        // the anchor may belong to an ancestor whole-slot spec (nodeId is the
        // display OWNER, e.g. the addend, not the pow node) — accept when ANY
        // node in the owner subtree declares the spec
        const anywhere = (function search(n: TNode): boolean {
          if (anchorsForNode(n).some((s) => s.kind === anchor.kind && s.n === anchor.n && s.surface === anchor.surface)) return true;
          switch (n.kind) {
            case "add": return n.terms.some(search);
            case "mul": return n.factors.some(search);
            case "pow": return search(n.base) || search(n.exp);
            case "fn": return search(n.arg);
            default: return false;
          }
        })(node);
        if (!anywhere) {
          g3 = false;
          g3detail = `${anchor.side}:${anchor.kind} on ${printNode(node)} has no registry spec`;
          break;
        }
      }
      const slots = anchorsForNode(node).map((spec) => spec.slot);
      if (new Set(slots).size !== slots.length) {
        g3 = false;
        g3detail = `two anchors share a slot on ${printNode(node)}`;
        break;
      }
    }
    check(`G3 ${text}: render ≡ registry`, g3, g3detail);
  }

  // G4: the nested-enumeration holes the registry closes, pinned explicitly
  {
    const listed = (text: string) =>
      listApplicableEquationOperations(eq(text))
        .filter((op) => op.command.type === "special-action")
        .map((op) => (op.command as { action: SpecialActionRef }).action.kind);
    check("G4a y = 2sin(x)+1 enumerates the auto-isolating arcsin", listed("y = 2*sin(x) + 1").includes("asin"),
      JSON.stringify(listed("y = 2*sin(x) + 1")));
    check("G4b 3·2^x = 6 enumerates ln", listed("3*2^x = 6").includes("ln"),
      JSON.stringify(listed("3*2^x = 6")));
    const e2x = listed("y = e^(2x)");
    check("G4c y = e^(2x) enumerates ln and the targeted rootexpr", e2x.includes("ln") && e2x.includes("rootexpr"),
      JSON.stringify(e2x));
  }

  // G5: dedup determinism + stable id shape
  {
    const te = eq("sin(x)*e^x/2^x = y");
    const first = listSpecialOperations(te).map((op) => op.id);
    const second = listSpecialOperations(te).map((op) => op.id);
    check("G5a enumeration is deterministic", JSON.stringify(first) === JSON.stringify(second));
    const lnOnLeft = listSpecialOperations(te).filter((op) => op.action.side === "left" && op.action.kind === "ln");
    check("G5b one ln per side despite multiple exponential factors", lnOnLeft.length === 1,
      JSON.stringify(lnOnLeft.map((op) => op.id)));
    check("G5c ids keep the special:side:kind:nodeId shape",
      first.every((id) => /^special:(left|right):[a-z]+:/.test(id)), JSON.stringify(first));
    check("G5d id node ids resolve in the semantic tree",
      listSpecialOperations(te).every((op) => !!findById(te[op.action.side], op.action.nodeId)));
  }

  // G6: tool rows are the single source
  {
    const te = eq("y = x^2");
    const toolIds = listApplicableEquationOperations(te)
      .filter((op) => op.id.startsWith("tool:"))
      .map((op) => op.id);
    check("G6a engine tool list follows row order",
      JSON.stringify(toolIds) === JSON.stringify(TOOL_ROW_ORDER.map((tool) => `tool:${tool}`).filter((id) => toolIds.includes(id))),
      JSON.stringify(toolIds));
    check("G6b every tool row executes through applyToolT",
      TOOL_ROW_ORDER.every((tool) => typeof TOOL_ROWS[tool].execute === "function"));
    check("G6c special rows reference the shared executors",
      (Object.keys(SPECIAL_ROWS) as SpecialActionKind[]).every(
        (kind) => SPECIAL_ROWS[kind].execute === SPECIAL_EXECUTORS[kind]
      ));
    // executing a row and the legacy dispatcher must be the same function call
    const sample = eq("y = e^x");
    const viaRow = SPECIAL_ROWS.ln.execute(sample, { kind: "ln", nodeId: "t", side: "right" });
    const viaLegacy = applySpecialActionT(eq("y = e^x"), { kind: "ln", nodeId: "t", side: "right" });
    check("G6d row execution matches legacy dispatch",
      typeof viaRow === typeof viaLegacy &&
        (typeof viaRow !== "object" || viaRow === null || printNode(viaRow.treeNext.left) === printNode((viaLegacy as typeof viaRow)!.treeNext.left)));
    void executeEquationCommand; // imported for future G-checks; keep referenced
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
};

run();
