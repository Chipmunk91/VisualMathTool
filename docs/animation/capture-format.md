# Dev capture — reading an animation without screen video

Screen video is the worst way to hand an animation over for diagnosis. The
codec drops and reorders frames, timing is unpredictable, and every glyph's
position has to be reverse-engineered from pixels. Two recordings of the *same*
replay disagree frame for frame.

The **capture animation** dev toggle (bottom-left of the equation tool, next to
"hit areas") replaces that channel with a lossless one. Turn it on, hit
**replay the derivation**, and when the replay finishes the browser downloads
`anim-trace-<timestamp>.json` — the exact truth of what the engine drew.

## What's in a trace

```jsonc
{
  "format": "vmt-anim-trace",
  "version": 1,
  "steps": [
    {
      "index": 0,
      "label": "moved −3 across",        // the move that produced this step
      "from": "2x − 3 = −7",             // equation before
      "to":   "2x = −4",                 // equation after
      "meta": { "hasActor": true, "hasMerge": true,
                "divisionForm": false, "earlyReflow": false,
                "reduced": false, "legacySite": false },
      "phases": [                         // the choreography windows (ms)
        { "name": "emphasis", "t0": 0,   "t1": 170 },
        { "name": "travel",   "t0": 170, "t1": 630 },
        { "name": "hold",     "t0": 630, "t1": 890 },
        { "name": "merge",    "t0": 890, "t1": 1210 },
        { "name": "reflow",   "t0": 1240,"t1": 1480 }
      ],
      "curtain": 1560,                    // overlay removed, real DOM revealed
      "viewport": { "w": 1280, "h": 900 },
      "glyphs": [                         // id → identity (stable within a step)
        { "id": 0, "key": "2", "bar": false },
        { "id": 4, "key": "=", "bar": false }
        // …
      ],
      "frames": [                         // one entry per animation frame (~rAF)
        {
          "t": 0,                         // ms since the first sampled frame
          "clones": [
            // on-screen box in viewport px (INCLUDES transform + scale),
            // computed opacity, animation role, and current text
            { "id": 0, "x": 512.4, "y": 300.1, "w": 9.6, "h": 22.0,
              "op": 1, "r": "follower", "t": "2" }
            // …every animating clone, this frame
          ]
        }
        // …every frame to the curtain
      ]
    }
    // …one step per replayed transition
  ]
}
```

The box is what the eye sees: `x,y,w,h` come from `getBoundingClientRect`, so a
scaled clone reports its scaled box. `op` is the computed opacity. `r` is the
[animation role](./phase-philosophy.md) (`actor` / `actor-consumed` /
`follower` / `equals` / `sink` / `mutate` / `site` / `died` / `born`). `t` is
the clone's text at that frame — so a sink's mid-merge value swap (`7 → 4`) is
recorded, not lost.

Nothing is inferred. Positions are measured, not decoded from a video.

## Reading it as a picture

Humans read filmstrips, not JSON. The converter turns any trace into an SVG:

```
node scripts/trace-to-filmstrip.cjs anim-trace-XXXX.json [out.svg]
```

One row per step, nine frames sampled evenly across the timeline, each glyph
drawn where it actually was, coloured by role, faded by its real opacity, with
the phase name and timestamp on every cell. It's the same evidence the JSON
carries, laid out for the eye — send it back and forth to point at a specific
frame ("the divisor at 617 ms is already below the bar, but the bar hasn't
drawn yet").

## Why this beats video, concretely

- **Lossless** — every frame, every glyph, exact sub-pixel position. No codec.
- **Tiny** — a full two-step derivation is ~40 KB of JSON, not megabytes.
- **Reconstructable** — the filmstrip regenerates deterministically; two people
  looking at the same trace see identical frames.
- **Machine-checkable** — the same data the phase-verification harness
  (`npm run test:anim`) asserts philosophy against. A trace you dislike can be
  turned straight into a failing test case.
