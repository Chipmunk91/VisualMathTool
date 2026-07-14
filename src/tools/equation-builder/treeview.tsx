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
              // every factor is its OWN unit: denominators multiply both
              // sides; constant-valued numerator factors (3, e³, ln 2) divide
              // by exactly themselves; bare variables keep their flat-style
              // handle; compound factors divide
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
                  f.kind === "fn" && f.fn === "exp" ? (
                    // e^n renders its own units — e takes ln, n takes roots
                    <TN node={f} ctx={ctx} />
                  ) : (
                    <FactorHandle ctx={ctx} id={`${ctx.id}@n${i}`} role="coef">
                      <TN node={f} ctx={{ ...ctx, inert: true }} />
                    </FactorHandle>
                  )
                ) : f.kind === "fn" || f.kind === "pow" || f.kind === "add" ? (
                  <FactorHandle ctx={ctx} id={`${ctx.id}@n${i}`} role="numer">
                    <TN node={f} ctx={{ ...ctx, inert: true }} />
                  </FactorHandle>
                ) : (
                  <TN node={f} ctx={ctx} coefZone />
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
          {/* the numerator ROW is the product unit ("e³·x"): its padding, the
              gaps, and the · all grab it; the factor handles nested inside win
              where they cover. It lights up only when no inner unit is hovered. */}
          {ctx.inert ? (
            <span className="px-[0.15em]">{row(numer, "top")}</span>
          ) : (
            <span
              data-symbol
              data-term-id={`${ctx.id}@N`}
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
            {expInt && !ctx.inert && (node.exp as { num: number }).num >= 2 ? (
              <RootHandle ctx={ctx} n={(node.exp as { num: number }).num}>
                {supInt((node.exp as { num: number }).num)}
              </RootHandle>
            ) : expInt ? (
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
                <TN node={node.arg} ctx={ctx} coefZone={coefZone} />
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
