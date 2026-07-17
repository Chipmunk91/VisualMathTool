import { ReactNode } from "react";
import { parse as mathParse, MathNode } from "mathjs";
import { TNode, TreeEq, ensureTreeEqIds, simplify, tadd, tc, tfn, tmul, tnamed, tpow, tv } from "./tree";

/**
 * Typed-equation support: mathjs parses the text into an AST (the standard
 * notation parser — implicit multiplication, ^, functions, constants), which
 * we (a) render as pretty math live while typing, and (b) convert into the
 * playground's term model on Enter, when the equation fits a playable shape.
 */

class Unsupported extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any; // mathjs AST nodes, accessed structurally

function ratFromNumber(v: number): { num: number; den: number } {
  if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw new Unsupported("that number is out of range");
  if (Number.isInteger(v)) return { num: v, den: 1 };
  const places = Math.min(6, (String(v).split(".")[1] ?? "").length || 6);
  const den = 10 ** places;
  return { num: Math.round(v * den), den };
}

/** A purely numeric subtree → rational value, or null if it involves x etc. */
function tryConst(node: Node): { num: number; den: number } | null {
  switch (node.type) {
    case "ConstantNode":
      return typeof node.value === "number" ? ratFromNumber(node.value) : null;
    case "ParenthesisNode":
      return tryConst(node.content);
    case "OperatorNode": {
      if (node.op === "-" && node.args.length === 1) {
        const c = tryConst(node.args[0]);
        return c ? { num: -c.num, den: c.den } : null;
      }
      if (node.args.length === 2) {
        const a = tryConst(node.args[0]);
        const b = tryConst(node.args[1]);
        if (!a || !b) return null;
        if (node.op === "/") return b.num === 0 ? null : { num: a.num * b.den, den: a.den * b.num };
        if (node.op === "*") return { num: a.num * b.num, den: a.den * b.den };
        if (node.op === "+") return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
        if (node.op === "-") return { num: a.num * b.den - b.num * a.den, den: a.den * b.den };
      }
      return null;
    }
    default:
      return null;
  }
}

const unwrapParens = (node: Node): Node => (node.type === "ParenthesisNode" ? unwrapParens(node.content) : node);

/* --- mathjs AST → canonical expression tree ------------------------------- */

const TREE_FN: Record<string, "sin" | "cos" | "tan" | "ln" | "exp" | "sqrt"> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  ln: "ln",
  log: "ln",
  exp: "exp",
  sqrt: "sqrt",
};

type VariableName = "x" | "y";

/**
 * mathjs reads pencil-style `xy` as one SymbolNode, not as implicit
 * multiplication. Split it only when every character is a variable that the
 * playground actually supports. This keeps names such as `velocity` invalid
 * instead of silently assigning them an unintended algebraic meaning.
 */
function splitVariableProduct(name: string): VariableName[] | null {
  if (name.length < 2) return null;
  const names = Array.from(name);
  return names.every((part): part is VariableName => part === "x" || part === "y") ? names : null;
}

function mathToTree(node: Node): TNode {
  const constant = tryConst(node);
  if (constant) return tc(constant.num, constant.den);
  switch (node.type) {
    case "SymbolNode":
      if (node.name === "x" || node.name === "y") return tv(node.name);
      if (node.name === "pi" || node.name === "π") return tnamed("pi");
      {
        const variables = splitVariableProduct(node.name);
        if (variables) return tmul(...variables.map(tv));
      }
      throw new Unsupported(`the constant "${node.name}" isn't playable yet`);
    case "ParenthesisNode":
      return mathToTree(node.content);
    case "FunctionNode": {
      const fn = TREE_FN[node.fn?.name];
      if (!fn || node.args.length !== 1) {
        throw new Unsupported(`${node.fn?.name ?? "that function"}( ) isn't playable yet — try sin, cos, tan, ln, exp, or sqrt`);
      }
      return tfn(fn, mathToTree(node.args[0]));
    }
    case "OperatorNode": {
      if (node.op === "-" && node.args.length === 1) return tmul(tc(-1), mathToTree(node.args[0]));
      const [a, b] = node.args;
      if (node.op === "+") return tadd(mathToTree(a), mathToTree(b));
      if (node.op === "-") return tadd(mathToTree(a), tmul(tc(-1), mathToTree(b)));
      if (node.op === "*") return tmul(mathToTree(a), mathToTree(b));
      if (node.op === "/") return tmul(mathToTree(a), tpow(mathToTree(b), -1));
      if (node.op === "^") {
        // In pencil notation xy² means x·y²; only explicit (xy)² raises the
        // complete product. mathjs otherwise gives both forms the same
        // SymbolNode-shaped base after parsing, so preserve that distinction
        // before unwrapping parentheses.
        if (a.type === "SymbolNode") {
          const variables = splitVariableProduct(a.name);
          if (variables) {
            const last = variables[variables.length - 1];
            return tmul(...variables.slice(0, -1).map(tv), tpow(tv(last), mathToTree(b)));
          }
        }
        const base = unwrapParens(a);
        if (base.type === "SymbolNode" && base.name === "e") return tfn("exp", mathToTree(b));
        return tpow(mathToTree(a), mathToTree(b));
      }
      throw new Unsupported("that expression isn't playable yet");
    }
    default:
      throw new Unsupported("that expression isn't playable yet");
  }
}

export type ParseResult =
  | { ok: true; tree: TreeEq }
  | { ok: false; stage: "parse" | "convert"; message: string };

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
  try {
    const left = simplify(mathToTree(leftAst));
    const right = simplify(mathToTree(rightAst));
    return { ok: true, tree: ensureTreeEqIds({ left, right }) };
  } catch (treeError) {
    return {
      ok: false,
      stage: "convert",
      message: treeError instanceof Unsupported ? treeError.message : "that equation isn't playable yet",
    };
  }
}

/* --- Live pretty-math preview ------------------------------------------- */

const isWordSymbol = (name: string) => name.length > 1 && name !== "pi";

const PreviewNode = ({ node }: { node: Node }): ReactNode => {
  switch (node.type) {
    case "ConstantNode":
      return <span>{String(node.value)}</span>;
    case "SymbolNode":
      if (node.name === "pi" || node.name === "π") return <span className="italic">π</span>;
      {
        const variables = splitVariableProduct(node.name);
        if (variables) {
          return (
            <span className="inline-flex items-center">
              {variables.map((variable, index) => (
                <span key={`${variable}-${index}`} className="inline-flex items-center">
                  {index > 0 && <span className="mx-1">·</span>}
                  <span className="italic">{variable}</span>
                </span>
              ))}
            </span>
          );
        }
      }
      return <span className={isWordSymbol(node.name) ? "" : "italic"}>{node.name}</span>;
    case "ParenthesisNode":
      return (
        <span className="inline-flex items-center">
          (<PreviewNode node={node.content} />)
        </span>
      );
    case "FunctionNode": {
      const name = node.fn?.name ?? "?";
      if (name === "exp") {
        return <Sup base={<span className="italic">e</span>} exp={<PreviewNode node={node.args[0]} />} />;
      }
      if (name === "sqrt") {
        return (
          <span className="inline-flex items-baseline">
            <span>√</span>
            <span className="border-t border-current">
              <PreviewNode node={node.args[0]} />
            </span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center">
          <span className="mr-0.5">{name === "log" ? "ln" : name}</span>(
          {node.args.map((a: Node, i: number) => (
            <span key={i} className="inline-flex items-center">
              {i > 0 && <span className="mr-1">,</span>}
              <PreviewNode node={a} />
            </span>
          ))}
          )
        </span>
      );
    }
    case "OperatorNode": {
      if (node.args.length === 1 && node.op === "-") {
        return (
          <span className="inline-flex items-center">
            −<PreviewNode node={node.args[0]} />
          </span>
        );
      }
      const [a, b] = node.args;
      if (node.op === "+" || node.op === "-") {
        return (
          <span className="inline-flex items-center gap-2">
            <PreviewNode node={a} />
            <span>{node.op === "+" ? "+" : "−"}</span>
            <PreviewNode node={b} />
          </span>
        );
      }
      if (node.op === "*") {
        const juxtapose =
          a.type === "ConstantNode" &&
          (b.type === "SymbolNode" || b.type === "FunctionNode" || b.type === "ParenthesisNode" ||
            (b.type === "OperatorNode" && b.op === "^"));
        return (
          <span className="inline-flex items-center">
            <PreviewNode node={a} />
            {!juxtapose && <span className="mx-1">·</span>}
            <PreviewNode node={b} />
          </span>
        );
      }
      if (node.op === "/") {
        return (
          <span className="mx-1 inline-flex flex-col items-center self-center text-[0.8em] leading-tight">
            <span className="inline-flex items-center px-1">
              <PreviewNode node={a} />
            </span>
            <span className="my-0.5 h-[2px] w-full min-w-[1em] rounded bg-current" aria-hidden />
            <span className="inline-flex items-center px-1">
              <PreviewNode node={b} />
            </span>
          </span>
        );
      }
      if (node.op === "^") {
        const exponent = b.type === "ParenthesisNode" ? b.content : b;
        if (a.type === "SymbolNode") {
          const variables = splitVariableProduct(a.name);
          if (variables) {
            const last = variables[variables.length - 1];
            return (
              <span className="inline-flex items-center">
                {variables.slice(0, -1).map((variable, index) => (
                  <span key={`${variable}-${index}`} className="inline-flex items-center">
                    {index > 0 && <span className="mx-1">·</span>}
                    <span className="italic">{variable}</span>
                  </span>
                ))}
                <span className="mx-1">·</span>
                <Sup base={<span className="italic">{last}</span>} exp={<PreviewNode node={exponent} />} />
              </span>
            );
          }
        }
        return <Sup base={<PreviewNode node={a} />} exp={<PreviewNode node={exponent} />} />;
      }
      return <span>{node.toString()}</span>;
    }
    default:
      return <span>{typeof node.toString === "function" ? node.toString() : "?"}</span>;
  }
};

const Sup = ({ base, exp }: { base: ReactNode; exp: ReactNode }) => (
  <span className="inline-flex items-start">
    {base}
    <span className="mt-[-0.25em] inline-flex items-center text-[0.65em] leading-none">{exp}</span>
  </span>
);

/** Render typed text as pretty math (both sides of "="), or null while unparseable */
export function renderMathPreview(text: string): ReactNode | null {
  const sides = text.split("=");
  if (sides.length > 2) return null;
  try {
    const rendered = sides.map((side) => {
      if (!side.trim()) throw new Error("empty side");
      return <PreviewNode node={mathParse(side)} />;
    });
    return (
      <span className="inline-flex items-center gap-3">
        {rendered.map((r, i) => (
          <span key={i} className="inline-flex items-center gap-3">
            {i > 0 && <span>=</span>}
            {r}
          </span>
        ))}
      </span>
    );
  } catch {
    return null;
  }
}
