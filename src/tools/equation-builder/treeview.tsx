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
import type { SpecialActionKind } from "./specialactions";
import { treeFactorLayout, type TreeFactorUnit } from "./treeunits";

interface Ctx {
  id: string;
  side: Side;
  onHover: (id: string | null) => void;
  selectedIds?: ReadonlySet<string>;
  /** Stable node ids with optional rewrite suggestions (Hints toggle). */
  rewriteHintIds?: ReadonlySet<string>;
  /** inside a factor handle: the handle is the one grab box, glyphs go quiet */
  inert?: boolean;
  /** Stable semantic owner for tap actions inside a display projection. */
  actionOwnerId?: string;
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
  title,
  className = "",
  children,
}: {
  ctx: Ctx;
  nodeId: string;
  action: SpecialActionKind;
  n?: number;
  title: string;
  className?: string;
  children: ReactNode;
}) => (
  <span
    data-special-action={action}
    data-special-node={nodeId}
    data-side={ctx.side}
    data-special-n={n}
    title={title}
    className={`-m-[0.14em] cursor-pointer select-none p-[0.14em] transition-colors duration-150 hover:text-amber-500 ${className}`}
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
            <span className="inline-flex items-start">
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action="raise"
                n={n}
                title={`Tap to raise both sides to the power ${n}`}
                className="relative mr-[0.02em] inline-flex items-start"
              >
                {n !== 2 && (
                  <span className="mr-[-0.18em] mt-[-0.34em] text-[0.38em] leading-none">{n}</span>
                )}
                <span>√</span>
              </SpecialActionAnchor>
              <span className="border-t-[0.06em] border-current pt-[0.02em]">
                <TN node={node.base} ctx={{ ...ctx, inert: true }} />
              </span>
            </span>
          </TermRegion>
        );
      }
      // add renders its own parens; mul/pow bases need explicit ones
      const wrapBase = node.base.kind === "mul" || node.base.kind === "pow";
      const expInt = node.exp.kind === "const" && node.exp.den === 1;
      const inner = { ...ctx, inert: true };
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
          <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
            {expInt && (node.exp as { num: number }).num >= 2 ? (
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action="root"
                n={(node.exp as { num: number }).num}
                title={`Tap to take the ${(node.exp as { num: number }).num === 2 ? "square" : (node.exp as { num: number }).num === 3 ? "cube" : `${(node.exp as { num: number }).num}th`} root of both sides`}
              >
                {supInt((node.exp as { num: number }).num)}
              </SpecialActionAnchor>
            ) : expInt ? (
              <TSym ctx={ctx}>{supInt((node.exp as { num: number }).num)}</TSym>
            ) : (
              <TN node={node.exp} ctx={inner} />
            )}
          </span>
        </span>
      );
      return <TermRegion ctx={ctx}>{expression}</TermRegion>;
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
        // The base and exponent are tap-only inverse-operation anchors. The
        // surrounding TermRegion/FactorHandle remains the sole drag owner.
        const rootN =
          node.arg.kind === "const" && node.arg.den === 1 && node.arg.num >= 2
            ? node.arg.num
            : null;
        const expression = (
          <span className="inline-flex items-start">
            <SpecialActionAnchor
              ctx={ctx}
              nodeId={ctx.actionOwnerId ?? node.id}
              action="ln"
              title="Tap to take ln of both sides"
              className="italic"
            >
              e
            </SpecialActionAnchor>
            <span className="mt-[-0.2em] inline-flex items-center text-[0.55em] leading-none">
              {rootN !== null ? (
                <SpecialActionAnchor
                  ctx={ctx}
                  nodeId={ctx.actionOwnerId ?? node.id}
                  action="root"
                  n={rootN}
                  title={`Tap to take the ${rootN === 2 ? "square" : rootN === 3 ? "cube" : `${rootN}th`} root of both sides`}
                >
                  {constText(rootN, 1)}
                </SpecialActionAnchor>
              ) : (
                <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
              )}
            </span>
          </span>
        );
        return <TermRegion ctx={ctx}>{expression}</TermRegion>;
      }
      if (node.fn === "sqrt") {
        return (
          <TermRegion ctx={ctx}>
            <span className="inline-flex items-baseline">
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action="square"
                title="Tap to square both sides"
              >
                √
              </SpecialActionAnchor>
              <span className="border-t-[0.06em] border-current pt-[0.02em]">
                <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
              </span>
            </span>
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
          <span className="inline-flex items-center">
            {inverseAction ? (
              <SpecialActionAnchor
                ctx={ctx}
                nodeId={ctx.actionOwnerId ?? node.id}
                action={inverseAction}
                title={`Tap to apply ${inverseAction === "exp" ? "e^" : shownName === "sin" ? "arcsin" : shownName === "cos" ? "arccos" : "arctan"} to both sides`}
                className="mr-0.5"
              >
                {shownName}
              </SpecialActionAnchor>
            ) : (
              <span className="mr-0.5 select-none">{shownName}</span>
            )}
            <span className="select-none">(</span>
            <TN node={node.arg} ctx={{ ...ctx, inert: true }} coefZone={coefZone} />
            <span className="select-none">)</span>
          </span>
        </TermRegion>
      );
    }
  }
}

/** Decorate exactly the subtree a rewrite candidate matched, without making
 * the decoration another drag hitbox. */
function TN(props: { node: TNode; ctx: Ctx; coefZone?: boolean }): ReactNode {
  const content = TNContent(props);
  if (!props.ctx.rewriteHintIds?.has(props.node.id)) return content;
  return (
    <span
      data-rewrite-node={props.node.id}
      data-rewrite-side={props.ctx.side}
      title="Tap to inspect a suggested rewrite"
      className="relative inline-flex rounded-md outline outline-1 outline-dashed outline-sky-400/70 outline-offset-2"
    >
      {content}
      <span className="pointer-events-none absolute -right-1.5 -top-2 font-sans text-[0.22em] leading-none text-sky-500">✦</span>
    </span>
  );
}

export function TreeSideView({
  node,
  side,
  hoveredTermId,
  selectedIds,
  rewriteHintIds,
  onHover,
}: {
  node: TNode;
  side: Side;
  hoveredTermId: string | null;
  selectedIds: string[] | null;
  rewriteHintIds?: string[] | null;
  onHover: (id: string | null) => void;
}) {
  const addends = addendsOf(node);
  const selectedSet = new Set(selectedIds ?? []);
  const hintSet = new Set(rewriteHintIds ?? []);
  if (addends.length === 0) {
    const ctx: Ctx = { id: node.id, side, onHover, selectedIds: selectedSet, rewriteHintIds: hintSet };
    return (
      <span className="inline-flex items-center">
        <TSym ctx={ctx}>0</TSym>
      </span>
    );
  }
  const rootRewriteId = node.kind === "add" && hintSet.has(node.id) ? node.id : null;
  return (
    <span
      data-rewrite-node={rootRewriteId || undefined}
      data-rewrite-side={rootRewriteId ? side : undefined}
      title={rootRewriteId ? "Tap to inspect a suggested rewrite" : undefined}
      className={`relative inline-flex items-center ${
        rootRewriteId ? "rounded-md outline outline-1 outline-dashed outline-sky-400/70 outline-offset-2" : ""
      }`}
    >
      {rootRewriteId && (
        <span className="pointer-events-none absolute -right-1.5 -top-2 font-sans text-[0.22em] leading-none text-sky-500">✦</span>
      )}
      {addends.map((a, i) => {
        const id = a.id;
        const ctx: Ctx = { id, side, onHover, selectedIds: selectedSet, rewriteHintIds: hintSet };
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
