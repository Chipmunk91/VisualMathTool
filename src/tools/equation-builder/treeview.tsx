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
import { TNode, addendsOf, printNode, signSplit, varsIn, tc, tpow, simplify } from "./tree";
import type { SpecialActionKind } from "./specialactions";
import { treeFactorLayout, type TreeFactorUnit } from "./treeunits";

interface Ctx {
  id: string;
  side: Side;
  onHover: (id: string | null) => void;
  selectedIds?: ReadonlySet<string>;
  /** Symbol-book hover highlights every occurrence without changing selection. */
  highlightedSymbolId?: string;
  /** Opt-in factorization cards, addressed by stable semantic node id. */
  factorizationHints?: ReadonlyMap<string, FactorizationHintView>;
  /** inside a factor handle: the handle is the one grab box, glyphs go quiet */
  inert?: boolean;
  /** Stable semantic owner for tap actions inside a display projection. */
  actionOwnerId?: string;
}

export interface FactorizationHintView {
  nodeId: string;
  label: string;
  before: string;
  after: string;
  onApply: () => void;
  onDismiss: () => void;
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
    data-factor-handle={id}
    data-side={ctx.side}
    data-role={role}
    data-selected={ctx.selectedIds?.has(id) || undefined}
    title={
      title ??
      (role === "numer"
        ? "Drag under the other side to divide both sides by this"
        : role === "coef"
          ? "Drag across the equals sign to divide both sides by this"
          : "Drag beside the other side to multiply both sides by this")
    }
    className={`-my-[0.16em] inline-flex cursor-grab select-none items-center py-[0.16em] transition-colors duration-150 hover:text-amber-500 active:cursor-grabbing ${
      ctx.selectedIds?.has(id) ? "text-amber-500" : ""
    }`}
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

/**
 * A tap anchor for one inverse operation. It is deliberately NOT a data-symbol
 * drag hitbox: movement is owned by the surrounding factor/addend.
 */
const SpecialActionAnchor = ({
  ctx,
  nodeId,
  action,
  n,
  targetId,
  expr,
  surface = "structure",
  title,
  className = "",
  children,
}: {
  ctx: Ctx;
  nodeId: string;
  action: SpecialActionKind;
  n?: number;
  /** Exact tree node the action unwinds, for isolate-then-invert actions. */
  targetId?: string;
  /** Display text of a symbolic exponent, for the bubble label. */
  expr?: string;
  surface?: "structure" | "operator";
  title: string;
  className?: string;
  children: ReactNode;
}) => (
  <span
    data-special-hitbox
    data-special-action={action}
    data-special-node={nodeId}
    data-special-target={targetId}
    data-special-expr={expr}
    data-side={ctx.side}
    data-special-n={n}
    data-special-surface={surface}
    title={title}
    className={`relative z-20 -m-[0.14em] inline-flex cursor-pointer select-none items-center justify-center rounded-md p-[0.14em] outline outline-1 outline-dashed outline-transparent outline-offset-2 transition-colors duration-150 [&:hover:not(:has([data-special-action]:hover))]:text-sky-600 [&:hover:not(:has([data-special-action]:hover))]:outline-sky-400/70 dark:[&:hover:not(:has([data-special-action]:hover))]:text-sky-300 ${className}`}
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
function TNContent({ node, ctx, coefZone = false }: { node: TNode; ctx: Ctx; coefZone?: boolean }): ReactNode {
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
    case "named":
      return <TSym ctx={ctx} role={role} className="italic">π</TSym>;
    case "var": {
      // Derivative-born symbols like z_x typeset their subscript chunk small
      // and low; the underscore is storage notation, not display notation.
      const subscripted = node.name.match(/^(.+?)_(.+)$/);
      return (
        <span
          data-model-symbol={node.symbolId}
          className={`rounded-md transition-colors duration-150 ${
            ctx.highlightedSymbolId === node.symbolId
              ? "bg-sky-50 text-sky-600 outline outline-1 outline-dashed outline-sky-400/80 outline-offset-2 dark:bg-sky-950/30 dark:text-sky-300"
              : ""
          }`}
        >
          <TSym ctx={ctx} className="italic">
            {subscripted ? (
              <>
                {subscripted[1]}
                <sub className="text-[0.65em]">{subscripted[2].replace(/_/g, "")}</sub>
              </>
            ) : (
              node.name
            )}
          </TSym>
        </span>
      );
    }
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
      const row = (units: TreeFactorUnit[]): ReactNode =>
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
                    <TN node={unit.expr} ctx={{ ...ctx, inert: true, actionOwnerId: unit.id }} />
                  </FactorHandle>
                );
              return (
                <Fragment key={i}>
                  {/* A multiplication dot is punctuation, not a whole-addend
                      grab target. Proximity therefore resolves to an adjacent
                      factor instead of unexpectedly selecting the full term. */}
                  {dot && <span className="pointer-events-none mx-0.5 select-none">·</span>}
                  {body}
                </Fragment>
              );
            })}
          </span>
        );
      if (denom.length === 0) return row(numer);
      return (
        <span className="mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
          {/* For a multi-factor numerator, the row owns only its gaps and
              multiplication dots. Each visible factor has its smaller box. */}
          {ctx.inert || !layout.wholeNumerator ? (
            <span className="px-[0.15em]">{row(numer)}</span>
          ) : (
            <span
              data-symbol
              data-term-id={layout.wholeNumerator.id}
              data-side={ctx.side}
              data-role="numer"
              data-selected={ctx.selectedIds?.has(layout.wholeNumerator.id) || undefined}
              title="Drag across the equals sign to divide both sides by the whole numerator"
              className="-mx-[0.1em] -mt-[0.14em] cursor-grab select-none px-[0.25em] pt-[0.14em] transition-colors duration-150 [&:hover:not(:has([data-symbol]:hover))]:text-amber-500 active:cursor-grabbing"
            >
              {row(numer)}
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
          <span className="px-[0.15em]">{row(denom)}</span>
        </span>
      );
    }
    case "pow": {
      // a bare negative power is a fraction: (x+1)⁻¹ reads as 1/(x+1)
      if (node.exp.kind === "const" && node.exp.num < 0) {
        const inv = simplify(tpow(node.base, tc(-node.exp.num, node.exp.den)));
        const denominatorId = treeFactorLayout(ctx.id, node).denominator[0]?.id;
        return (
          <span className="mx-1 inline-flex flex-col items-center self-center text-[0.62em] leading-none">
            <TSym ctx={ctx} className="px-[0.15em]">1</TSym>
            <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.15em] rounded bg-current" aria-hidden />
            <span className="px-[0.15em]">
              {ctx.inert || !denominatorId ? (
                <TN node={inv} ctx={{ ...ctx, actionOwnerId: ctx.actionOwnerId ?? node.id }} />
              ) : (
                <FactorHandle ctx={ctx} id={denominatorId} role="den">
                  <TN node={inv} ctx={{ ...ctx, inert: true, actionOwnerId: denominatorId }} />
                </FactorHandle>
              )}
            </span>
          </span>
        );
      }
      // Every exact reciprocal power is shown in the notation students wrote:
      // √u, ³√u, ⁿ√u. The tree remains pow(u, 1/n), so simplification and the
      // inverse "raise both sides" operation share one canonical structure.
      if (node.exp.kind === "const" && node.exp.num === 1 && node.exp.den >= 2) {
        const n = node.exp.den;
        return (
          <TermRegion ctx={ctx}>
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="raise"
              n={n}
              title={`Tap to raise both sides to the power ${n}`}
              className="items-start"
            >
              <span className="inline-flex items-start">
                {n !== 2 && (
                  <span className="mr-[-0.18em] mt-[-0.34em] text-[0.38em] leading-none">{n}</span>
                )}
                <span>√</span>
                <span className="border-t-[0.06em] border-current pt-[0.02em]">
                  <TN node={node.base} ctx={{ ...ctx, inert: true }} />
                </span>
              </span>
            </SpecialActionAnchor>
          </TermRegion>
        );
      }
      // add renders its own parens; mul/pow bases need explicit ones
      const wrapBase = node.base.kind === "mul" || node.base.kind === "pow";
      const expInt = node.exp.kind === "const" && node.exp.den === 1;
      const inner = { ...ctx, inert: true };
      // A symbolic exponent is its own inverse surface: tapping u on a^u
      // takes the u-th root (freeing the base), while the base/whole keeps
      // ln (freeing the exponent). closest() in the pointer layer lets the
      // nested, more specific action win.
      const symbolicExp = !expInt && varsIn(node.exp).size > 0;
      const expression = (
        <span className="inline-flex items-start">
          {wrapBase ? (
            <span className="inline-flex items-center">
              <span className="select-none">(</span>
              <TN node={node.base} ctx={inner} />
              <span className="select-none">)</span>
            </span>
          ) : (
            <TN node={node.base} ctx={inner} coefZone={coefZone} />
          )}
          {/* The exponent must CATCH pointer events, not pass them through:
              its negative top margin pokes above the anchor's hit box, so a
              pass-through tap lands on the page background instead of the
              surrounding inverse-operation anchor (the e^u branch already
              works this way). Inert rendering keeps it out of drag targeting. */}
          <span className={`mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none ${symbolicExp ? "relative z-30" : ""}`}>
            {expInt ? (
              <span className="select-none">{supInt((node.exp as { num: number }).num)}</span>
            ) : symbolicExp ? (
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action="rootexpr"
                targetId={node.id}
                expr={printNode(node.exp)}
                surface="operator"
                title={`Tap the exponent to take the ${printNode(node.exp)}-th root of both sides`}
              >
                <TN node={node.exp} ctx={inner} />
              </SpecialActionAnchor>
            ) : (
              <TN node={node.exp} ctx={inner} />
            )}
          </span>
        </span>
      );
      const rootN = expInt && (node.exp as { num: number }).num >= 2
        ? (node.exp as { num: number }).num
        : null;
      // A variable exponent makes the power an EXPONENTIAL (2^x, b^x, x^b) —
      // its inverse is the logarithm, same as e^u. The ln move itself knows
      // the exact rules: a positive constant base thaws to u·ln(a); an opaque
      // base wraps both sides with the sides > 0 assumption pill.
      const lnExponential = rootN === null && varsIn(node.exp).size > 0;
      return (
        <TermRegion ctx={ctx}>
          {rootN !== null ? (
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="root"
              n={rootN}
              title={`Tap to take the ${rootN === 2 ? "square" : rootN === 3 ? "cube" : `${rootN}th`} root of both sides`}
            >
              {expression}
            </SpecialActionAnchor>
          ) : lnExponential ? (
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="ln"
              title="Tap the exponential to take ln of both sides"
            >
              {expression}
            </SpecialActionAnchor>
          ) : (
            expression
          )}
        </TermRegion>
      );
    }
    case "fn": {
      if (node.fn === "exp") {
        // e^1 is plain e — no dangling superscript 1
        if (node.arg.kind === "const" && node.arg.num === 1 && node.arg.den === 1) {
          return (
            <TermRegion ctx={ctx}>
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action="ln"
                title="Tap to take ln of both sides"
                className="italic"
              >
                e
              </SpecialActionAnchor>
            </TermRegion>
          );
        }
        // The complete exponential is the ln tap surface. A positive integer
        // exponent contributes a smaller, nested root surface, and a SYMBOLIC
        // exponent contributes its u-th-root surface (freeing the base);
        // closest( ) in the pointer layer makes the more specific action win.
        const rootN =
          node.arg.kind === "const" && node.arg.den === 1 && node.arg.num >= 2
            ? node.arg.num
            : null;
        const symbolicArg = rootN === null && varsIn(node.arg).size > 0;
        const expression = (
          <span className="inline-flex items-start">
            <span className="italic">e</span>
            <span
              data-exponent-layer={rootN === null && !symbolicArg ? "passive" : "action"}
              className={`mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none ${
                rootN === null && !symbolicArg ? "" : "relative z-30"
              }`}
            >
              {rootN !== null ? (
                <SpecialActionAnchor
                  ctx={ctx}
                  nodeId={ctx.actionOwnerId ?? node.id}
                  action="root"
                  n={rootN}
                  surface="operator"
                  title={`Tap to take the ${rootN === 2 ? "square" : rootN === 3 ? "cube" : `${rootN}th`} root of both sides`}
                >
                  {constText(rootN, 1)}
                </SpecialActionAnchor>
              ) : symbolicArg ? (
                <SpecialActionAnchor
                  ctx={ctx}
                  nodeId={ctx.actionOwnerId ?? node.id}
                  action="rootexpr"
                  targetId={node.id}
                  expr={printNode(node.arg)}
                  surface="operator"
                  title={`Tap the exponent to take the ${printNode(node.arg)}-th root of both sides`}
                >
                  <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
                </SpecialActionAnchor>
              ) : (
                <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
              )}
            </span>
          </span>
        );
        return (
          <TermRegion ctx={ctx}>
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="ln"
              title="Tap the exponential to take ln of both sides"
            >
              {expression}
            </SpecialActionAnchor>
          </TermRegion>
        );
      }
      if (node.fn === "sqrt") {
        return (
          <TermRegion ctx={ctx}>
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="square"
              title="Tap the radical to square both sides"
            >
              <span className="inline-flex items-baseline">
                <span>√</span>
                <span className="border-t-[0.06em] border-current pt-[0.02em]">
                  <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
                </span>
              </span>
            </SpecialActionAnchor>
          </TermRegion>
        );
      }
      const inverseAction: SpecialActionKind | null =
        node.fn === "sin"
          ? "asin"
          : node.fn === "cos"
            ? "acos"
            : node.fn === "tan"
              ? "atan"
              : node.fn === "ln"
                ? "exp"
                : null;
      const shownName = node.fn === "asin" ? "arcsin" : node.fn === "acos" ? "arccos" : node.fn === "atan" ? "arctan" : node.fn;
      return (
        <TermRegion ctx={ctx}>
          {inverseAction ? (
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action={inverseAction}
              targetId={node.id}
              title={`Tap ${shownName}(…) to apply ${inverseAction === "exp" ? "e^" : shownName === "sin" ? "arcsin" : shownName === "cos" ? "arccos" : "arctan"} to both sides`}
            >
              <span className="inline-flex items-center">
                <span className="mr-0.5">{shownName}</span>
                <span className="select-none">(</span>
                <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
                <span className="select-none">)</span>
              </span>
            </SpecialActionAnchor>
          ) : (
            <span className="inline-flex items-center">
              <span className="mr-0.5 select-none">{shownName}</span>
              <span className="select-none">(</span>
              <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
              <span className="select-none">)</span>
            </span>
          )}
        </TermRegion>
      );
    }
    case "derivative": {
      const mark = node.notation === "partial" ? "∂" : "d";
      const order = node.order > 1 ? supInt(node.order) : "";
      return (
        <TermRegion ctx={ctx}>
          <span className="mx-1 inline-flex flex-col items-center self-center text-[0.58em] leading-none">
            <span className="inline-flex items-center px-[0.12em]">
              <span className="mr-[0.08em] select-none">{mark}{order}</span>
              <span className="select-none">(</span>
              <TN node={node.expression} ctx={{ ...ctx, inert: true }} />
              <span className="select-none">)</span>
            </span>
            <span className="pointer-events-none my-[0.12em] h-[0.07em] w-full min-w-[1.3em] rounded bg-current" aria-hidden />
            <span className="inline-flex items-center px-[0.12em]">
              <span className="select-none">{mark}</span>
              <span
                data-model-symbol={node.variable.symbolId}
                className={`italic ${
                  ctx.highlightedSymbolId === node.variable.symbolId ? "text-sky-600 dark:text-sky-300" : ""
                }`}
              >
                {node.variable.name}
              </span>
              {order && <span className="select-none">{order}</span>}
            </span>
          </span>
        </TermRegion>
      );
    }
    case "integral":
      return (
        <TermRegion ctx={ctx}>
          <span className="inline-flex items-center">
            <span className="relative mr-1 inline-flex select-none items-center text-[1.25em]">
              ∫
              {node.bounds && (
                <>
                  <span className="absolute -top-[0.35em] left-[0.65em] text-[0.35em]">
                    <TN node={node.bounds.upper} ctx={{ ...ctx, inert: true }} />
                  </span>
                  <span className="absolute -bottom-[0.35em] left-[0.65em] text-[0.35em]">
                    <TN node={node.bounds.lower} ctx={{ ...ctx, inert: true }} />
                  </span>
                </>
              )}
            </span>
            <TN node={node.integrand} ctx={{ ...ctx, inert: true }} />
            <span className="ml-1 select-none">d</span>
            <span
              data-model-symbol={node.variable.symbolId}
              className={`italic ${
                ctx.highlightedSymbolId === node.variable.symbolId ? "text-sky-600 dark:text-sky-300" : ""
              }`}
            >
              {node.variable.name}
            </span>
          </span>
        </TermRegion>
      );
  }
}

/**
 * A detected factorization is deliberately a layer above the algebra rather
 * than another algebra hitbox. The card applies the rewrite; dismissing it
 * removes the whole layer so the underlying term is immediately available to
 * the existing drag/tap engine again.
 */
const FactorizationDecoration = ({
  hint,
  side,
  children,
}: {
  hint: FactorizationHintView;
  side: Side;
  children: ReactNode;
}) => (
  <span
    data-factorization-target={hint.nodeId}
    data-factorization-side={side}
    className="relative z-[60] inline-flex rounded-md outline outline-1 outline-dashed outline-sky-400/70 outline-offset-2"
  >
    {children}
    <span className="pointer-events-none absolute -right-1.5 -top-2 font-sans text-[0.22em] leading-none text-sky-500">
      ✦
    </span>
    <span
      data-ui
      data-factorization-overlay={hint.nodeId}
      role="group"
      aria-label={`Factorization suggestion: ${hint.label}`}
      className="absolute bottom-[calc(100%+0.65rem)] left-1/2 z-[80] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 whitespace-normal rounded-2xl border border-sky-200 bg-card p-1.5 font-sans text-sm font-normal leading-normal tracking-normal text-foreground shadow-xl dark:border-sky-900"
    >
      <button
        type="button"
        aria-label={`Apply factorization: ${hint.label}`}
        onClick={hint.onApply}
        className="flex min-h-14 w-full flex-col justify-center rounded-xl px-3 py-2 pr-12 text-left transition-colors hover:bg-sky-50 active:bg-sky-50 dark:hover:bg-sky-950/30 dark:active:bg-sky-950/30"
      >
        <span className="font-semibold text-sky-700 dark:text-sky-300">{hint.label}</span>
        <span className="mt-0.5 font-serif text-xs text-muted-foreground">
          {hint.before} → {hint.after}
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss factorization suggestion"
        title="Dismiss this factorization suggestion"
        onClick={(event) => {
          event.stopPropagation();
          hint.onDismiss();
        }}
        className="absolute right-1.5 top-1.5 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-xl leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
      >
        ×
      </button>
    </span>
  </span>
);

/** Decorate exactly the subtree a factorization candidate matched. */
function TN(props: { node: TNode; ctx: Ctx; coefZone?: boolean }): ReactNode {
  const content = TNContent(props);
  const hint = props.ctx.factorizationHints?.get(props.node.id);
  return hint ? (
    <FactorizationDecoration hint={hint} side={props.ctx.side}>{content}</FactorizationDecoration>
  ) : content;
}

export function TreeSideView({
  node,
  side,
  hoveredTermId,
  selectedIds,
  factorizationHints,
  highlightedSymbolId,
  onHover,
}: {
  node: TNode;
  side: Side;
  hoveredTermId: string | null;
  selectedIds: string[] | null;
  factorizationHints?: ReadonlyMap<string, FactorizationHintView> | null;
  highlightedSymbolId?: string | null;
  onHover: (id: string | null) => void;
}) {
  const addends = addendsOf(node);
  const selectedSet = new Set(selectedIds ?? []);
  if (addends.length === 0) {
    const ctx: Ctx = { id: node.id, side, onHover, selectedIds: selectedSet, factorizationHints: factorizationHints ?? undefined, highlightedSymbolId: highlightedSymbolId ?? undefined };
    return (
      <span className="inline-flex items-center">
        <TSym ctx={ctx}>0</TSym>
      </span>
    );
  }
  const rootHint = node.kind === "add" ? factorizationHints?.get(node.id) : undefined;
  const expression = (
    <span className="relative inline-flex items-center">
      {addends.map((a, i) => {
        const id = a.id;
        const ctx: Ctx = { id, side, onHover, selectedIds: selectedSet, factorizationHints: factorizationHints ?? undefined, highlightedSymbolId: highlightedSymbolId ?? undefined };
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
  return rootHint ? (
    <FactorizationDecoration hint={rootHint} side={side}>{expression}</FactorizationDecoration>
  ) : expression;
}
