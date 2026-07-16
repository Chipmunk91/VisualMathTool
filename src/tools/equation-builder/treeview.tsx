/**
 * Rendering for tree equations. The layer-2 promise lives here: every glyph
 * emits the SAME data contracts the flat renderer does (data-symbol,
 * data-term-id, data-side, data-term-wrap), so the one pointer engine —
 * proximity grab, marquee, drop targets, previews — drives both worlds.
 *
 * In a product, each immediate factor is one atomic grab target. Numerator
 * factors divide both sides and denominator factors multiply both sides;
 * syntax inside a factor stays quiet so it cannot steal the factor's drag.
 */
import { Fragment, type ReactNode } from "react";
import type { Side } from "./model";
import { TNode, addendsOf, signSplit, varsIn, tc, tpow, simplify } from "./tree";
import { treeFactorLayout, type TreeFactorUnit } from "./treeunits";

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
  // sub-term units (a variable factor, a coefficient) highlight THEMSELVES
  // on hover instead of lighting the whole addend — the region the eye sees
  // is exactly the unit the hand would grab
  const isUnit = role !== "term";
  return (
    <span
      data-symbol
      data-term-id={id ?? ctx.id}
      data-side={ctx.side}
      data-role={role}
      onPointerEnter={isUnit ? undefined : () => ctx.onHover(ctx.id)}
      onPointerLeave={isUnit ? undefined : () => ctx.onHover(null)}
      title={
        title ??
        (role === "coef"
          ? "Drag across the equals sign to divide both sides by this"
          : role === "xdiv"
            ? "Drag under the other side to divide both sides by this variable"
            : "Drag across the equals sign — the whole term moves")
      }
      className={`-my-[0.16em] cursor-grab select-none py-[0.16em] active:cursor-grabbing ${
        isUnit ? "transition-colors duration-150 hover:text-amber-500 " : ""
      }${className}`}
    >
      {children}
    </span>
  );
};

/** One sub-term unit as one grab box: its own hitbox, its own hover glow,
 *  its own move — numerators/coefficients divide, denominators multiply */
const FactorHandle = ({
  ctx,
  id,
  role,
  title,
  children,
}: {
  ctx: Ctx;
  id: string;
  role: "numer" | "den" | "coef";
  title?: string;
  children: ReactNode;
}) => (
  <span
    data-symbol
    data-term-id={id}
    data-side={ctx.side}
    data-role={role}
    title={
      title ??
      (role === "numer"
        ? "Drag under the other side to divide both sides by this"
        : role === "coef"
          ? "Drag across the equals sign to divide both sides by this"
          : "Drag beside the other side to multiply both sides by this")
    }
    className="-my-[0.16em] inline-flex cursor-grab select-none items-center py-[0.16em] transition-colors duration-150 hover:text-amber-500 active:cursor-grabbing"
  >
    {children}
  </span>
);

/** A structure's interior (a pow base, a fn argument) grabs the WHOLE term:
 *  factors in there aren't directly movable — the enclosing power or function
 *  must come apart first — so no unit handles are minted inside (their ids
 *  couldn't be resolved to legal moves) and the region reads as the term. */
const TermRegion = ({ ctx, children }: { ctx: Ctx; children: ReactNode }) => {
  if (ctx.inert) return <>{children}</>;
  return (
    <span
      data-symbol
      data-term-id={ctx.id}
      data-side={ctx.side}
      data-role="term"
      onPointerEnter={() => ctx.onHover(ctx.id)}
      onPointerLeave={() => ctx.onHover(null)}
      title="Drag across the equals sign — the whole term moves"
      className="inline-flex cursor-grab select-none items-center active:cursor-grabbing"
    >
      {children}
    </span>
  );
};

/** The exponent as its own unit: dragging the n across takes the n-th root */
const RootHandle = ({ ctx, n, children }: { ctx: Ctx; n: number; children: ReactNode }) => (
  <span
    data-symbol
    data-term-id={ctx.id}
    data-side={ctx.side}
    data-role="root"
    data-root-n={n}
    title={`Drag across the equals sign — takes the ${n === 2 ? "square" : n === 3 ? "cube" : `${n}th`} root of both sides`}
    className="-m-[0.14em] cursor-grab select-none p-[0.14em] transition-colors duration-150 hover:text-amber-500 active:cursor-grabbing"
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
      const layout = treeFactorLayout(ctx.id, node);
      const numer = layout.numerator;
      const denom = layout.denominator;
      const row = (units: TreeFactorUnit[], zone: "top" | "bottom"): ReactNode =>
        units.length === 0 ? (
          <TSym ctx={ctx}>1</TSym>
        ) : (
          <span className="inline-flex items-center">
            {units.map((unit, i) => {
              const dot =
                i > 0 && !(units[i - 1].expr.kind === "const" && unit.expr.kind !== "const");
              // Every immediate factor has one, and only one, active hitbox.
              // This is deliberately atomic: e^5 is a movable factor here,
              // rather than three overlapping "factor / ln / root" actions.
              const body =
                ctx.inert ? (
                  <TN node={unit.expr} ctx={ctx} />
                ) : (
                  <FactorHandle ctx={ctx} id={unit.id} role={unit.role}>
                    <TN node={unit.expr} ctx={{ ...ctx, inert: true }} />
                  </FactorHandle>
                );
              return (
                <Fragment key={i}>
                  {dot &&
                    // in a fraction, the · belongs to the numerator-PRODUCT
                    // handle wrapped around the whole row — transparent to the
                    // pointer so the row receives the grab
                    (zone === "top" && denom.length > 0 && !ctx.inert ? (
                      <span className="pointer-events-none mx-0.5 select-none">·</span>
                    ) : (
                      <TSym ctx={ctx} className="mx-0.5">·</TSym>
                    ))}
                  {body}
                </Fragment>
              );
            })}
          </span>
        );
      if (denom.length === 0) return row(numer, "top");
      return (
        <span className="mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
          {/* For a multi-factor numerator, the row owns only its gaps and
              multiplication dots. Each visible factor has its smaller box. */}
          {ctx.inert || !layout.wholeNumerator ? (
            <span className="px-[0.15em]">{row(numer, "top")}</span>
          ) : (
            <span
              data-symbol
              data-term-id={layout.wholeNumerator.id}
              data-side={ctx.side}
              data-role="numer"
              title="Drag across the equals sign to divide both sides by the whole numerator"
              className="-mx-[0.1em] -mt-[0.14em] cursor-grab select-none px-[0.25em] pt-[0.14em] transition-colors duration-150 [&:hover:not(:has([data-symbol]:hover))]:text-amber-500 active:cursor-grabbing"
            >
              {row(numer, "top")}
            </span>
          )}
          {/* the bar is the FRACTION's own handle: grab it to move the whole term */}
          {ctx.inert ? (
            <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
          ) : (
            <span
              data-symbol
              data-term-id={ctx.id}
              data-side={ctx.side}
              data-role="term"
              onPointerEnter={() => ctx.onHover(ctx.id)}
              onPointerLeave={() => ctx.onHover(null)}
              title="Drag across the equals sign — the whole fraction moves"
              className="relative z-10 -my-[0.1em] w-full cursor-grab py-[0.22em] active:cursor-grabbing"
            >
              <span className="block h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
            </span>
          )}
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
      const inner = { ...ctx, inert: true };
      return (
        <span className="inline-flex items-start">
          {wrapBase ? (
            <span className="inline-flex items-center">
              <span className="select-none">(</span>
              <TermRegion ctx={ctx}>
                <TN node={node.base} ctx={inner} />
              </TermRegion>
              <span className="select-none">)</span>
            </span>
          ) : (
            <TermRegion ctx={ctx}>
              <TN node={node.base} ctx={inner} coefZone={coefZone} />
            </TermRegion>
          )}
          <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
            {expInt && !ctx.inert && (node.exp as { num: number }).num >= 2 ? (
              <RootHandle ctx={ctx} n={(node.exp as { num: number }).num}>
                {supInt((node.exp as { num: number }).num)}
              </RootHandle>
            ) : expInt ? (
              <TSym ctx={ctx}>{supInt((node.exp as { num: number }).num)}</TSym>
            ) : !ctx.inert && node.exp.kind === "const" && node.exp.num === 1 && node.exp.den > 1 ? (
              // a fractional exponent 1/n is the root's handle in reverse:
              // dragging it across raises both sides to the n-th power
              <span
                data-symbol
                data-term-id={ctx.id}
                data-side={ctx.side}
                data-role="raise"
                data-raise-n={node.exp.den}
                title={`Drag across the equals sign — raises both sides to the power ${node.exp.den}`}
                className="-m-[0.14em] cursor-grab select-none p-[0.14em] transition-colors duration-150 hover:text-amber-500 active:cursor-grabbing"
              >
                <TN node={node.exp} ctx={{ ...ctx, inert: true }} />
              </span>
            ) : (
              <TermRegion ctx={ctx}>
                <TN node={node.exp} ctx={inner} />
              </TermRegion>
            )}
          </span>
        </span>
      );
    }
    case "fn": {
      if (node.fn === "exp") {
        // e^1 is plain e — no dangling superscript 1
        if (node.arg.kind === "const" && node.arg.num === 1 && node.arg.den === 1) {
          return <TSym ctx={ctx} role={role} className="italic">e</TSym>;
        }
        // the base and the exponent are their OWN units: dragging the e
        // takes ln of both sides; dragging a whole exponent n takes the
        // n-th root of both sides
        const rootN =
          !ctx.inert && node.arg.kind === "const" && node.arg.den === 1 && node.arg.num >= 2
            ? node.arg.num
            : null;
        return (
          <span className="inline-flex items-start">
            {ctx.inert ? (
              <span className="select-none italic">e</span>
            ) : (
              <span
                data-symbol
                data-term-id={ctx.id}
                data-side={ctx.side}
                data-role="lnbase"
                title="Drag across the equals sign — takes ln of both sides"
                className="-my-[0.16em] cursor-grab select-none py-[0.16em] italic transition-colors duration-150 hover:text-amber-500 active:cursor-grabbing"
              >
                e
              </span>
            )}
            <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
              {rootN !== null ? (
                <RootHandle ctx={ctx} n={rootN}>{constText(rootN, 1)}</RootHandle>
              ) : (
                <TermRegion ctx={ctx}>
                  <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
                </TermRegion>
              )}
            </span>
          </span>
        );
      }
      if (node.fn === "sqrt") {
        return (
          <span className="inline-flex items-baseline">
            <TSym ctx={ctx} role={role}>√</TSym>
            <span className="border-t-[0.06em] border-current pt-[0.02em]">
              <TermRegion ctx={ctx}>
                <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
              </TermRegion>
            </span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center">
          <TSym ctx={ctx} role={role} className="mr-0.5">{node.fn}</TSym>
          <span className="select-none">(</span>
          <TermRegion ctx={ctx}>
            <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
          </TermRegion>
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
