# Equation Transformation Animation Spec — v2

The quality bar is Graspable Math. The reference implementation is
`term-motion-demo.html` (14 scenarios, all reviewed and approved frame-by-frame
by the product owner). When this document and the testbed disagree, the testbed
wins — it encodes later feedback.

---

## 1. The core principle: identity continuity

Every glyph that exists in both step N and step N+1 is **the same object** —
the same DOM node, moved via transform. It is never faded out in one place and
faded in at another.

- Opacity may only animate on tokens that are truly **created** or
  **destroyed** by the algebraic step.
- **Freeze-frame test**: pause at any instant — every glyph fully opaque and
  legible, no glyph on screen twice, at most one dominant gesture.
- The anti-pattern is the simultaneous crossfade: every delta blended in one
  0.4s window. It produces double-exposure ghosting and gives the eye nothing
  to follow.

## 2. The phase timeline

Each history step plays as a mini-timeline. Phases overlap slightly, but each
has one owner of attention:

| Phase | Contents | Typical | Easing |
|---|---|---|---|
| emphasis | mark what is about to act | 170–200ms | ease-out |
| travel / apply / extract | THE motion; morphs and chords fire inside it | 380–560ms | ease-in-out |
| land / hold / dissolve | settle; readable intermediate states; parens fall | 120–340ms | ease-out |
| merge / cancel | collapse into results; annihilations | 300–420ms | ease-in-out |
| reflow | close gaps, recenter to the final layout | 180–300ms | ease-out |

Nothing under 100ms, no phase over ~600ms. Never linear easing.
Standard curves: travel `cubic-bezier(0.4,0,0.2,1)`, settle `cubic-bezier(0.2,0.8,0.2,1)`.

## 3. Emphasis rules

- Emphasis = **orange glyph color** (var --emph) + slight scale (1.07). No
  boxes, no backgrounds.
- Emphasis marks the **cause, never the effect**. It attaches at the source,
  rides through the flight so the eye keeps its lock, and **retires at the
  moment of first contact** — landing for a traveler, the merge beat for a
  non-traveling merger, the impact chord for distribution.
- It retires **everywhere at once**: source and copies together. A straggler
  reads as unfinished business.
- Highlight only the glyphs the operation touches: in `6y`, factoring `3`
  highlights the `6` only (`.co` sub-span), never the `y`.
- A term at rest is never highlighted.

## 4. Landing geometry

- Travel destinations are computed against the **current** layout — an
  intermediate position anchored to a neighbor (`land after 7's current right
  edge`) — never against the final layout while neighbors haven't moved.
  Landing on a token that hasn't reflowed yet is a collision bug.
- **Exception — early reflow**: when the destination is *defined by* the final
  layout (products forming in cross-multiplication, an exponent joining a
  settling numerator), the rest of the expression converges on the final
  layout DURING the flight, and the flight aims at final positions. The
  destination assembles itself under the arriving term.
- Decision rule: destination defined by current layout → freeze everything
  else until reflow. Destination defined by final layout → early reflow.

## 5. Arcs and paths

- Travelers move in gentle arcs (10–20% of distance), reading as picked up and
  placed. Vertical arcs for line travel; **horizontal bulges** for vertical
  swaps (reciprocal rotation about a fraction bar).
- Two simultaneous travelers take **different altitudes** so paths never
  collide (cross-multiplication: one low, one high).
- Fission children flying apart on the line need **no arc** — arcs exist to
  distinguish a traveler from text it passes over.

## 6. Morphs: change during flight

- A glyph that changes meaning while moving morphs **in flight**, not by an
  instantaneous pop: vertical squash → swap → spring back with slight
  overshoot, spread over ~24% of the flight, centered on the meaningful moment
  (the `+` becomes `−` exactly while crossing `=`).
- **Mirror morphs** (scaleX) for symmetry changes: `<` folds flat and reopens
  as `>` at the exact instant the negative crosses. The morph axis carries
  meaning: squash = value change, mirror = orientation change.

## 7. Chords: one-to-many operations

- **Impact chord (distribute)**: the original and ALL copies launch together in
  one flight of constant duration — O(1) for any term count, never per-term
  sequential. At one instant (~82% of flight) every target resolves
  identically: signs flip and pulse, the original pulses at its term, all
  emphasis drains. No term is special — including the one that receives the
  original.
- **Launch chord + receive chord (factor)**: every affected coefficient departs
  as an equal. Sources transform EARLY (~22%), the moment their coefficient has
  visibly separated — cause and consequence overlap in flight. Copies converge
  fully opaque and the factored-out token is **born at the landing instant**
  (~85%) with one pulse.
- **Fusion, not fade**: when N elements fuse into one, arrivals stay fully
  opaque until the instant of fusion, then are replaced — never overlapped —
  by the born element. A fade after arrival reads as the result dying.
- **Fission** is fusion reversed: at one beat the source is replaced by fully
  opaque children flying apart; connective tokens (`+`) pop in between them
  mid-separation.

## 8. Structural causality

Structural containers (parentheses, fraction bars, radicals) must exist while
the operation acts through them:

- Distribution: parens stand until EVERY inner term is transformed; the `(`
  slides open to admit the incoming term; parens fall only in the next phase.
- Factoring: parens **rise simultaneously with the extraction**, drawing in
  around the group's current extent.
- Division: the fraction bar draws in and the numerator lifts **mid-flight**,
  before the denominator arrives — the slot assembles under the incoming term.
- A bar or paren whose contents have annihilated dissolves at the same beat.

## 9. Visit every paper state

If a step passes through a state a student would write on paper (`8/2`,
`a³⁺²`, `a⁵⁻²`), the animation renders that state and **holds** it briefly
(~250–350ms) before simplifying. Never jump from operation directly to result.
Hold time is a tuning knob — too long stalls (420ms was rejected; 260ms
approved for `8/2`).

## 10. Typesetting

- Fractions center on the **math axis**: the bar aligns with the horizontal
  stroke level of `=` and `−` (≈ 0.52 × line-height from row top), never the
  baseline.
- Vertical gaps around the bar are **ink-symmetric** (~8px of visible-glyph
  clearance each side). Position by glyph ink, not CSS boxes — digit boxes
  have large empty ascender/descender zones. Production should use
  `canvas.measureText` actualBoundingBox metrics rather than tuned constants.
- Superscripts: ~62% font size, raised ~0.12 × line-height, tight gap (~3px)
  to their base. Explicit px sizes — CSS % font-size resolves against the
  parent and silently breaks.
- Measure with the same styled element you render with, so layout widths can
  never diverge from rendered widths.

## 11. Inverse operations are inverse animations

Distribute ⇄ factor, merge ⇄ fission, travel ⇄ travel. Stepping **backward**
through history plays the inverse choreography of the step, not a crossfade to
the previous state. This is both a correctness check and pedagogy.

## 12. One operation, one gesture, forever

The animations are a vocabulary students learn to read. Cancellation always
looks like fuse-and-annihilate; distribution always looks like the chord.
Never two motions for one operation, never one motion for two operations.

## 13. Flow control (decided for THIS architecture)

The app's history is the source of truth; every state is discrete and
canonical; the animation is only the transition renderer. Therefore:

- **Animations never queue.** A new navigation request **snap-completes** the
  in-flight transition to its final state, then plays the new transition from
  that canonical layout. (Mid-flight blending is for direct-manipulation
  systems where the finger drives state — not this app.)
- Rapid stepping / scrubbing snaps through intermediates and animates only the
  final requested transition.
- Tempo control (breaths between steps ~300–500ms, acceleration over long
  derivations) applies only inside system-paced "replay the derivation".

## 14. Accessibility & platform

- Emphasis is never color alone — the scale-up is the redundant channel.
- `prefers-reduced-motion`: jump to final state with a brief diff highlight.
- Animate only `transform` and `opacity`; drive the timeline from ONE pausable
  clock (rAF) so pause freezes flights AND pending phase events together.
- Contact beats are discrete synchronized instants — natural hooks for sound
  or haptics later.

---

## Appendix: primitive inventory (as implemented in the testbed)

| Primitive | Scenario(s) | Notes |
|---|---|---|
| travel + intermediate landing | move across =, inequality | anchored to current layout |
| travel + early reflow | cross multiply, exp quotient | anchored to final layout |
| in-flight morph (squash / mirror) | move across =, reciprocal, inequality | axis = meaning |
| merge into sink | move across =, combine, divide, exponents, exp quotient | result at 60% beat |
| annihilation (null-result merge) | cancel pair | both dissolve at contact |
| impact chord (hops) | distribute −, distribute × | parallel, O(1) |
| launch/receive chord (revHops) + birth | factor | factor born at landing |
| fission | split | horizontal, opaque children |
| fly-and-fuse (onto) | exponents | base merges into base |
| structural rise/dissolve | distribute, factor, divide, cancel | causality rules §8 |
| division formation | divide sides | bar + lift mid-flight |
| static fractions (multiple) + sup rows | cancel pair, cross multiply, exp quotient | math-axis metrics |
| paren opening shift | distribute | neighbor makes room |
| transient tokens | exponents, exp quotient | `+` / `−` in sup row, merged away |
