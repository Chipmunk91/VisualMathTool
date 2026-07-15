# Animation phase philosophy — and how the tool checks it

The replay transition (`beginGlyphTransition` in the equation tool) plays each
history step as a short, phased film. Each phase exists for **one reason about
human perception**. This document states that reason as a rule, and every rule
is checked by `scripts/test-anim-phases.cjs` — a phase-verification harness that
instruments the live animation (`window.__animPhases` + `data-anim-role` tags),
records the clones frame by frame, and asserts the philosophy inside each phase
window.

The overarching law (from `equation-animation-spec.md`): **traceability is
movement.** A thing that survives a step is the same object *moving*; opacity is
for births and deaths only. If the eye can't follow where a term went, the
animation has failed regardless of how smooth it looks.

---

## Phase 1 — Emphasis  (~170 ms, ease-out)

**Why:** before anything moves, give the eye a fixation target. The eye needs
~150 ms to lock onto the thing about to act; if it moves first, the eye chases
and loses the thread.

**Rules (checked):**
- **E1 — the actor is marked.** The acting glyph turns emphasis-colour (orange)
  and/or scales up (~1.07). Nothing else is marked.
- **E2 — nothing has moved.** Every glyph is still at its start position
  (translation ≈ 0). Emphasis is a promise of motion, not motion.
- **E3 — mark the cause, not the effect.** Only glyphs the operation *touches*
  are lit; a term at rest is never lit.

## Phase 2 — Travel  (~460–520 ms, ease-in-out, gentle arc)

**Why:** one dominant motion. The eye can track exactly one moving object; two
simultaneous motions split attention and nothing is followed. So the actor —
and only the actor — moves, while everything else is frozen.

**Rules (checked):**
- **T1 — one dominant motion.** During travel, only actor clones translate;
  followers, the sink, and the `=` are stationary. (Exception: *divide*, where
  the destination is defined by the final layout, so the line early-reflows
  beneath the flight — flagged by `earlyReflow`.)
- **T2 — the `=` is the anchor.** It does not move at all in travel. The eye
  uses it as the fixed frame the rest is read against.
- **T3 — a gentle arc.** The actor lifts then settles (10–20 % of travel
  distance as arc height), reading as *picked up and placed*, not slid — which
  also distinguishes a traveller from the text it passes over.
- **T4 — morph at the meaningful instant.** A sign that flips does so *as it
  crosses* the `=` (~46 % of travel), not smeared across the flight.

## Phase 3 — Hold / Land  (~260 ms, ease-out)

**Why:** render the state a student would write on paper and let the eye read
it. `2x = −7 + 3` is a real intermediate; skipping straight to `−4` hides the
step. The pause is short enough not to stall, long enough to read.

**Rules (checked):**
- **H1 — freeze-frame legible.** Every surviving glyph is fully opaque
  (opacity ≈ 1). No glyph is semi-transparent while it exists in both states.
- **H2 — the actor has landed, not merged.** It sits at an intermediate
  position anchored to the sink's *current* edge — not yet fused, not yet at
  the final layout.
- **H3 — still no reflow.** Followers and `=` have not moved to final.

## Phase 4 — Merge / Consequence  (~320–360 ms, ease-in-out)

**Why:** the discrete change happens at one instant, and combination is a
*fusion* — the mover travels onto its partner and is replaced by the result.
A fade-after-arrival reads as the result *dying*; a fuse reads as *becoming*.

**Rules (checked):**
- **M1 — fuse, not fade in place.** The consumed mover translates onto the sink
  *and* fades there (opacity → 0) — the one place opacity is allowed, because
  it is a true death.
- **M2 — the sink survives and updates.** The sink glyph stays opaque and its
  value swaps (7 → 4) at the merge beat, with a pulse — one discrete event.

## Phase 5 — Reflow  (~240 ms, ease-out)

**Why:** close the gaps *last*, after the meaning has been delivered. Reflowing
earlier would move the frame while the eye is still reading the change.

**Rules (checked):**
- **R1 — followers glide now.** Followers and the `=` translate to the final
  layout only in this phase.
- **R2 — the `=` moves minimally.** Even here it shifts as little as the new
  layout forces — it was the anchor, it stays near home.
- **R3 — settled by the curtain.** When the overlay is removed the real
  equation is shown; no clone is left mid-flight.

## Global rules (checked every frame)

- **GL1 — opacity is for birth and death only.** No clone is semi-transparent
  (0.15 < opacity < 0.9) except a `died`/`actor-consumed` clone inside the
  merge window, or a `born` clone inside its entrance. A survivor is never
  translucent.
- **GL2 — no glyph on screen twice.** At no frame do two opaque clones sit on
  top of each other (a doubled glyph — the crossfade ghost the spec forbids).
- **GL3 — never linear.** No travel/merge/reflow animation uses linear easing.

---

## How a phase "passes"

For each animation test case the harness records the clones through the whole
transition, then for each phase checks its rules against the frames inside that
phase's window (from `window.__animPhases`). A phase **matches its philosophy**
when all its rules hold; the report lists per-case, per-phase pass/fail with the
measured evidence (e.g. "travel: 1 mover, `=` moved 0.3 px → T1,T2 ✓").

## Running it

The engine exposes two test affordances (inert in normal use): each overlay
clone carries `data-anim-role` (`actor` / `actor-consumed` / `follower` /
`equals` / `sink` / `mutate` / `site` / `died`), and every transition publishes
its phase windows to `window.__animPhases`.

```
npm run preview          # in one shell (serves the built app on :4173)
npm run test:anim        # in another — drives the cases, prints the report
```

To inspect a *specific* replay you dislike rather than the fixed cases, use the
**capture animation** dev toggle to download a lossless JSON trace of it, then
read it as a filmstrip (`npm run trace:film <trace.json>`). See
[capture-format.md](./capture-format.md) — the trace carries the same
`data-anim-role` tags and phase windows this harness checks, so a bad trace
converts straight into a new case.

Current cases (add more by dragging a different move before `startReplay`):
1. **move −3 across = (merge into −7)** — the canonical travel + morph + fuse.
2. **divide by 2 (fraction forms → simplifies)** — the §8 slot-assembles-beneath
   exception, so the sink+line move during travel by design.
3. **move x across (survives, no merge)** — the actor lands at its own home; a
   `+` dies and a `−` is born (the only opacity animations).

All three currently match every phase rule (27/27).
