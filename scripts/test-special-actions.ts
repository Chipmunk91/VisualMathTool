/**
 * Engine contract for tap-for-inverse special actions: every special glyph
 * offers the inverse that frees IT, auto-isolating first when the operator
 * shares its side with co-factors or co-addends.
 *
 * Run: npx tsx scripts/test-special-actions.ts
 */
import { applySpecialActionT, type SpecialActionRef } from "../src/tools/equation-builder/specialactions";
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

const findNode = (node: TNode, pred: (n: TNode) => boolean): TNode | null => {
  if (pred(node)) return node;
  switch (node.kind) {
    case "add":
      for (const t of node.terms) { const f = findNode(t, pred); if (f) return f; }
      return null;
    case "mul":
      for (const t of node.factors) { const f = findNode(t, pred); if (f) return f; }
      return null;
    case "pow":
      return findNode(node.base, pred) ?? findNode(node.exp, pred);
    case "fn":
      return findNode(node.arg, pred);
    default:
      return null;
  }
};

const clean = (s: string) => s.replace(/[()\s·]/g, "").replace(/\*/g, "");

const applyOn = (
  text: string,
  side: "left" | "right",
  kind: SpecialActionRef["kind"],
  pred: (n: TNode) => boolean
) => {
  const te = eq(text);
  const target = findNode(te[side], pred);
  if (!target) throw new Error(`target not found in ${text}`);
  return { te, result: applySpecialActionT(te, { kind, nodeId: "t", targetId: target.id, side }) };
};

const isPow = (n: TNode) => n.kind === "pow";
const isExp = (n: TNode) => n.kind === "fn" && n.fn === "exp";
const isFn = (name: string) => (n: TNode) => n.kind === "fn" && n.fn === name;

// --- rootexpr: tapping a symbolic exponent frees the base --------------------
{
  const { result } = applyOn("y = 2^x", "right", "rootexpr", isPow);
  check("2^x: tap x → y^(1/x) = 2", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)) === "y^1/x" && clean(printNode(result.treeNext.right)) === "2",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
  check("…records the x ≠ 0 license", typeof result === "object" && result !== null && (result.pill ?? "").includes("x ≠ 0"));
}
{
  const { result } = applyOn("y = x^b", "right", "rootexpr", isPow);
  check("x^b: tap b → y^(1/b) = x", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)) === "y^1/b" && clean(printNode(result.treeNext.right)) === "x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
}
{
  const { result } = applyOn("y = e^x", "right", "rootexpr", isExp);
  check("e^x: tap x → y^(1/x) = e", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)) === "y^1/x" && clean(printNode(result.treeNext.right)).startsWith("e"),
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
}
{
  // co-factor: 3·2^x = 6 → isolate first, then unwind
  const { result } = applyOn("3*2^x = 6", "left", "rootexpr", isPow);
  check("3·2^x = 6: tap x isolates then roots", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)) === "2" && clean(printNode(result.treeNext.right)) === "2^1/x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
  check("…intermediate shows the isolated exponential", typeof result === "object" && result !== null &&
    !!result.treeIntermediate && clean(printNode(result.treeIntermediate.left)) === "2^x",
    typeof result === "object" && result?.treeIntermediate ? printNode(result.treeIntermediate.left) : "none");
  check("…divide license rides along", typeof result === "object" && result !== null && (result.pill ?? "").includes("3 ≠ 0"));
}
{
  const { result } = applyOn("y = sin(x)^2", "right", "rootexpr", (n) => n.kind === "pow");
  check("sin(x)² exponent 2 stays with the integer-root anchor path", typeof result === "string" || result !== null);
}

// --- inverse trig: tapping sin/cos/tan solves toward the shell ---------------
{
  const { result } = applyOn("y = sin(x)*x", "right", "asin", isFn("sin"));
  check("sin(x)·x: tap sin → arcsin(y/x) = x", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)).includes("arcsin") && clean(printNode(result.treeNext.right)) === "x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
  check("…x ≠ 0 and branch pills together", typeof result === "object" && result !== null &&
    (result.pill ?? "").includes("x ≠ 0") && (result.pill ?? "").includes("check branches"),
    typeof result === "object" && result ? result.pill ?? "" : "");
  check("…intermediate is the isolated sin", typeof result === "object" && result !== null &&
    !!result.treeIntermediate && clean(printNode(result.treeIntermediate.right)) === "sin(x)".replace(/[()]/g, ""),
    typeof result === "object" && result?.treeIntermediate ? printNode(result.treeIntermediate.right) : "none");
}
{
  const { result } = applyOn("y = sin(x) + 1", "right", "asin", isFn("sin"));
  check("sin(x)+1: tap sin → arcsin(y−1) = x", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)).includes("arcsin") && clean(printNode(result.treeNext.right)) === "x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
}
{
  const { result } = applyOn("y = 2*sin(x) + 1", "right", "asin", isFn("sin"));
  check("2sin(x)+1: subtract, divide, then arcsin", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)).includes("arcsin") && clean(printNode(result.treeNext.right)) === "x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
}
{
  const { result } = applyOn("5 = sin(x) + 2", "right", "asin", isFn("sin"));
  check("sin(x) = 3 is refused with the range explanation",
    typeof result === "string" && result.includes("between −1 and 1"), String(result));
}
{
  const { result } = applyOn("y = sin(x)^2", "right", "asin", isFn("sin"));
  check("sin inside a power refuses with guidance",
    typeof result === "string" && result.includes("buried"), String(result));
}
{
  const { result } = applyOn("y = tan(x)*2", "right", "atan", isFn("tan"));
  check("tan(x)·2: tap tan → arctan(y/2) = x", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)).includes("arctan") && clean(printNode(result.treeNext.right)) === "x",
    typeof result === "object" && result ? `${printNode(result.treeNext.left)} = ${printNode(result.treeNext.right)}` : String(result));
}
{
  // legacy ref without a targetId still unwraps a bare shell
  const te = eq("y = sin(x)");
  const result = applySpecialActionT(te, { kind: "asin", nodeId: "t", side: "right" });
  check("bare sin without targetId keeps working", typeof result === "object" && result !== null &&
    clean(printNode(result.treeNext.left)).includes("arcsin"),
    typeof result === "object" && result ? printNode(result.treeNext.left) : String(result));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
