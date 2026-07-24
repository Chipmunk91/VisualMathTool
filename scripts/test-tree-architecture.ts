/** Architectural invariants for the canonical equation tree. */
import { group, leaf } from "../src/tools/equation-builder/model";
import { computeTreeOperation, previewTreeOperation } from "../src/tools/equation-builder/operations";
import {
  equationRevision,
  makeEquationDocument,
  reconcileSymbols,
  renameSymbol,
  symbolsInEquation,
} from "../src/tools/equation-builder/document";
import { applyEquationCommand, listApplicableEquationOperations } from "../src/tools/equation-builder/engine";
import {
  differentiateRelation,
  integrateRelation,
  validateCalculusContext,
} from "../src/tools/equation-builder/calculus";
import {
  analyzeRelation,
  isViewSpecValid,
  unambiguousView,
} from "../src/tools/equation-builder/relation";
import { marchingSquaresContour } from "../src/tools/equation-builder/multivariable";
import { parseEquation } from "../src/tools/equation-builder/parse";
import { toggleTreeFactorSelection } from "../src/tools/equation-builder/selection";
import { decodeHistory, encodeHistory } from "../src/tools/equation-builder/share";
import {
  type TNode,
  type TreeEq,
  addendsOf,
  cloneTreeEq,
  ensureTreeEqIds,
  keyOf,
  printNode,
  printTreeEq,
  simplify,
  tadd,
  tc,
  tfn,
  tmul,
  tnamed,
  tpow,
  tv,
} from "../src/tools/equation-builder/tree";
import { moveTermsT, type TreeOutcome } from "../src/tools/equation-builder/treemoves";
import { resolveTreeFactorGroup, treeFactorLayout } from "../src/tools/equation-builder/treeunits";

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? `  [${detail}]` : ""}`);
  condition ? passed++ : failed++;
};

const parsed = (text: string): TreeEq => {
  const result = parseEquation(text);
  if (!result.ok) throw new Error(`${text}: ${result.message}`);
  return result.tree;
};

const walk = (node: TNode, visit: (node: TNode) => void) => {
  visit(node);
  if (node.kind === "add") node.terms.forEach((child) => walk(child, visit));
  else if (node.kind === "mul") node.factors.forEach((child) => walk(child, visit));
  else if (node.kind === "pow") {
    walk(node.base, visit);
    walk(node.exp, visit);
  } else if (node.kind === "fn") walk(node.arg, visit);
  else if (node.kind === "derivative") walk(node.expression, visit);
  else if (node.kind === "integral") {
    walk(node.integrand, visit);
    if (node.bounds) {
      walk(node.bounds.lower, visit);
      walk(node.bounds.upper, visit);
    }
  }
};

const idsOf = (tree: TreeEq): string[] => {
  const ids: string[] = [];
  walk(tree.left, (node) => ids.push(node.id));
  walk(tree.right, (node) => ids.push(node.id));
  return ids;
};

const firstIdDifference = (a: TNode, b: TNode, path = "root"): string => {
  if (a.id !== b.id) return `${path}: ${a.kind} ${a.id} -> ${b.id}`;
  if (a.kind === "add" && b.kind === "add") {
    for (let i = 0; i < a.terms.length; i++) {
      const found = firstIdDifference(a.terms[i], b.terms[i], `${path}.terms[${i}]`);
      if (found) return found;
    }
  } else if (a.kind === "mul" && b.kind === "mul") {
    for (let i = 0; i < a.factors.length; i++) {
      const found = firstIdDifference(a.factors[i], b.factors[i], `${path}.factors[${i}]`);
      if (found) return found;
    }
  } else if (a.kind === "pow" && b.kind === "pow") {
    return firstIdDifference(a.base, b.base, `${path}.base`) || firstIdDifference(a.exp, b.exp, `${path}.exp`);
  } else if (a.kind === "fn" && b.kind === "fn") {
    return firstIdDifference(a.arg, b.arg, `${path}.arg`);
  } else if (a.kind === "derivative" && b.kind === "derivative") {
    return firstIdDifference(a.expression, b.expression, `${path}.expression`);
  } else if (a.kind === "integral" && b.kind === "integral") {
    return firstIdDifference(a.integrand, b.integrand, `${path}.integrand`);
  }
  return "";
};

console.log("\n== canonical runtime ==");
{
  const result = parseEquation("2*x - 3 = -7");
  check("A1 parser returns the tree contract", result.ok && "tree" in result);
  check("A2 parser no longer returns a flat runtime state", result.ok && !("state" in result));

  const tree = parsed("e^5/x = 3*e^2*sin(y)");
  const ids = idsOf(tree);
  check("A3 every AST occurrence has a unique semantic id", ids.length === new Set(ids).size);
  check("A4 cloning preserves every semantic id", JSON.stringify(idsOf(cloneTreeEq(tree))) === JSON.stringify(ids));

  const legacy = JSON.parse(JSON.stringify(tree)) as Record<string, unknown>;
  const strip = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    delete (value as { id?: string }).id;
    Object.values(value).forEach(strip);
  };
  strip(legacy);
  const hydrated = ensureTreeEqIds(legacy as unknown as TreeEq);
  const hydratedIds = idsOf(hydrated);
  check("A5 id-less shared trees are rehydrated at the boundary", hydratedIds.length > 0 && hydratedIds.length === new Set(hydratedIds).size);

  const oldLink = encodeHistory({ steps: [{ label: "old", state: { left: [leaf(2, 1)], right: [leaf(4)] } }] });
  const oldDecoded = decodeHistory(oldLink);
  check(
    "A6 legacy flat share payloads decode straight to canonical trees",
    !!oldDecoded && printTreeEq(oldDecoded.steps[0].tree) === "2x = 4",
    oldDecoded ? printTreeEq(oldDecoded.steps[0].tree) : "decode failed"
  );

  // The Phase B regression lock: a MULTI-STEP legacy link (group term, pill)
  // must decode with every step carrying a tree — the flat model exists only
  // on the wire, never past the decode boundary.
  const legacyFlatLink = encodeHistory({
    steps: [
      { label: "start", state: { left: [group(2, [leaf(1, 1), leaf(3)])], right: [leaf(10)] } },
      { label: "divided by 2", pill: "2 ≠ 0", state: { left: [leaf(1, 1), leaf(3)], right: [leaf(5)] } },
      { label: "moved 3 across", state: { left: [leaf(1, 1)], right: [leaf(2)] } },
    ],
  });
  const legacyDecoded = decodeHistory(legacyFlatLink);
  check("A6b multi-step legacy flat link decodes every step to a tree",
    !!legacyDecoded && legacyDecoded.steps.every((s) => !!s.tree && !!s.tree.left && !!s.tree.right));
  check(
    "A6c converted steps print the same mathematics",
    !!legacyDecoded &&
      printTreeEq(legacyDecoded.steps[0].tree) === "2(x + 3) = 10" &&
      printTreeEq(legacyDecoded.steps[1].tree) === "x + 3 = 5" &&
      printTreeEq(legacyDecoded.steps[2].tree) === "x = 2",
    legacyDecoded ? legacyDecoded.steps.map((s) => printTreeEq(s.tree)).join(" | ") : "decode failed"
  );
  check("A6d pills survive the conversion", legacyDecoded?.steps[1].pill === "2 ≠ 0");
}

console.log("\n== stable factor identity ==");
{
  const tree = parsed("e^5/x = 3*e^2*sin(y)");
  const right = addendsOf(tree.right)[0];
  const first = treeFactorLayout(right.id, right);
  const second = treeFactorLayout(right.id, right);
  check(
    "B1 repeated layouts mint no new handle identities",
    JSON.stringify(first.numerator.map((unit) => unit.id)) === JSON.stringify(second.numerator.map((unit) => unit.id))
  );
  check(
    "B2 handles encode semantic owners, never L0/R0 positions",
    [...first.numerator, ...first.denominator].every((unit) => unit.id.includes(right.id) && !/^[LR]\d/.test(unit.id))
  );

  const normalized = simplify(tree.right);
  const normalizedAgain = simplify(normalized);
  const layoutA = treeFactorLayout(normalized.id, normalized);
  const layoutB = treeFactorLayout(normalizedAgain.id, normalizedAgain);
  check(
    "B3 an idempotent normalization preserves factor handles",
    JSON.stringify(layoutA.numerator.map((unit) => unit.id)) === JSON.stringify(layoutB.numerator.map((unit) => unit.id))
  );

  const three = first.numerator.find((unit) => printNode(unit.expr) === "3")!;
  const e2 = first.numerator.find((unit) => printNode(unit.expr) === "e^2")!;
  const sin = first.numerator.find((unit) => printNode(unit.expr) === "sin(y)")!;
  let selection = toggleTreeFactorSelection(tree, null, "right", three.id, true);
  selection = toggleTreeFactorSelection(tree, selection, "right", e2.id, true);
  selection = toggleTreeFactorSelection(tree, selection, "right", sin.id, true);
  check("B4 successive touch taps build a three-factor chunk", selection?.termIds.length === 3);
  selection = toggleTreeFactorSelection(tree, selection, "right", e2.id, true);
  check("B5 tapping a selected factor removes only that factor", selection?.termIds.length === 2 && !selection.termIds.includes(e2.id));
  check("B6 the selected subset resolves without precomputed combinations", !!resolveTreeFactorGroup(tree, selection!.termIds));
}

console.log("\n== fixed-point simplification ==");
{
  let seed = 0x5eed1234;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const generate = (depth: number): TNode => {
    if (depth <= 0 || random() < 0.3) {
      return pick([tc(Math.floor(random() * 9) - 4), tv("x"), tv("y"), tnamed("pi")]);
    }
    const next = depth - 1;
    switch (Math.floor(random() * 5)) {
      case 0:
        return tadd(generate(next), generate(next), generate(next));
      case 1:
        return tmul(generate(next), generate(next), generate(next));
      case 2:
        return tpow(generate(next), pick([-3, -2, -1, 1, 2, 3]));
      case 3:
        return tfn(pick(["sin", "cos", "ln", "exp", "sqrt"]), generate(next));
      default:
        return tmul(tc(pick([-3, -2, 2, 3]), pick([1, 1, 2, 3])), generate(next));
    }
  };

  let structuralFailure = "";
  let identityFailure = "";
  for (let i = 0; i < 5000; i++) {
    const once = simplify(generate(4));
    const twice = simplify(once);
    if (!structuralFailure && keyOf(once) !== keyOf(twice)) {
      structuralFailure = `${printNode(once)} -> ${printNode(twice)}`;
    }
    if (!identityFailure && JSON.stringify(once) !== JSON.stringify(twice)) {
      identityFailure = `${printNode(once)} — ${firstIdDifference(once, twice)}`;
    }
  }
  check("C1 5,000 generated trees reach a structural fixed point", structuralFailure === "", structuralFailure);
  check("C2 the fixed point also preserves node identities", identityFailure === "", identityFailure);
}

console.log("\n== operation boundary ==");
{
  const tree = parsed("e^5/x = 3*e^2*sin(y)");
  const right = addendsOf(tree.right)[0];
  const layout = treeFactorLayout(right.id, right);
  const three = layout.numerator.find((unit) => printNode(unit.expr) === "3")!;
  const e2 = layout.numerator.find((unit) => printNode(unit.expr) === "e^2")!;
  const sin = layout.numerator.find((unit) => printNode(unit.expr) === "sin(y)")!;

  const divided = computeTreeOperation(tree, { kind: "coef", termId: three.id, from: "right" }, { kind: "side", side: "left" });
  check(
    "D1 moving 3 lands in the left denominator",
    !!divided && typeof divided !== "string" && printTreeEq(divided.treeNext) === "e^5/(3x) = e^2·sin(y)",
    divided && typeof divided !== "string" ? printTreeEq(divided.treeNext) : String(divided)
  );

  const group = computeTreeOperation(
    tree,
    { kind: "factorGroup", ids: [e2.id, sin.id], from: "right" },
    { kind: "side", side: "left" }
  );
  check(
    "D2 a selected multiplied chunk moves as one exact product",
    !!group && typeof group !== "string" && printTreeEq(group.treeNext) === "e^3/(x·sin(y)) = 3"
  );
  check(
    "D3 tree outcomes contain no flat escape hatch",
    !!group && typeof group !== "string" && !("flatNext" in (group as TreeOutcome))
  );

  const additive = parsed("x + 3 = 7");
  const [x] = addendsOf(additive.left);
  const moved = moveTermsT(additive, [x.id], "left", "right");
  check(
    "D4 operations address addends by semantic id after normalization",
    !!moved && typeof moved !== "string" && printTreeEq(moved.treeNext) === "3 = −x + 7"
  );
  const additivePreview = previewTreeOperation(
    additive,
    { kind: "terms", ids: [x.id], from: "left" },
    { kind: "under", termId: addendsOf(additive.right)[0].id, side: "right" }
  );
  check(
    "D5 dividing a whole-addend x has the same inline preview as an x factor",
    additivePreview?.kind === "divide" && additivePreview.text === "x",
    JSON.stringify(additivePreview)
  );
}

console.log("\n== equation document and AI command contract ==");
{
  const arbitrary = parsed("force = mass*acceleration");
  const symbols = symbolsInEquation(arbitrary);
  check(
    "E1 arbitrary identifiers become symbol records",
    ["acceleration", "force", "mass"].every((name) => symbols.some((symbol) => symbol.name === name)),
    symbols.map((symbol) => symbol.name).join(", ")
  );
  const mass = symbols.find((symbol) => symbol.name === "mass")!;
  const authored = symbols.map((symbol) =>
    symbol.id === mass.id ? { ...symbol, meaning: "inertial mass" } : symbol
  );
  const reconciled = reconcileSymbols(parsed("force = 2*mass*acceleration"), authored);
  check(
    "E2 authored symbol metadata survives reparsing",
    reconciled.find((symbol) => symbol.id === mass.id)?.meaning === "inertial mass"
  );
  const document = makeEquationDocument(arbitrary, { symbols: authored });
  check(
    "E3 document revision is deterministic and includes symbol metadata",
    document.revision === equationRevision(arbitrary) && document.symbols.length === 3
  );

  const movable = parsed("3*x = y");
  const factor = treeFactorLayout(movable.left.id, movable.left).numerator.find((unit) => printNode(unit.expr) === "3")!;
  const request = {
    requestId: "architecture-test",
    expectedRevision: equationRevision(movable),
    actor: { kind: "ai" as const, name: "test-agent" },
    command: {
      type: "gesture" as const,
      payload: { kind: "coef" as const, termId: factor.id, from: "left" as const },
      target: { kind: "side" as const, side: "right" as const },
    },
  };
  const applied = applyEquationCommand(movable, request);
  const available = listApplicableEquationOperations(movable);
  check(
    "E4 AI can discover concrete legal operations without pointer geometry",
    available.some((operation) => operation.command.type === "gesture" && operation.label === "Divide both sides by 3")
  );
  check(
    "E5 AI and pointer operations share one semantic dispatcher",
    applied.status === "applied" && printTreeEq(applied.outcome.treeNext) === "x = y/3"
  );
  check(
    "E6 applied commands produce replayable provenance",
    applied.status === "applied" &&
      applied.event.actor.kind === "ai" &&
      applied.event.operation.ruleId === "gesture.coef.side" &&
      applied.event.beforeRevision === request.expectedRevision
  );
  const stale = applyEquationCommand(movable, { ...request, expectedRevision: "rev_stale" });
  check("E7 stale AI writes are rejected", stale.status === "stale");

  const sharedV2 = encodeHistory({
    schemaVersion: 2,
    document: {
      documentId: document.documentId,
      revision: document.revision,
      symbols: document.symbols,
      assumptions: [],
    },
    steps: [{ label: "start", tree: arbitrary }],
  });
  check(
    "E8 share v2 preserves the symbol book",
    decodeHistory(sharedV2)?.document?.symbols.find((symbol) => symbol.id === mass.id)?.meaning === "inertial mass"
  );
  const sharedV3 = encodeHistory({
    schemaVersion: 3,
    document: {
      documentId: document.documentId,
      revision: document.revision,
      symbols: document.symbols,
      assumptions: [],
      presentation: {
        viewSpec: {
          kind: "function-1d",
          input: "acceleration",
          output: "force",
          fixed: { mass: 1 },
        },
        lastDifferentiationContext: {
          mode: "partial",
          withRespectTo: "acceleration",
          dependent: ["force"],
          heldConstant: ["mass"],
        },
      },
    },
    steps: [{ label: "start", tree: arbitrary }],
  });
  const restoredV3 = decodeHistory(sharedV3);
  check(
    "E9 share v3 preserves contextual view and calculus choices",
    restoredV3?.document?.presentation?.viewSpec?.kind === "function-1d" &&
      restoredV3.document.presentation.lastDifferentiationContext?.heldConstant[0] === "mass"
  );
}

console.log("\n== symmetric relation analysis and contextual views ==");
{
  const forward = analyzeRelation(parsed("y = sin(t)"));
  const reversed = analyzeRelation(parsed("sin(t) = y"));
  check(
    "F1 explicit interpretation is independent of equation side",
    forward.isolations[0]?.output === "y" && forward.isolations[0]?.inputs.join() === "t" &&
      reversed.isolations[0]?.output === "y" && reversed.isolations[0]?.inputs.join() === "t"
  );
  const swapped = analyzeRelation(parsed("x = y^2"));
  check(
    "F2 no x/y role convention overrides actual structure",
    swapped.isolations[0]?.output === "x" && swapped.isolations[0]?.inputs.join() === "y"
  );
  const implicit = analyzeRelation(parsed("x^2 + y^2 = 1"));
  const implicitView = unambiguousView(implicit);
  check(
    "F3 a two-symbol unsolved relation becomes an implicit 2-D candidate",
    implicitView?.kind === "implicit-2d" && isViewSpecValid(implicitView, implicit)
  );
  const field = analyzeRelation(parsed("y = s*t"));
  const fieldView = unambiguousView(field);
  check(
    "F4 a two-input explicit relation becomes a scalar field without choosing one input",
    fieldView?.kind === "scalar-field-2d" && fieldView.output === "y" &&
      new Set([fieldView.horizontal, fieldView.vertical]).size === 2
  );
  const legacy = symbolsInEquation(parsed("x = y")) as Array<Record<string, unknown>>;
  legacy[0].role = "independent";
  legacy[0].domain = "real";
  legacy[1].dependsOn = [legacy[0].id];
  const migrated = reconcileSymbols(parsed("x = y"), legacy as never);
  check(
    "F5 legacy role/domain/dependency metadata is removed instead of becoming stale",
    migrated.every((record) => !("role" in record) && !("domain" in record) && !("dependsOn" in record))
  );
  const circleContour = marchingSquaresContour((x, y) => x * x + y * y - 1);
  const contourError = Math.max(...circleContour.flatMap((segment) => [segment.a, segment.b])
    .map((point) => Math.abs(point.x * point.x + point.y * point.y - 1)));
  check(
    "F6 implicit graphing traces the zero contour instead of solving for an axis",
    circleContour.length > 20 && contourError < 0.02,
    `segments=${circleContour.length}, max error=${contourError}`
  );
}

console.log("\n== explicit multivariable calculus contexts ==");
{
  const relation = parsed("y = s*t");
  const incomplete = {
    mode: "partial" as const,
    withRespectTo: "s",
    dependent: ["y"],
    heldConstant: [] as string[],
  };
  check(
    "G1 calculus refuses an unclassified symbol",
    !validateCalculusContext(relation, incomplete).ok
  );
  check(
    "G1b a one-variable equation is not silently treated as an identity",
    !validateCalculusContext(parsed("x^2 = 1"), {
      mode: "ordinary",
      withRespectTo: "x",
      dependent: [],
      heldConstant: [],
    }).ok
  );
  const partialContext = { ...incomplete, heldConstant: ["t"] };
  const partial = differentiateRelation(relation, partialContext);
  check(
    "G2 partial differentiation preserves the operator and held-constant choice",
    typeof partial !== "string" && printTreeEq(partial.equation) === "∂(y)/∂s = t",
    typeof partial === "string" ? partial : printTreeEq(partial.equation)
  );

  const circle = parsed("x^2 + y^2 = 1");
  const implicit = differentiateRelation(circle, {
    mode: "implicit",
    withRespectTo: "x",
    dependent: ["y"],
    heldConstant: [],
  });
  check(
    "G3 implicit differentiation emits dy/dx as an algebraic factor",
    typeof implicit !== "string" && printTreeEq(implicit.equation).includes("d(y)/dx") &&
      printTreeEq(implicit.equation).endsWith("= 0"),
    typeof implicit === "string" ? implicit : printTreeEq(implicit.equation)
  );

  const integrated = integrateRelation(parsed("a*x = y"), {
    mode: "ordinary",
    withRespectTo: "x",
    dependent: ["y"],
    heldConstant: ["a"],
  });
  check(
    "G4 integration keeps dependent expressions under an integral and records C",
    typeof integrated !== "string" && printTreeEq(integrated.equation).includes("∫ y dx") &&
      printTreeEq(integrated.equation).includes("C"),
    typeof integrated === "string" ? integrated : printTreeEq(integrated.equation)
  );

  const command = applyEquationCommand(circle, {
    requestId: "implicit-calculus-test",
    expectedRevision: equationRevision(circle),
    actor: { kind: "ai", name: "test-agent" },
    command: {
      type: "differentiate",
      context: {
        mode: "implicit",
        withRespectTo: "x",
        dependent: ["y"],
        heldConstant: [],
      },
    },
  });
  check(
    "G5 AI calculus uses the same explicit-context command and trace",
    command.status === "applied" && command.event.operation.ruleId === "calculus.differentiate.implicit"
  );

  const ordinary = differentiateRelation(parsed("y = x^2"), {
    mode: "ordinary",
    withRespectTo: "x",
    dependent: ["y"],
    heldConstant: [],
  });
  check(
    "G6 ordinary differentiation also keeps dy/dx as notation",
    typeof ordinary !== "string" && printTreeEq(ordinary.equation) === "d(y)/dx = 2x",
    typeof ordinary === "string" ? ordinary : printTreeEq(ordinary.equation)
  );
  check(
    "G6b unresolved calculus operators do not advertise a numeric graph",
    typeof ordinary !== "string" && analyzeRelation(ordinary.equation).viewCandidates.length === 0
  );

  const total = differentiateRelation(relation, {
    mode: "total",
    withRespectTo: "s",
    dependent: ["t", "y"],
    heldConstant: [],
  });
  check(
    "G7 total differentiation retains the chain contribution dt/ds",
    typeof total !== "string" && printTreeEq(total.equation).includes("d(t)/ds"),
    typeof total === "string" ? total : printTreeEq(total.equation)
  );

  // Definite integration now EVALUATES known primitives (the fundamental
  // theorem) — the inert bounded ∫ survives only where the whitelist ends,
  // and that is where the bounds must remain first-class operator data.
  const definite = integrateRelation(parsed("e^(x^2) = 1"), {
    mode: "ordinary",
    withRespectTo: "x",
    dependent: [],
    heldConstant: [],
    treatAsIdentity: true,
    bounds: [0, 1],
  });
  check(
    "G8 an unevaluable definite ∫ preserves both bounds as first-class operator data",
    typeof definite !== "string" && printTreeEq(definite.equation).includes("∫_[0,1]") &&
      !printTreeEq(definite.equation).includes("C"),
    typeof definite === "string" ? definite : printTreeEq(definite.equation)
  );
  const evaluated = integrateRelation(parsed("x = 1"), {
    mode: "ordinary",
    withRespectTo: "x",
    dependent: [],
    heldConstant: [],
    treatAsIdentity: true,
    bounds: [0, 1],
  });
  check(
    "G8b a known primitive evaluates at the bounds (fundamental theorem)",
    typeof evaluated !== "string" && printTreeEq(evaluated.equation) === "1/2 = 1",
    typeof evaluated === "string" ? evaluated : printTreeEq(evaluated.equation)
  );

  const renameSeed = parsed("y = x^2");
  const originalX = symbolsInEquation(renameSeed).find((symbol) => symbol.name === "x")!;
  const renamed = renameSymbol(renameSeed, originalX.id, "time");
  const renamedDerivative = differentiateRelation(renamed, {
    mode: "ordinary",
    withRespectTo: "time",
    dependent: ["y"],
    heldConstant: [],
  });
  const renamedRecords = typeof renamedDerivative === "string"
    ? []
    : symbolsInEquation(renamedDerivative.equation).filter((symbol) => symbol.name === "time");
  check(
    "G9 calculus notation preserves a renamed symbol's stable identity",
    renamedRecords.length === 1 && renamedRecords[0].id === originalX.id,
    JSON.stringify(renamedRecords)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
