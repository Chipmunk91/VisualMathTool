/**
 * Contract tests for the calculus readiness states and derivative-born
 * symbols (docs/design/calculus-ux.md): state inference from relation
 * structure, one-tap default contexts, Lagrange/subscript symbol birth,
 * and the untouched Leibniz default for context-only callers.
 */
import {
  derivedSymbolName,
  differentiateRelation,
  inferCalculusDefaults,
  integrationDefaultsFrom,
  type DifferentiationContext,
} from "../src/tools/equation-builder/calculus";
import { analyzeRelation } from "../src/tools/equation-builder/relation";
import { parseEquation } from "../src/tools/equation-builder/parser";
import { printNode, type TreeEq } from "../src/tools/equation-builder/tree";

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
const readiness = (text: string) => inferCalculusDefaults(analyzeRelation(eq(text)));

// --- State 1: constant relation --------------------------------------------
check("5 = 5 has no symbols to vary", readiness("5 = 5").state === "no-symbols");

// --- State 0: solution-set traps -------------------------------------------
{
  const r = readiness("x^2 = 4");
  check("x² = 4 is a solution-set trap", r.state === "solution-set");
  check(
    "trap explanation teaches, not scolds",
    r.state === "solution-set" && /solutions|identity/i.test(r.explanation)
  );
}
check("y = 5 pins y to a point", readiness("y = 5").state === "solution-set");

// --- State 2: deterministic single-input isolation --------------------------
{
  const r = readiness("y = 2x^2");
  check("y = 2x² is deterministic", r.state === "deterministic");
  if (r.state === "deterministic") {
    check("…differentiate d/dx", r.context.withRespectTo === "x" && r.context.mode === "ordinary");
    check("…y is the dependent symbol", r.context.dependent.join() === "y");
    check("…defaults to Lagrange notation", r.context.notation === "lagrange");
  }
}
check("sin(t) = y reads the same as y = sin(t)", (() => {
  const r = readiness("sin(t) = y");
  return r.state === "deterministic" && r.context.withRespectTo === "t" && r.context.dependent.join() === "y";
})());

// --- State 3: genuinely ambiguous ------------------------------------------
{
  const r = readiness("x^2 + y^2 = 1");
  check("x² + y² = 1 needs a context", r.state === "needs-context");
  if (r.state === "needs-context") {
    check("…suggests implicit differentiation", r.suggestion.mode === "implicit");
    check("…suggestion is complete (wrt + roles)", r.suggestion.withRespectTo === "x" && r.suggestion.dependent.join() === "y");
  }
}
{
  const r = readiness("z = x*y");
  check("z = x·y needs a context", r.state === "needs-context");
  if (r.state === "needs-context") {
    check("…suggests a partial derivative", r.suggestion.mode === "partial");
    check("…holds the other input constant", r.suggestion.heldConstant.join() === "y");
    check("…defaults to subscript notation", r.suggestion.notation === "subscript");
  }
}
check("y = x (two isolations) asks which side is the function", readiness("y = x").state === "needs-context");

// --- Derived symbol naming ---------------------------------------------------
check("lagrange: y → y′", derivedSymbolName("y", "x", "lagrange") === "y′");
check("lagrange repeats: y′ → y′′", derivedSymbolName("y′", "x", "lagrange") === "y′′");
check("subscript: z → z_x", derivedSymbolName("z", "x", "subscript") === "z_x");
check("subscript repeats: z_x → z_xx", derivedSymbolName("z_x", "x", "subscript") === "z_xx");

// --- Lagrange birth: y = 2x² → y′ = 4x --------------------------------------
{
  const r = readiness("y = 2x^2");
  if (r.state !== "deterministic") throw new Error("expected deterministic");
  const result = differentiateRelation(eq("y = 2x^2"), r.context);
  check("one-tap derivative applies", typeof result !== "string");
  if (typeof result !== "string") {
    check("left side is the symbol y′", printNode(result.equation.left) === "y′", printNode(result.equation.left));
    check("right side is 4x", printNode(result.equation.right).replace(/[()·*\s]/g, "") === "4x", printNode(result.equation.right));
    check("note records the naming", result.note.includes("y′") && result.note.includes("dy/dx"));

    // The result is an ordinary relation again: differentiating ONCE MORE
    // must be deterministic and birth y′′.
    const again = inferCalculusDefaults(analyzeRelation(result.equation));
    check("y′ = 4x is deterministic again", again.state === "deterministic");
    if (again.state === "deterministic") {
      const second = differentiateRelation(result.equation, again.context);
      check(
        "second tap births y′′ = 4",
        typeof second !== "string" && printNode(second.equation.left) === "y′′" &&
          printNode(second.equation.right).replace(/[()\s]/g, "") === "4",
        typeof second === "string" ? second : printNode(second.equation.left)
      );
    }
  }
}

// --- Implicit differentiation with Lagrange: x² + y² = 1 --------------------
{
  const context: DifferentiationContext = {
    mode: "implicit",
    withRespectTo: "x",
    dependent: ["y"],
    heldConstant: [],
    notation: "lagrange",
  };
  const result = differentiateRelation(eq("x^2 + y^2 = 1"), context);
  check("implicit derivative applies", typeof result !== "string");
  if (typeof result !== "string") {
    const text = printNode(result.equation.left);
    check("y′ appears as an ordinary movable factor", text.includes("y′"), text);
    check("no Leibniz fraction is born", !text.includes("d(y)"), text);
  }
}

// --- Subscript birth: z = x·y → z_x = y -------------------------------------
{
  const r = readiness("z = x*y");
  if (r.state !== "needs-context") throw new Error("expected needs-context");
  const result = differentiateRelation(eq("z = x*y"), r.suggestion);
  check("partial derivative applies", typeof result !== "string");
  if (typeof result !== "string") {
    check("left side is z_x", printNode(result.equation.left) === "z_x", printNode(result.equation.left));
    check("right side is y", printNode(result.equation.right).replace(/[()\s]/g, "") === "y", printNode(result.equation.right));
  }
}

// --- Leibniz stays the engine default (protocol/tests unchanged) -------------
{
  const context: DifferentiationContext = {
    mode: "ordinary",
    withRespectTo: "x",
    dependent: ["y"],
    heldConstant: [],
  };
  const result = differentiateRelation(eq("y = 2x^2"), context);
  check("no notation → classic Leibniz node", typeof result !== "string" && printNode(result.equation.left).includes("d(y)/dx"),
    typeof result === "string" ? result : printNode(result.equation.left));
}

// --- Integration defaults mirror the differentiation reading -----------------
{
  const r = readiness("y = 2x^2");
  if (r.state !== "deterministic") throw new Error("expected deterministic");
  const context = integrationDefaultsFrom(r.context);
  check("integration mirrors the classification", context.withRespectTo === "x" && context.dependent.join() === "y" && context.mode === "ordinary");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
