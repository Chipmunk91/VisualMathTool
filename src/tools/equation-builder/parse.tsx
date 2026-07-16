import { ReactNode } from "react";
import { parse as mathParse, MathNode } from "mathjs";
import { EquationState, EqTerm, LeafTerm, FuncName, leaf, group, func, scaleNum, scaleDen, combine } from "./model";
import { TNode, TreeEq, simplify, tadd, tc, tfn, tmul, tnamed, tpow, tv, treeSideToFlat } from "./tree";

/**
 * Typed-equation support: mathjs parses the text into an AST (the standard
 * notation parser — implicit multiplication, ^, functions, constants), which
 * we (a) render as pretty math live while typing, and (b) convert into the
 * playground's term model on Enter, when the equation fits a playable shape.
 */

const FN_MAP: Record<string, FuncName> = { sin: "sin", cos: "cos", tan: "tan", ln: "ln", log: "ln", exp: "exp" };

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

/** Flatten an additive expression into playground terms */
function addTerms(node: Node, negate: boolean): EqTerm[] {
  if (node.type === "OperatorNode" && node.op === "+" && node.args.length === 2) {
    return [...addTerms(node.args[0], negate), ...addTerms(node.args[1], negate)];
  }
  if (node.type === "OperatorNode" && node.op === "-" && node.args.length === 2) {
    return [...addTerms(node.args[0], negate), ...addTerms(node.args[1], !negate)];
  }
  if (node.type === "OperatorNode" && node.op === "-" && node.args.length === 1) {
    return addTerms(node.args[0], !negate);
  }
  const t = convertTerm(node);
  return [negate ? scaleNum(t, -1) : t];
}

/** An additive expression that must reduce to plain leaves (inside parens/functions) */
function innerLeaves(node: Node): EqTerm[] {
  // nested parentheses and functions are welcome — the model holds full terms
  return addTerms(node, false);
}

/** One multiplicative term → a playground term */
function convertTerm(node: Node): EqTerm {
  const constant = tryConst(node);
  if (constant) return leaf(constant.num, 0, constant.den);

  switch (node.type) {
    case "SymbolNode":
      if (node.name === "x") return leaf(1, 1);
      if (node.name === "y") return leaf(1, 1, 1, "y");
      throw new Unsupported(`the constant "${node.name}" isn't playable yet`);
    case "ParenthesisNode":
      return group(1, innerLeaves(node.content));
    case "FunctionNode": {
      const fn = FN_MAP[node.fn?.name];
      if (!fn || node.args.length !== 1) {
        throw new Unsupported(`${node.fn?.name ?? "that function"}( ) isn't playable yet — try sin, cos, tan, ln, or exp`);
      }
      return func(fn, 1, innerLeaves(node.args[0]));
    }
    case "OperatorNode":
      break;
    default:
      throw new Unsupported("that expression isn't playable yet");
  }

  if (node.op === "-" && node.args.length === 1) {
    return scaleNum(convertTerm(node.args[0]), -1);
  }

  if (node.op === "^") {
    const base = unwrapParens(node.args[0]);
    const exponent = tryConst(node.args[1] ? unwrapParens(node.args[1]) : node.args[1]);
    if (base.type === "SymbolNode" && base.name === "e") {
      return func("exp", 1, innerLeaves(node.args[1]));
    }
    if (base.type === "SymbolNode" && (base.name === "x" || base.name === "y")) {
      const v = base.name as "x" | "y";
      if (exponent && exponent.den === 1 && Number.isInteger(exponent.num) && exponent.num !== 0 && Math.abs(exponent.num) <= 9) {
        return leaf(1, exponent.num, 1, v);
      }
      if (exponent && exponent.den === 1 && exponent.num === 0) return leaf(1, 0, 1);
      throw new Unsupported(`only whole-number powers of ${v} up to ±9 are playable`);
    }
    throw new Unsupported("that exponent isn't playable yet");
  }

  if (node.op === "*") {
    // rational coefficient × at most one x-ish core
    let num = 1;
    let den = 1;
    let core: EqTerm | null = null;
    const walk = (n: Node) => {
      if (n.type === "OperatorNode" && n.op === "*" && n.args.length === 2) {
        walk(n.args[0]);
        walk(n.args[1]);
        return;
      }
      const c = tryConst(n);
      if (c) {
        num *= c.num;
        den *= c.den;
        return;
      }
      if (core) throw new Unsupported("multiplying two x-parts together isn't playable yet");
      core = convertTerm(n);
    };
    walk(node);
    if (!core) return leaf(num, 0, den);
    return scaleDen(scaleNum(core, num), den);
  }

  if (node.op === "/") {
    const [top, bottom] = node.args;
    const bottomConst = tryConst(bottom);
    if (bottomConst) {
      if (bottomConst.num === 0) throw new Unsupported("dividing by zero isn't a thing");
      return scaleDen(scaleNum(convertTerm(top), bottomConst.den), bottomConst.num);
    }
    // denominators containing x: c / (b·x)
    const b = unwrapParens(bottom);
    let denCoef = { num: 1, den: 1 };
    let denVar: "x" | "y" | null = null;
    const symVar = (n: Node): "x" | "y" | null =>
      n.type === "SymbolNode" && (n.name === "x" || n.name === "y") ? (n.name as "x" | "y") : null;
    if (symVar(b)) {
      denVar = symVar(b);
    } else if (b.type === "OperatorNode" && b.op === "*" && b.args.length === 2) {
      const [f1, f2] = b.args.map(unwrapParens);
      const c1 = tryConst(f1);
      const c2 = tryConst(f2);
      if (c1 && symVar(f2)) {
        denCoef = c1;
        denVar = symVar(f2);
      } else if (c2 && symVar(f1)) {
        denCoef = c2;
        denVar = symVar(f1);
      }
    }
    if (denVar) {
      const topTerm = convertTerm(top);
      if (topTerm.kind !== "leaf" || topTerm.power !== 0 || topTerm.pm || topTerm.radical || topTerm.fnVal) {
        throw new Unsupported(`only plain numbers over ${denVar} are playable yet`);
      }
      return leaf(topTerm.num * denCoef.den, -1, topTerm.den * denCoef.num, denVar);
    }
    throw new Unsupported("that denominator isn't playable yet");
  }

  throw new Unsupported("that expression isn't playable yet");
}

/* --- mathjs AST → expression tree (the frontier fallback) ----------------- */

const TREE_FN: Record<string, "sin" | "cos" | "tan" | "ln" | "exp" | "sqrt"> = {
  sin: "sin",
  cos: "cos",
  tan: "tan",
  ln: "ln",
  log: "ln",
  exp: "exp",
  sqrt: "sqrt",
};

function mathToTree(node: Node): TNode {
  const constant = tryConst(node);
  if (constant) return tc(constant.num, constant.den);
  switch (node.type) {
    case "SymbolNode":
      if (node.name === "x" || node.name === "y") return tv(node.name);
      if (node.name === "pi" || node.name === "π") return tnamed("pi");
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
  | { ok: true; state: EquationState; tree?: undefined }
  | { ok: true; state?: undefined; tree: TreeEq }
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
    const state: EquationState = {
      left: combine(addTerms(leftAst, false)),
      right: combine(addTerms(rightAst, false)),
    };
    return { ok: true, state };
  } catch (flatError) {
    // The flat model refused — try the expression tree (frontier mode)
    try {
      const left = simplify(mathToTree(leftAst));
      const right = simplify(mathToTree(rightAst));
      // simplification may reveal a flat-representable equation after all
      const fl = treeSideToFlat(left);
      const fr = treeSideToFlat(right);
      if (fl && fr && fl.length && fr.length) {
        return { ok: true, state: { left: combine(fl), right: combine(fr) } };
      }
      return { ok: true, tree: { left, right } };
    } catch (treeError) {
      const e = treeError instanceof Unsupported ? treeError : flatError;
      return {
        ok: false,
        stage: "convert",
        message: e instanceof Unsupported ? e.message : "that equation isn't playable yet",
      };
    }
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
