/** Architectural invariants for the canonical equation tree. */
import { leaf } from "../src/tools/equation-builder/model";
import { computeTreeOperation } from "../src/tools/equation-builder/operations";
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
  check("A6 legacy flat share payloads remain readable", decodeHistory(oldLink)?.steps[0].state?.left[0].num === 2);
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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
