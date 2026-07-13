# Handover: Equation Animation System → Claude Code

## What this is

A math-education app (university level) with per-operation derivation history
needs Graspable-Math-quality animation when stepping/replaying that history:
terms visibly travel, merge, distribute, factor — the eye tracks every change.
The animation direction was developed iteratively with the product owner over
~15 frame-by-frame review rounds. **The design phase is done. Your job is
implementation in the real app, not re-deriving the design.**

## The three artifacts (read in this order)

1. `equation-animation-spec.md` — the rulebook. 14 rule sections + primitive
   inventory. Every rule was earned through owner feedback; do not relax them.
2. `term-motion-demo.html` — the reference implementation. 14 approved
   scenarios, a phased timeline engine (~700 lines, single file, vanilla JS +
   WAAPI), pause/slow-mo tooling. When spec text is ambiguous, this file is
   the ground truth. Run it, use slow-mo (default) + Pause to study any frame.
3. This brief — context, mapping, backlog, and the judgment calls already made.

## Mapping the engine to the app

The testbed's scenario schema is the contract to preserve, generalized:

- **Token identity.** The app's expression tree must yield stable token ids
  across history steps. This is the load-bearing requirement: if the renderer
  rebuilds tokens from scratch each step (typical React), moving is impossible
  and everything silently degrades to crossfades. Key by node identity in the
  CAS/AST, not by position or value.
- **Step diff → transition script.** Each history entry already names its
  operation and operands ("moved −3 across", "divided both sides by 2"). Map
  operation type → primitive (see spec appendix), operands → actors, and
  compute the token classification (unchanged / moved / mutated / created /
  destroyed / merged / split) from the before/after trees.
- **Layout.** The testbed's layout is a minimal hand-rolled line +
  fraction + superscript system. The app presumably has real math layout
  (KaTeX/MathJax or custom). Keep the testbed's FLIP approach: snapshot
  per-token boxes in layout N, compute layout N+1, animate transforms between
  them, with the phase timeline deciding WHO moves WHEN. The spec's typesetting
  rules (§10) tell you which metrics matter (math axis, ink bounds — use
  canvas.measureText actualBoundingBox*, not tuned constants).
- **Clock.** One pausable rAF clock owns all phase events (see testbed's
  `clock`). Never raw setTimeout — pause/scrub/interrupt all depend on this.

## Decisions already made (do not relitigate)

- **Snap-complete, never blend, never queue** (spec §13). The owner explicitly
  rejected mid-flight blending: this app is canonical-state, not
  direct-manipulation. If you find yourself writing animation-state
  interpolation for interrupted transitions, stop.
- **Chords are parallel** — distribution/factoring is O(1) in term count.
  Owner rejected per-term sequencing ("imagine 100 terms").
- **Slow-mo + Pause are developer tools**, not product features, but keep them
  behind a flag — every review round used them.
- **Emphasis: orange color + slight scale, coefficient-glyph precision,
  retires at contact.** Boxes were explicitly rejected; lingering highlights
  were explicitly rejected (twice — read §3 carefully).
- **Intermediate paper states are rendered and held** (§9), including `8/2`
  and `a⁵⁻²` — the owner asked for these specifically.

## Backlog (prioritized)

Warm-ups — pure scenario data on existing primitives:
1. Multiply both sides (`x/2 = 4 → x = 8`) — mirror of divide.
2. Cancel additive pair (`x + 3 − 3 → x`) — annihilation, no fraction.
3. Evaluate chains (`35 − 14 + 8 → 29`) — chained merges; ask the owner:
   sequential paper-order vs single chord.
4. Exponent power rule (`(a³)² → a⁶`), zero/identity absorption, substitution
   of a value.

Real extensions:
5. Radicals (`√(x²) → x`) — new structural container that scales to content
   (like parens, but 2D); follows §8 causality.
6. Two-line operations (substitute between equations, elimination) — needs a
   second line and inter-line travel; biggest layout step.
7. Reverse playback (§11) — inverse choreography per primitive; factor ⇄
   distribute already proves the pattern.
8. Replay-the-derivation pacing (§13) — breaths, tempo.

## Acceptance tests (run on every new operation)

- Freeze-frame test at 5 random moments: fully legible, no duplicate glyphs,
  ≤1 dominant gesture, no semi-transparent token that exists in both steps.
- Emphasis audit: nothing highlighted at rest; all emphasis gone by the
  contact beat; only operation-touched glyphs ever lit.
- Causality audit: containers present while acted through; sources transform
  after visible separation but before arrival; intermediate paper states held.
- Interruption audit: navigate mid-flight → snap-complete + clean play, no
  queue, no ghost.
- `prefers-reduced-motion` → final state + diff highlight.

## Working style that worked (for whoever prompts you)

The owner reviews with screenshots + slow-mo and gives precise, physical
feedback ("landed at wrong place", "unnecessarily fades", "should change WHILE
it travels"). Treat each note as a rule to generalize, not a one-off fix —
every §-rule in the spec started as one such note. When a request is ambiguous
between two choreographies, implement the one that keeps causality visible and
ask with a paused-frame screenshot.
