/** Regression checks for tree-native move → paper state → simplify replay. */
import { computeTreeOperation } from "../src/tools/equation-builder/operations";
import { parseEquation } from "../src/tools/equation-builder/parse";
import { decodeHistory, encodeHistory, type MoveStory } from "../src/tools/equation-builder/share";
import {
  treeActorDestinationTerm,
  treeAnimationStages,
  treeMoveStory,
} from "../src/tools/equation-builder/treeanimation";
import { addendsOf, printNode, printTreeEq, type TNode, type TreeEq } from "../src/tools/equation-builder/tree";
import { treeFactorLayout } from "../src/tools/equation-builder/treeunits";

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

const idsOf = (tree: TreeEq): string[] => {
  const ids: string[] = [];
  const walk = (node: TNode) => {
    ids.push(node.id);
    if (node.kind === "add") node.terms.forEach(walk);
    else if (node.kind === "mul") node.factors.forEach(walk);
    else if (node.kind === "pow") {
      walk(node.base);
      walk(node.exp);
    } else if (node.kind === "fn") walk(node.arg);
  };
  walk(tree.left);
  walk(tree.right);
  return ids;
};

const story: MoveStory = {
  actors: [{ term: "factor:source:n:actor", role: "coef" }],
  site: [],
  born: [],
  kind: "divide",
  to: "left",
};

console.log("\n== literal paper states ==");
{
  const tree = parsed("e^5/x = 3*e^2*sin(y)");
  const right = treeFactorLayout(tree.right.id, tree.right);
  const three = right.numerator.find((unit) => printNode(unit.expr) === "3")!;
  const outcome = computeTreeOperation(
    tree,
    { kind: "coef", termId: three.id, from: "right" },
    { kind: "side", side: "left" }
  );
  if (!outcome || typeof outcome === "string") throw new Error(String(outcome));
  const plannedStory = treeMoveStory(
    tree,
    { kind: "coef", termId: three.id, from: "right" },
    { kind: "side", side: "left" }
  );
  check(
    "A1 division records the unreduced equation",
    printTreeEq(outcome.treeIntermediate!) === "e^5/x/3 = 3e^2·sin(y)/3",
    printTreeEq(outcome.treeIntermediate!)
  );
  check(
    "A2 the canonical result remains the history state",
    printTreeEq(outcome.treeNext) === "e^5/(3x) = e^2·sin(y)",
    printTreeEq(outcome.treeNext)
  );
  const ids = idsOf(outcome.treeIntermediate!);
  check("A3 the paper state is a valid unique-id tree", ids.length === new Set(ids).size);

  const stages = treeAnimationStages(outcome.treeNext, outcome.treeIntermediate, story);
  check("A4 replay emits move then simplify", stages.map((stage) => stage.kind).join(",") === "move,simplify");
  check("A5 only the move stage carries the actor", stages[0].story === story && stages[1].story?.kind === "simplify");
  check(
    "A6 the planner names the exact grabbed handle and destination",
    plannedStory.actors[0]?.term === three.id &&
      plannedStory.actors[0]?.role === "coef" &&
      plannedStory.kind === "divide" &&
      plannedStory.to === "left" &&
      plannedStory.sink === tree.left.id
  );

  const encoded = encodeHistory({
    steps: [{ label: outcome.label, tree: outcome.treeNext, intermediateTree: outcome.treeIntermediate, story }],
  });
  const restored = decodeHistory(encoded)?.steps[0];
  check(
    "A7 shared histories preserve the paper state",
    !!restored?.intermediateTree && printTreeEq(restored.intermediateTree) === printTreeEq(outcome.treeIntermediate!)
  );
}

console.log("\n== actor continuity ==");
{
  const tree = parsed("x + 3 = 7");
  const three = addendsOf(tree.left).find((node) => printNode(node) === "3")!;
  const outcome = computeTreeOperation(
    tree,
    { kind: "terms", ids: [three.id], from: "left" },
    { kind: "side", side: "right" }
  );
  if (!outcome || typeof outcome === "string") throw new Error(String(outcome));
  check(
    "B1 the moved addend keeps its semantic id in the destination paper state",
    addendsOf(outcome.treeIntermediate!.right).some((node) => node.id === three.id)
  );
  check("B2 the paper state shows the carried term", printTreeEq(outcome.treeIntermediate!) === "x = 7 − 3");
  check("B3 simplification happens afterward", printTreeEq(outcome.treeNext) === "x = 4");

  const destination = treeActorDestinationTerm(
    [
      { term: "old-e2", text: "e", role: "numer", side: "right" },
      { term: "old-e2", text: "2", role: "numer", side: "right" },
    ],
    [
      { term: "source-e2", text: "e", role: "numer", side: "right" },
      { term: "source-e2", text: "2", role: "numer", side: "right" },
      { term: "target-e2", text: "e", role: "den", side: "left" },
      { term: "target-e2", text: "2", role: "den", side: "left" },
    ],
    { actors: [], site: [], born: [], kind: "divide", to: "left" }
  );
  check("B4 a re-zoned factor resolves only on its recorded target side", destination === "target-e2");
  check(
    "B5 partial glyph aliases cannot become a destination",
    treeActorDestinationTerm(
      [{ term: "old", text: "e", role: "numer", side: "right" }],
      [
        { term: "wrong", text: "e", role: "den", side: "left" },
        { term: "wrong", text: "2", role: "den", side: "left" },
      ],
      { actors: [], site: [], born: [], kind: "divide", to: "left" }
    ) === null
  );
}

console.log("\n== no fake simplify beat ==");
{
  const tree = parsed("x = y");
  const stages = treeAnimationStages(tree, tree, story);
  check("C1 an already-canonical state uses one move stage", stages.length === 1 && stages[0].kind === "move");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
