import { type ReactNode } from "react";
import { parse as mathParse } from "mathjs";
import { splitVariableProduct } from "./parser";
export { parseEquation } from "./parser";
export type { ParseResult } from "./parser";

/**
 * Typed-equation support: mathjs parses the text into an AST (the standard
 * notation parser — implicit multiplication, ^, functions, constants), which
 * we (a) render as pretty math live while typing, and (b) convert into the
 * playground's term model on Enter, when the equation fits a playable shape.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any; // mathjs AST nodes, accessed structurally

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
