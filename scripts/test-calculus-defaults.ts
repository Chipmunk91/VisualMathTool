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
  validateCalculusContext,
  type DifferentiationContext,
} from "../src/tools/equation-builder/calculus";
import { analyzeRelation } from "../src/tools/equation-builder/relation";
import { parseEquation } from "../src/tools/equation-builder/parser";
import {
  ensureTreeEqIds,
  freeVarsIn,
  printNode,
  tadd,
  tc,
  tdiff,
  tfn,
  tint,
  tmul,
  tpow,
  tv,
  withoutSymbol,
  type TreeEq,
} from "../src/tools/equation-builder/tree";
import { reconcileSymbols, symbolsInEquation } from "../src/tools/equation-builder/document";

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

// --- Suggestion seeds follow variable conventions, not the alphabet ----------
{
  const linear = readiness("y = m*x + b");
  check(
    "y = mx + b seeds d/dx with m, b held",
    linear.state === "needs-context" &&
      linear.suggestion.withRespectTo === "x" &&
      linear.suggestion.dependent.join() === "y" &&
      [...linear.suggestion.heldConstant].sort().join() === "b,m",
    JSON.stringify(linear)
  );
  const kinematic = readiness("q = a*t^2");
  check(
    "q = at² seeds d/dt with a held",
    kinematic.state === "needs-context" &&
      kinematic.suggestion.withRespectTo === "t" &&
      kinematic.suggestion.heldConstant.join() === "a",
    JSON.stringify(kinematic)
  );
  const twoWay = readiness("y = x");
  check(
    "y = x seeds y as the function of x",
    twoWay.state === "needs-context" &&
      twoWay.suggestion.withRespectTo === "x" &&
      twoWay.suggestion.dependent.join() === "y",
    JSON.stringify(twoWay)
  );
  check(
    "two-isolation explanation names both readings",
    twoWay.state === "needs-context" &&
      twoWay.explanation.includes("y as a function of x") &&
      twoWay.explanation.includes("x as a function of y"),
    twoWay.state === "needs-context" ? twoWay.explanation : twoWay.state
  );
}

// --- Declared dependency graphs decide the reading ---------------------------
{
  const declared = parseEquation("y(x) = m*x + b");
  check("y(x) = … parses as a declaration", declared.ok && JSON.stringify(declared.dependencies) === '{"y":["x"]}',
    JSON.stringify(declared));
  if (declared.ok) {
    const r = inferCalculusDefaults({ ...analyzeRelation(declared.tree), dependencies: declared.dependencies });
    check(
      "declared y(x) makes y = mx + b deterministic with m, b held",
      r.state === "deterministic" &&
        r.context.withRespectTo === "x" &&
        r.context.dependent.join() === "y" &&
        [...r.context.heldConstant].sort().join() === "b,m",
      JSON.stringify(r)
    );
  }

  const multi = parseEquation("z(x,y) = x^2 + y^2");
  check("z(x,y) declares both edges", multi.ok && JSON.stringify(multi.dependencies) === '{"z":["x","y"]}');
  if (multi.ok) {
    const two = inferCalculusDefaults({ ...analyzeRelation(multi.tree), dependencies: multi.dependencies });
    check(
      "two free drivers still ask, seeded d/dx with y held",
      two.state === "needs-context" && two.suggestion.withRespectTo === "x" && two.suggestion.heldConstant.join() === "y",
      JSON.stringify(two)
    );
    const chained = inferCalculusDefaults({
      ...analyzeRelation(multi.tree),
      dependencies: { z: ["x", "y"], y: ["x"] },
    });
    check(
      "adding the y→x edge flips the same equation to a deterministic total derivative",
      chained.state === "deterministic" &&
        chained.context.mode === "total" &&
        chained.context.dependent.join() === "y,z" &&
        chained.context.heldConstant.length === 0,
      JSON.stringify(chained)
    );
  }

  const circle = parseEquation("x^2 + y^2 = 1");
  if (circle.ok) {
    const implicitly = inferCalculusDefaults({
      ...analyzeRelation(circle.tree),
      dependencies: { y: ["x"] },
    });
    check(
      "a declared y(x) makes the implicit circle one-tap",
      implicitly.state === "deterministic" && implicitly.context.withRespectTo === "x" && implicitly.context.dependent.join() === "y",
      JSON.stringify(implicitly)
    );
  }

  const known = parseEquation("sin(x) = y");
  check("known functions are never hijacked as declarations", known.ok && known.dependencies === undefined);
}

// --- Hidden parameters and slot partials -------------------------------------
{
  // Related rates: t never appears in the equation, yet drives x and y.
  const surface = parseEquation("z = x^2 + y^2");
  if (!surface.ok) throw new Error("parse");
  const parametric = {
    mode: "total" as const,
    withRespectTo: "t",
    dependent: ["x", "y", "z"],
    heldConstant: [] as string[],
    notation: "subscript" as const,
  };
  check(
    "a parameter outside the equation validates when dependents are inside",
    validateCalculusContext(surface.tree, parametric).ok
  );
  const related = differentiateRelation(surface.tree, parametric);
  check(
    "related rates: z_t = 2x·x_t + 2y·y_t",
    typeof related !== "string" &&
      printNode(related.equation.left) === "z_t" &&
      printNode(related.equation.right).includes("x_t") &&
      printNode(related.equation.right).includes("y_t"),
    typeof related === "string" ? related : printNode(related.equation.right)
  );
  check(
    "a parameter with no dependents is refused",
    !validateCalculusContext(surface.tree, { ...parametric, dependent: [], heldConstant: ["x", "y", "z"] }).ok
  );

  // Slot partial: y frozen even though the graph chains y(x).
  const slot = {
    mode: "partial" as const,
    withRespectTo: "x",
    dependent: ["z"],
    heldConstant: ["y"],
    notation: "subscript" as const,
  };
  const direct = differentiateRelation(surface.tree, slot);
  check(
    "slot partial freezes the connected symbol: z_x = 2x",
    typeof direct !== "string" && printNode(direct.equation.right) === "2x",
    typeof direct === "string" ? direct : printNode(direct.equation.right)
  );

  // The graph with a parameter wired to both inputs is deterministic.
  const withParameter = inferCalculusDefaults({
    symbols: ["t", "x", "y", "z"],
    isolations: analyzeRelation(surface.tree).isolations,
    dependencies: { x: ["t"], y: ["t"], z: ["x", "y"] },
  });
  check(
    "t→x, t→y makes the surface one-tap along t",
    withParameter.state === "deterministic" &&
      withParameter.context.withRespectTo === "t" &&
      withParameter.context.dependent.join() === "x,y,z",
    JSON.stringify(withParameter)
  );
}

// --- Rebuilding without a symbol (the − button's equation-symbol case) -------
{
  const linear = parseEquation("y = m*x + b");
  if (!linear.ok) throw new Error("parse");
  const withoutX = withoutSymbol(linear.tree, "x");
  check(
    "removing x from y = mx + b rebuilds to y = b",
    !!withoutX && printNode(withoutX.left) === "y" && printNode(withoutX.right) === "b",
    withoutX ? `${printNode(withoutX.left)} = ${printNode(withoutX.right)}` : "null"
  );
  const surface = parseEquation("z = x^2 + y^2");
  if (!surface.ok) throw new Error("parse");
  const withoutY = withoutSymbol(surface.tree, "y");
  check(
    "removing y from z = x² + y² keeps z = x²",
    !!withoutY && printNode(withoutY.right) === "x²",
    withoutY ? printNode(withoutY.right) : "null"
  );
  const lone = parseEquation("x^2 = 4");
  if (!lone.ok) throw new Error("parse");
  const emptied = withoutSymbol(lone.tree, "x");
  check(
    "a side emptied by removal becomes 0 (the relation survives)",
    !!emptied && printNode(emptied.left) === "0",
    emptied ? printNode(emptied.left) : "null"
  );
  const trivial = parseEquation("x = 2*x");
  if (!trivial.ok) throw new Error("parse");
  check("removal that erases the whole equation is refused", withoutSymbol(trivial.tree, "x") === null);
  const contradiction = parseEquation("x = x + 1");
  if (!contradiction.ok) throw new Error("parse");
  const zeroOne = withoutSymbol(contradiction.tree, "x");
  check(
    "removal that leaves a constant relation is honest (0 = 1)",
    !!zeroOne && printNode(zeroOne.left) === "0" && printNode(zeroOne.right) === "1",
    zeroOne ? `${printNode(zeroOne.left)} = ${printNode(zeroOne.right)}` : "null"
  );
}

// --- Free vs bound occurrences (I1): a bounded ∫ binds its dummy ------------
{
  const names = (set: Set<string>) => Array.from(set).sort().join(",");

  // y = ∫₀² 2x dx — x was consumed by the definite integral
  const definite = ensureTreeEqIds({
    left: tv("y"),
    right: tint(tmul(tc(2), tv("x")), "x", { lower: tc(0), upper: tc(2) }),
  });
  check("a bounded ∫ binds its dummy", names(freeVarsIn(definite.right)) === "",
    names(freeVarsIn(definite.right)));
  check("relation symbols exclude the spent dummy",
    analyzeRelation(definite).symbols.join(",") === "y",
    analyzeRelation(definite).symbols.join(","));
  check("calculus candidates skip the spent dummy",
    analyzeRelation(definite).calculusCandidates.every((c) => c.withRespectTo !== "x"));

  // The symbol book follows: x's record leaves, and edges pointing at it prune
  const prior = symbolsInEquation(eq("y = 2*x"));
  check("the book prunes the consumed symbol",
    reconcileSymbols(definite, prior).map((r) => r.name).sort().join(",") === "y",
    reconcileSymbols(definite, prior).map((r) => r.name).sort().join(","));
  const declared = prior.map((r) => (r.name === "y" ? { ...r, dependsOn: ["x"] } : r));
  const yRecord = reconcileSymbols(definite, declared).find((r) => r.name === "y");
  check("declared edges to a consumed symbol prune with it", !!yRecord && !yRecord.dependsOn);

  // y = x + ∫₀² x dx — the same name both free and bound stays a symbol
  const mixed = ensureTreeEqIds({
    left: tv("y"),
    right: tadd(tv("x"), tint(tv("x"), "x", { lower: tc(0), upper: tc(2) })),
  });
  check("mixed free+bound occurrence keeps the symbol", names(freeVarsIn(mixed.right)) === "x",
    names(freeVarsIn(mixed.right)));
  const strippedMixed = withoutSymbol(mixed, "x");
  check("withoutSymbol drops only the free-mention addends",
    !!strippedMixed && !freeVarsIn(strippedMixed.right).has("x") &&
      printNode(strippedMixed.right) !== "0",
    strippedMixed ? printNode(strippedMixed.right) : "null");

  // y = ∫₀ᵘ sin(t) dt — t bound, u born at the bound
  const accumulation = ensureTreeEqIds({
    left: tv("y"),
    right: tint(tfn("sin", tv("t")), "t", { lower: tc(0), upper: tv("u") }),
  });
  check("accumulation: dummy bound, bound symbol born",
    analyzeRelation(accumulation).symbols.join(",") === "u,y",
    analyzeRelation(accumulation).symbols.join(","));

  // Unbounded forms still vary with their dummy — nothing was consumed yet
  const inert = ensureTreeEqIds({ left: tv("y"), right: tint(tpow(tv("x"), tc(2)), "x") });
  check("an unbounded inert ∫ keeps its dummy free", names(freeVarsIn(inert.right)) === "x",
    names(freeVarsIn(inert.right)));
  const derivative = ensureTreeEqIds({ left: tv("y"), right: tdiff(tpow(tv("x"), tc(2)), "x") });
  check("a derivative keeps its dummy free", names(freeVarsIn(derivative.right)) === "x",
    names(freeVarsIn(derivative.right)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
