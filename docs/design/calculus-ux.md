# Calculus UX — readiness states, defaults, and derivative notation

The multivariable generalization (PR #26) made the calculus operators fully
explicit: every symbol must be classified before differentiating or
integrating. That explicitness is correct **at the protocol** — an API caller
must never receive a silently guessed derivative — but it shipped
generality-first UI for a defaults-first problem: taking d/dx of `y = 2x²`
required answering a questionnaire.

This document is the contract both agents (Claude, Codex) build against.
One line: **explicit at the protocol, inferred-with-a-visible-receipt at the
UI, remembered in the document, asked only on true ambiguity.**

## The four readiness states

`inferCalculusDefaults(analysis)` in `calculus.ts` classifies the relation
from pure structure (`analyzeRelation`), never from symbol names:

| # | State | Example | Detection | Treatment |
|---|---|---|---|---|
| 1 | `no-symbols` | `5 = 5` | no symbols | Operators disabled; tooltip explains nothing varies. The *engine* still answers honestly if asked (derivative of a constant is 0) — hiding is a UI decision. |
| 0 | `solution-set` | `x² = 4`, `y = 5` | symbols but no function reading (one symbol without isolation, or an isolation with zero inputs) | **Teachable refusal**: differentiating both sides of an equation that only holds at isolated solutions destroys them (`x² = 4 → 2x = 0`). Flash the explanation, then open the panel — its explicit "treat as identity" checkbox stays as the deliberate escape hatch. |
| 2 | `deterministic` | `y = 2x²`, `sin(t) = y` | exactly one isolation with exactly one input | **One tap.** The returned context is complete (ordinary d/d⟨input⟩, output dependent). Apply immediately with a visible receipt naming the inference. No panel. |
| 3 | `needs-context` | `x² + y² = 1`, `z = x·y`, `y = x` | everything else | **Ask once.** Open the panel seeded with the best-ranked suggestion (implicit for no-isolation, partial for multi-input isolations), so accepting is one confirm. |

The side never matters: `y = 2x²` and `2x² = y` classify identically.

### Sticky contexts collapse state 3 into state 2

A completed context is a **document-level declaration**, not a per-operation
answer. `quickCalculus` reapplies the current context in one tap whenever it
still validates — so after the first classification of `x² + y² = 1`, every
subsequent derivative is one tap. Contexts already persist in share
presentation (`lastDifferentiationContext` / `lastIntegrationContext`) and are
pruned when symbols disappear.

**Exception:** a sticky `treatAsIdentity` confirmation never auto-reapplies
(`dependent.length > 0` is required for the quick path). Identity-mode
differentiation is dangerous enough that it stays a deliberate, per-equation
act.

### Escape hatch

Because a valid context auto-applies, the panel would otherwise become
unreachable. The `⚙` symbol in the Calculus toolbox group always opens the
full panel (with an operation switch), for changing mode, roles, or notation.

## Derivative notation: symbols, not fractions

`DifferentiationContext.notation?: "leibniz" | "lagrange" | "subscript"`.

The tool's drag grammar teaches that fractions are grabbable and splittable.
A Leibniz `dy/dx` rendered as a fraction is a landmine in that grammar: it
looks exactly like the objects users are trained to tear apart, yet must
never split (`d²y/dx²` doesn't factor; partial "cancellation" gives the
famously wrong ∂z/∂x·∂x/∂y·∂y/∂z = +1). Rather than special-casing the
renderer, **`lagrange` and `subscript` birth the derivative as a new named
symbol** — atomic by construction, obeying every existing rule:

- `lagrange` → `y′` (repeat: `y′′`). Default for ordinary/implicit/total.
- `subscript` → `z_x` (repeat: `z_xx`; rendered with a true subscript, the
  underscore is storage-only). Default for partial. Typeable back into the
  parser (`z_x` is a valid mathjs identifier); `y′` is display-born only.
- `leibniz` → the classic operator node. **Engine default** when `notation`
  is omitted, so protocol callers and existing tests are unchanged. Still
  the only rendering for *unresolved* operators (`∫ y dx`, derivatives of
  non-bare expressions) — those are genuinely operator syntax.

What this buys, concretely:

- `y = 2x²` → tap → `y′ = 4x` → tap → `y′′ = 4`. Each result is an ordinary
  relation: plottable (a derivative-node left side blocks all view
  candidates via `hasUnresolvedOperators`; a symbol doesn't), movable, and
  deterministic for the *next* derivative.
- `x² + y² = 1` → implicit → `2x + 2y·y′ = 0`, and the user isolates
  `y′ = −x/y` **with the same drag moves they already know**. The derivative
  is solved for like any symbol — no fraction fiction, no special cases.
- Born symbols land in the symbol book with provenance
  (`y′` ≔ "dy/dx — derivative of y with respect to x"), queued via
  `pendingSymbolMeaningsRef` and attached during reconciliation. The Leibniz
  reading survives as documentation instead of algebra.

## Receipts

Every one-tap application flashes what was inferred ("Differentiated with
respect to x — y treated as dependent. ⚙ changes the context."), and the
history step's note records the full classification plus any naming
(`; wrote y′ for dy/dx`). Inference must always be *visible*, never silent.

## Known limits / follow-ups

- The protocol schemas (`session.ts`/`protocol.ts`) don't yet expose
  `notation` in the differentiate action arguments — API callers get Leibniz
  nodes. Adding the optional field to the action JSON schema is the natural
  next step once the UI behavior settles.
- Changing notation later doesn't rewrite existing nodes; the preference
  applies at operation time.
- `keyOf` treats notation as part of a derivative node's identity, so a
  Leibniz node and a would-be-equal born symbol don't cancel. Apply one
  notation consistently per document (the defaults do).
- The state-2 reward should eventually land on the graph: after one-tap
  d/dx, overlay the derivative curve on the curve & slope pane so the slope
  probe visibly agrees with it. (View auto-selection already picks up
  `y′ = 4x` as a function-1d candidate; the overlay is the missing piece.)
