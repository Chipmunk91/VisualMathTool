import { parse as mathParse, type MathNode } from "mathjs";
import {
  ensureTreeEqIds,
  simplify,
  tadd,
  tc,
  tfn,
  tmul,
  tnamed,
  tpow,
  tv,
  type TNode,
  type TreeEq,
} from "./tree";

/** Pure text-to-tree parser used by the browser, tests, and protocol servers. */
class Unsupported extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any; // mathjs AST nodes, accessed structurally

function ratFromNumber(value: number): { num: number; den: number } {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
    throw new Unsupported("that number is out of range");
  }
  if (Number.isInteger(value)) return { num: value, den: 1 };
  const places = Math.min(6, (String(value).split(".")[1] ?? "").length || 6);
  const den = 10 ** places;
  return { num: Math.round(value * den), den };
}

/** A purely numeric subtree becomes a rational value. */
function tryConst(node: Node): { num: number; den: number } | null {
  switch (node.type) {
    case "ConstantNode":
      return typeof node.value === "number" ? ratFromNumber(node.value) : null;
    case "ParenthesisNode":
      return tryConst(node.content);
    case "OperatorNode": {
      if (node.op === "-" && node.args.length === 1) {
        const value = tryConst(node.args[0]);
        return value ? { num: -value.num, den: value.den } : null;
      }
      if (node.args.length !== 2) return null;
      const left = tryConst(node.args[0]);
      const right = tryConst(node.args[1]);
      if (!left || !right) return null;
      if (node.op === "/") {
        return right.num === 0
          ? null
          : { num: left.num * right.den, den: left.den * right.num };
      }
      if (node.op === "*") return { num: left.num * right.num, den: left.den * right.den };
      if (node.op === "+") {
        return { num: left.num * right.den + right.num * left.den, den: left.den * right.den };
      }
      if (node.op === "-") {
        return { num: left.num * right.den - right.num * left.den, den: left.den * right.den };
      }
      return null;
    }
    default:
      return null;
  }
}

const unwrapParens = (node: Node): Node =>
  node.type === "ParenthesisNode" ? unwrapParens(node.content) : node;

const TREE_FN = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  arcsin: "asin",
  acos: "acos",
  arccos: "acos",
  atan: "atan",
  arctan: "atan",
  ln: "ln",
  log: "ln",
  exp: "exp",
  sqrt: "sqrt",
} as const;

type VariableName = string;

/**
 * mathjs reads pencil-style `xy` as one symbol. Preserve the current explicit
 * compatibility rule: only x/y character products split automatically;
 * arbitrary multi-letter identifiers stay one model symbol.
 */
export function splitVariableProduct(name: string): VariableName[] | null {
  if (name.length < 2) return null;
  const names = Array.from(name);
  return names.every((part): part is VariableName => part === "x" || part === "y")
    ? names
    : null;
}

function mathToTree(node: Node): TNode {
  const constant = tryConst(node);
  if (constant) return tc(constant.num, constant.den);
  switch (node.type) {
    case "SymbolNode":
      if (node.name === "pi" || node.name === "π") return tnamed("pi");
      if (node.name === "e") return tfn("exp", tc(1));
      {
        const variables = splitVariableProduct(node.name);
        if (variables) return tmul(...variables.map((name) => tv(name)));
      }
      return tv(node.name);
    case "ParenthesisNode":
      return mathToTree(node.content);
    case "FunctionNode": {
      const fnName = node.fn?.name;
      const fn = fnName && fnName in TREE_FN
        ? TREE_FN[fnName as keyof typeof TREE_FN]
        : undefined;
      if (!fn || node.args.length !== 1) {
        throw new Unsupported(
          `${node.fn?.name ?? "that function"}( ) isn't playable yet — try sin, cos, tan, arcsin, arccos, arctan, ln, exp, or sqrt`
        );
      }
      const argument = mathToTree(node.args[0]);
      return fn === "sqrt" ? tpow(argument, tc(1, 2)) : tfn(fn, argument);
    }
    case "OperatorNode": {
      if (node.op === "-" && node.args.length === 1) {
        return tmul(tc(-1), mathToTree(node.args[0]));
      }
      const [left, right] = node.args;
      if (node.op === "+") return tadd(mathToTree(left), mathToTree(right));
      if (node.op === "-") return tadd(mathToTree(left), tmul(tc(-1), mathToTree(right)));
      if (node.op === "*") return tmul(mathToTree(left), mathToTree(right));
      if (node.op === "/") return tmul(mathToTree(left), tpow(mathToTree(right), -1));
      if (node.op === "^") {
        if (left.type === "SymbolNode") {
          const variables = splitVariableProduct(left.name);
          if (variables) {
            const last = variables[variables.length - 1];
            return tmul(
              ...variables.slice(0, -1).map((name) => tv(name)),
              tpow(tv(last), mathToTree(right))
            );
          }
        }
        const base = unwrapParens(left);
        if (base.type === "SymbolNode" && base.name === "e") {
          return tfn("exp", mathToTree(right));
        }
        return tpow(mathToTree(left), mathToTree(right));
      }
      throw new Unsupported("that expression isn't playable yet");
    }
    default:
      throw new Unsupported("that expression isn't playable yet");
  }
}

export type ParseResult =
  | { ok: true; tree: TreeEq; dependencies?: Record<string, string[]> }
  | { ok: false; stage: "parse" | "convert"; message: string };

/**
 * Textbook function notation as a dependency DECLARATION: a side that is
 * exactly `y(x)` or `z(x, y)` — an unknown function name applied to plain
 * symbols — declares "y depends on x" and enters the equation as the bare
 * symbol y. Known functions (sin, ln, …) are untouched.
 */
const declarationOf = (node: MathNode): { output: string; inputs: string[] } | null => {
  const ast = node as Node;
  if (ast.type !== "FunctionNode") return null;
  const name = ast.fn?.name;
  if (!name || name in TREE_FN) return null;
  if (name === "e" || name === "pi" || name === "π") return null;
  const inputs: string[] = [];
  for (const argument of ast.args) {
    if (argument.type !== "SymbolNode") return null;
    const input = argument.name;
    if (input === "e" || input === "pi" || input === "π" || input === name) return null;
    if (inputs.includes(input)) return null;
    inputs.push(input);
  }
  return inputs.length > 0 ? { output: name, inputs } : null;
};

export function parseEquation(text: string): ParseResult {
  const sides = text.split("=");
  if (sides.length !== 2 || !sides[0].trim() || !sides[1].trim()) {
    return { ok: false, stage: "parse", message: "write both sides around a single = sign" };
  }
  let leftAst: MathNode;
  let rightAst: MathNode;
  try {
    leftAst = mathParse(sides[0]);
    rightAst = mathParse(sides[1]);
  } catch {
    return { ok: false, stage: "parse", message: "couldn't read that — check the syntax" };
  }
  const dependencies: Record<string, string[]> = {};
  const declare = (ast: MathNode): { ast: MathNode; symbol: string } | null => {
    const declaration = declarationOf(ast);
    if (!declaration) return null;
    dependencies[declaration.output] = declaration.inputs;
    return { ast, symbol: declaration.output };
  };
  const leftDeclaration = declare(leftAst);
  const rightDeclaration = declare(rightAst);
  try {
    const left = leftDeclaration ? tv(leftDeclaration.symbol) : simplify(mathToTree(leftAst));
    const right = rightDeclaration ? tv(rightDeclaration.symbol) : simplify(mathToTree(rightAst));
    return {
      ok: true,
      tree: ensureTreeEqIds({ left, right }),
      dependencies: Object.keys(dependencies).length > 0 ? dependencies : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      stage: "convert",
      message: error instanceof Unsupported ? error.message : "that equation isn't playable yet",
    };
  }
}
