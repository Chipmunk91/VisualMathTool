/**
 * Rendering for tree equations. The layer-2 promise lives here: every glyph
 * emits the SAME data contracts the flat renderer does (data-symbol,
 * data-term-id, data-side, data-term-wrap), so the one pointer engine —
 * proximity grab, marquee, drop targets, previews — drives both worlds.
 *
 * Grabbing any glyph moves its whole top-level addend; constant-valued
 * factors (3, ln 2, √2) are coefficient handles that divide both sides.
 */
import { Fragment, type ReactNode } from "react";
import type { Side } from "./model";
import { TNode, addendsOf, signSplit, varsIn, tc, tpow, simplify } from "./tree";

interface Ctx {
  id: string;
  side: Side;
  onHover: (id: string | null) => void;
  /** inside a factor handle: the handle is the one grab box, glyphs go quiet */
  inert?: boolean;
}

const TSym = ({
  ctx,
  role = "term",
  id,
  className = "",
  title,
  children,
}: {
  ctx: Ctx;
  role?: "term" | "coef" | "xdiv";
  /** override the symbol id (variable handles carry a @x suffix) */
  id?: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) => {
  if (ctx.inert) {
    return <span className={`select-none ${className}`}>{children}</span>;
  }
  return (
    <span
      data-symbol
      data-term-id={id ?? ctx.id}
      data-side={ctx.side}
      data-role={role}
      onPointerEnter={() => ctx.onHover(ctx.id)}
      onPointerLeave={() => ctx.onHover(null)}
      title={
        title ??
        (role === "coef"
          ? "Drag across the equals sign to divide both sides by this"
          : role === "xdiv"
            ? "Drag under the other side to divide both sides by this variable"
            : "Drag across the equals sign — the whole term moves")
      }
      className={`-my-[0.16em] cursor-grab select-none py-[0.16em] active:cursor-grabbing ${className}`}
    >
      {children}
    </span>
  );
};

/** A fraction part as one grab box: numerators divide, denominators multiply */
const FactorHandle = ({
  ctx,
  id,
  role,
  children,
}: {
  ctx: Ctx;
  id: string;
  role: "numer" | "den";
  children: ReactNode;
}) => (
  <span
    data-symbol
    data-term-id={id}
    data-side={ctx.side}
    data-role={role}
    onPointerEnter={() => ctx.onHover(ctx.id)}
    onPointerLeave={() => ctx.onHover(null)}
    title={
      role === "numer"
        ? "Drag under the other side to divide both sides by this"
        : "Drag beside the other side to multiply both sides by this"
    }
    className="-my-[0.16em] inline-flex cursor-grab select-none items-center py-[0.16em] active:cursor-grabbing"
  >
    {children}
  </span>
);

const constText = (num: number, den: number): string =>
  den === 1 ? String(num).replace("-", "−") : `${String(num).replace("-", "−")}/${den}`;

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const supInt = (p: number): string =>
  (p < 0 ? "⁻" : "") + String(Math.abs(p)).split("").map((d) => SUP[Number(d)]).join("");

/** One node, recursively. `coefZone` marks constant-valued factors as divide handles. */
function TN({ node, ctx, coefZone = false }: { node: TNode; ctx: Ctx; coefZone?: boolean }): ReactNode {
  const role = coefZone && varsIn(node).size === 0 ? "coef" : "term";
  switch (node.kind) {
    case "const": {
      if (node.den !== 1) {
        return (
          <span className="mx-0.5 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
            <TSym ctx={ctx} role={role} className="px-[0.15em]">{String(node.num).replace("-", "−")}</TSym>
            <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
            <TSym ctx={ctx} role={role}>{node.den}</TSym>
          </span>
        );
      }
      return <TSym ctx={ctx} role={role}>{constText(node.num, node.den)}</TSym>;
    }
    case "var":
      return <TSym ctx={ctx} className="italic">{node.name}</TSym>;
    case "add":
      return (
        <span className="inline-flex items-center">
          <span className="select-none">(</span>
          {node.terms.map((t, i) => {
            const { neg, body } = signSplit(t);
            return (
              <Fragment key={i}>
                {i === 0 ? (
                  neg && <TSym ctx={ctx} className="mr-0.5">−</TSym>
                ) : (
                  <TSym ctx={ctx} className="mx-1.5">{neg ? "−" : "+"}</TSym>
                )}
                <TN node={body} ctx={ctx} />
              </Fragment>
            );
          })}
          <span className="select-none">)</span>
        </span>
      );
    case "mul": {
      // a leading negative coefficient reads as a sign, not "−1·"
      // (top-level addends already strip it; nested muls — fn args — don't)
      const split = signSplit(node);
      if (split.neg) {
        return (
          <span className="inline-flex items-center">
            <TSym ctx={ctx} className="mr-0.5">−</TSym>
            <TN node={split.body} ctx={ctx} coefZone={coefZone} />
          </span>
        );
      }
      // factors with negative constant exponents form the denominator
      const numer: TNode[] = [];
      const denom: TNode[] = [];
      for (const f of node.factors) {
        if (f.kind === "pow" && f.exp.kind === "const" && f.exp.num < 0) {
          denom.push(simplify(tpow(f.base, tc(-f.exp.num, f.exp.den))));
        } else numer.push(f);
      }
      const row = (fs: TNode[], zone: "top" | "bottom"): ReactNode =>
        fs.length === 0 ? (
          <TSym ctx={ctx}>1</TSym>
        ) : (
          <span className="inline-flex items-center">
            {fs.map((f, i) => {
              const dot = i > 0 && !(fs[i - 1].kind === "const" && f.kind !== "const");
              // denominator factors multiply both sides; compound numerator
              // factors divide; bare variables keep their flat-style handle;
              // constants stay coefficient handles
              const body =
                ctx.inert ? (
                  <TN node={f} ctx={ctx} />
                ) : zone === "bottom" ? (
                  <FactorHandle ctx={ctx} id={`${ctx.id}@d${i}`} role="den">
                    <TN node={f} ctx={{ ...ctx, inert: true }} />
                  </FactorHandle>
                ) : f.kind === "var" ? (
                  <TSym ctx={ctx} role="xdiv" id={`${ctx.id}@${f.name}`} className="italic">
                    {f.name}
                  </TSym>
                ) : varsIn(f).size === 0 ? (
                  // constant-valued factors (ln 2, √2) are coefficient handles
                  <TN node={f} ctx={ctx} coefZone />
                ) : f.kind === "fn" || f.kind === "pow" || f.kind === "add" ? (
                  <FactorHandle ctx={ctx} id={`${ctx.id}@n${i}`} role="numer">
                    <TN node={f} ctx={{ ...ctx, inert: true }} />
                  </FactorHandle>
                ) : (
                  <TN node={f} ctx={ctx} coefZone />
                );
              return (
                <Fragment key={i}>
                  {dot && <TSym ctx={ctx} className="mx-0.5">·</TSym>}
                  {body}
                </Fragment>
              );
            })}
          </span>
        );
      if (denom.length === 0) return row(numer, "top");
      return (
        <span className="mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
          <span className="px-[0.15em]">{row(numer, "top")}</span>
          <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
          <span className="px-[0.15em]">{row(denom, "bottom")}</span>
        </span>
      );
    }
    case "pow": {
      // a bare negative power is a fraction: (x+1)⁻¹ reads as 1/(x+1)
      if (node.exp.kind === "const" && node.exp.num < 0) {
        const inv = simplify(tpow(node.base, tc(-node.exp.num, node.exp.den)));
        return (
          <span className="mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
            <TSym ctx={ctx} className="px-[0.15em]">1</TSym>
            <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
            <span className="px-[0.15em]">
              {ctx.inert ? (
                <TN node={inv} ctx={ctx} />
              ) : (
                <FactorHandle ctx={ctx} id={`${ctx.id}@d0`} role="den">
                  <TN node={inv} ctx={{ ...ctx, inert: true }} />
                </FactorHandle>
              )}
            </span>
          </span>
        );
      }
      // add renders its own parens; mul/pow bases need explicit ones
      const wrapBase = node.base.kind === "mul" || node.base.kind === "pow";
      const expInt = node.exp.kind === "const" && node.exp.den === 1;
      return (
        <span className="inline-flex items-start">
          {wrapBase ? (
            <span className="inline-flex items-center">
              <span className="select-none">(</span>
              <TN node={node.base} ctx={ctx} />
              <span className="select-none">)</span>
            </span>
          ) : (
            <TN node={node.base} ctx={ctx} coefZone={coefZone} />
          )}
          <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
            {expInt ? (
              <TSym ctx={ctx}>{supInt((node.exp as { num: number }).num)}</TSym>
            ) : (
              <TN node={node.exp} ctx={ctx} />
            )}
          </span>
        </span>
      );
    }
    case "fn": {
      if (node.fn === "exp") {
        return (
          <span className="inline-flex items-start">
            <TSym ctx={ctx} role={role} className="italic">e</TSym>
            <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
              <TN node={node.arg} ctx={ctx} coefZone={coefZone} />
            </span>
          </span>
        );
      }
      if (node.fn === "sqrt") {
        return (
          <span className="inline-flex items-baseline">
            <TSym ctx={ctx} role={role}>√</TSym>
            <span className="border-t-[0.06em] border-current pt-[0.02em]">
              <TN node={node.arg} ctx={ctx} coefZone={coefZone} />
            </span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center">
          <TSym ctx={ctx} role={role} className="mr-0.5">{node.fn}</TSym>
          <span className="select-none">(</span>
          <TN node={node.arg} ctx={ctx} coefZone={coefZone} />
          <span className="select-none">)</span>
        </span>
      );
    }
  }
}

export function TreeSideView({
  node,
  side,
  hoveredTermId,
  selectedIds,
  onHover,
}: {
  node: TNode;
  side: Side;
  hoveredTermId: string | null;
  selectedIds: string[] | null;
  onHover: (id: string | null) => void;
}) {
  const addends = addendsOf(node);
  const prefix = side === "left" ? "L" : "R";
  if (addends.length === 0) {
    const ctx: Ctx = { id: `${prefix}0`, side, onHover };
    return (
      <span className="inline-flex items-center">
        <TSym ctx={ctx}>0</TSym>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center">
      {addends.map((a, i) => {
        const id = `${prefix}${i}`;
        const ctx: Ctx = { id, side, onHover };
        const { neg, body } = signSplit(a);
        const highlighted = hoveredTermId === id || (selectedIds?.includes(id) ?? false);
        return (
          <Fragment key={id}>
            {i === 0 ? (
              neg && (
                <span className={`mr-1 transition-colors duration-150 ${highlighted ? "text-amber-500" : ""}`}>
                  <TSym ctx={ctx}>−</TSym>
                </span>
              )
            ) : (
              <span className={`mx-3 transition-colors duration-150 ${highlighted ? "text-amber-500" : ""}`}>
                <TSym ctx={ctx}>{neg ? "−" : "+"}</TSym>
              </span>
            )}
            <span
              data-term-wrap={id}
              data-side={side}
              className={`inline-flex items-center transition-colors duration-150 ${highlighted ? "text-amber-500" : ""}`}
            >
              <TN node={body} ctx={ctx} />
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}
