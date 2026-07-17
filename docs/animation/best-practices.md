# Animation best practices — cited rules, and where this engine stands

Researched from the major design systems and the vision-science literature
(Material Design 2/3, IBM Carbon, Apple HIG, Disney's 12 principles via Val
Head / NN-Group / IxDF, and peer-reviewed eye-movement papers). Each rule is a
one-line, ideally machine-checkable statement with its source and this engine's
current status: **✓ met**, **~ partial**, **✗ gap**.

The engine plays each algebra step as a phased film:
`emphasis → travel → hold → merge → reflow` (`beginGlyphTransition`).

---

## Tree-native choreography

Tree operations now record both the literal post-operation paper state and the
canonical result. Replay plans two explicit stages when they differ:
`move → simplify`. The first stage carries the grabbed semantic handle, target
side and sink; the second has no traveling actor and resolves cancellations,
coefficient arithmetic and canonical ordering after a readable hold.

For example, moving `3` in `e⁵/x = 3e²sin(y)` first renders
`e⁵/x/3 = 3e²sin(y)/3`, then simplifies to `e⁵/(3x) = e²sin(y)`. This contract
is checked by `scripts/test-tree-animation.ts` and survives shared-history
round trips.

---

## 1. Per-phase timing & easing

| # | Rule | Number / curve | Source | Status |
|---|---|---|---|---|
| P1 | Emphasis is a brief in-place cue, not a stall | 70–150 ms, `standard` easing | Carbon fast-01/02; M3 short | ✓ flat + tree (70 ms) |
| P2 | Travel is eased, never linear | `cubic-bezier(0.2,0,0,1)` emphasized | M3; Val Head | ✓ flat + semantic tree actors |
| P3 | Travel duration scales with distance (constant *perceived* speed) | 250–500 ms ∝ px | M2/M3, Carbon area rule | ✗ fixed 600/680 ms, distance-independent |
| P4 | Entering/landing uses a **decelerate** curve | `cubic-bezier(0.05,0.7,0.1,1)` | M3 emphasized-decelerate | ~ SETTLE is decel-ish but front-loaded |
| P5 | Merge/exit uses an **accelerate** curve, faster than entrance | `cubic-bezier(0.3,0,0.8,0.15)`, ~195 vs 225 ms | M2/M3 | ~ merge exists flat only |
| P6 | Hold a term ≥ one fixation so it's read | ≥ 250 ms | vision: fixation 225–250 ms | ✓ flat merge + tree paper state |
| P7 | Whole step under the flow-of-thought limit | < 1 s total | NN-G response limits | ✓ (~1.6 s worst… ~ borderline) |

## 2. Phase bridging — making it read as ONE gesture

| # | Rule | Statement | Source | Status |
|---|---|---|---|---|
| B1 | **C1 continuity**: end-velocity of phase N = start-velocity of N+1 | vector equality at each join | KTH Bézier continuity | ✗ not checked; phases are independent tweens |
| B2 | **No dead stop** mid-gesture | `velocity==0` only allowed where phase is a *hold* | AE graph-editor practice | ~ travel→hold→merge each start/stop at 0 |
| B3 | **Overlap > 0**: incoming phase starts before outgoing ends | `start(N+1) < end(N)` | Material shared-axis; overlapping action | ✗ phases are strictly sequential (gaps even: e.g. reflow starts 30 ms *after* merge) |
| B4 | Carry `(presentation value, current velocity)` across a handoff | never restart from the logical target | Apple/Framer handoff | ✗ each phase re-anchors |
| B5 | Incoming duration > outgoing so windows overlap | e.g. 300 in / 250 out | M3 container transform | ✗ |
| B6 | Settle with a small overshoot **only** if momentum was carried in | damped, bounce≈0.8 | 12-principles follow-through | ✗ monotonic decel to exact target |

## 3. Eye-tracking constraints

| # | Rule | Number | Source | Status |
|---|---|---|---|---|
| E1 | ≤ 4 independently moving terms ever; **= 1** for an attention step | 1–4 | MOT "magic number 4"; Val Head | ✗ tree reflow moves 6+ glyphs at once |
| E2 | Pursued term ≤ ~30 deg/s (≈ steady, not a lunge) | ≤30 deg/s | pursuit velocity limit | ~ flat travel now even · ✗ reflow lunges |
| E3 | Keep ≥ 2–3 term-widths clearance between movers; route the actor clear | proximity, not speed, breaks tracking | Franconeri MOT | ✗ not considered |
| E4 | Travel along a curved **arc**, not a straight diagonal | nonzero curvature; stagger X/Y | Disney arcs; Carbon | ~ flat travel arcs · ✗ tree/reflow straight |
| E5 | Morph at the meaningful instant — only when the glyph is **stopped** and foveated | v=0 at the change | change-blindness (Rensink) | ✓ flat merge swaps at rest · n/a tree |

## 4. Anti-patterns (must not do)

| # | Anti-pattern | Rule | Source | Status |
|---|---|---|---|---|
| A1 | Linear easing on travel | reject `linear` | Material; MDN | ✓ none linear |
| A2 | Front-loaded ease-out that "lunges then creeps" | flag if >X% distance in first 20% of time | Josh Collinsworth; M3 | ✗ **reflow SETTLE lunges** (78px in frame 1 of 371px) |
| A3 | Crossfading a surviving element (ghost/double image) | a same-id element must translate, not opacity-swap | Jake Archibald; Material | ✓ survivors move |
| A4 | Two opaque copies of one element on a frame | ≤1 opaque instance per id per frame | Material continuity | ✓ not observed |
| A5 | Opacity where spatial change is the meaning | repositioned element must translate | Material container transform | ✓ |
| A6 | Reflow before the change is delivered | `t_reflow ≥ t_change` | Material choreography | ✓ flat (reflow last) · n/a tree |
| A7 | Distance-independent / extreme duration | 100–500 ms, ∝ distance | NN-G; Carbon | ✗ fixed durations (P3) |
| A8 | Ignoring `prefers-reduced-motion` | must branch to instant/opacity | WCAG 2.3.3 / C39 | ✓ `reduced` path exists |

---

## Prioritized gaps (what to fix, biggest first)

1. **Reflow easing lunges (A2/E2).** The reflow/`SETTLE` curve is front-loaded
   like the old travel curve was; give it the even `cubic-bezier(0.3,0.2,0.5,1)`
   treatment (or a decelerate curve) so simultaneous glyph glides don't lunge.
2. **Phase bridging (B1–B6).** Phases are independent start-stop tweens with
   *gaps* between them; adopt overlap>0 and velocity carry so the film reads as
   one gesture rather than five chunks.
3. **Duration ∝ distance (P3/A7).** Travel/reflow are fixed-duration; a 30 px
   nudge and a 370 px sweep take the same time, so perceived speed swings wildly.
4. **One-dominant-motion in reflow (E1).** Even within a reflow, stagger the
   glyphs (secondary action) instead of moving all at once.

## Turning these into checks

`scripts/test-anim-phases.cjs` already asserts a subset (the philosophy rules).
The B-series (C1 continuity, overlap>0, no dead stop) and A2 (front-load ratio)
are directly computable from a captured trace — the same JSON the "capture
animation" dev toggle downloads — and would extend the harness to score any
step against this table automatically.
