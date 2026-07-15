# Dev grab map — reading a hitbox, not a screenshot

For "I can't grab X" bugs, a screenshot shows what a region *looks* like; it
can't show what it *does*. Which handle picks up where, what each one grabs,
why the one you want isn't there — none of that is in the pixels. The **grab
map** dev button (bottom-left of the equation tool, under "capture animation")
downloads that instead: a lossless JSON of every hitbox.

Turn on nothing — just click **⤓ grab map**. It downloads
`layout-<timestamp>.json`:

```jsonc
{
  "format": "vmt-layout-capture",
  "version": 1,
  "equationText": "e^3 = e^2·x",
  "mode": "tree",                 // or "flat"
  "model": { … },                 // the actual EquationState / TreeEq behind it
  "grabRadius": 28,               // nearestSymbol's pickup radius
  "viewport": { "w": 1280, "h": 900 },
  "equationRect": { "x": …, "y": …, "w": …, "h": … },
  "symbols": [                     // every [data-symbol] grab handle
    { "role": "coef", "termId": "R0@n0", "side": "right",
      "text": "e2", "rect": { "x": 652, "y": 246, "w": 67, "h": 72 } },
    { "role": "lnbase", "termId": "R0", "side": "right",
      "text": "e",  "rect": { … } }
    // …
  ],
  "wraps":  [ … ],                 // [data-term-wrap] term regions
  "parens": [ … ]                  // [data-parens-for] drop zones
}
```

Every grab handle's **role** (what it does — `coef`/`numer` divide, `lnbase`
takes ln, `root` takes a root, `xdiv` divides by a variable, `term` moves the
whole term…), its **term-id**, its **exact box**, and its **text**. Plus the
model behind the render, so a missing handle is obvious: if there's no symbol
whose box covers the thing you tried to grab, that thing isn't grabbable.

## Reading which handle wins where

The picker (`nearestSymbol`) takes the symbol whose box the pointer is inside,
and on ties the **smallest** box wins — so nested handles compose (the `e` of
`e²` grabs the `e`; the padding around it grabs the whole `e²`). The renderer
draws the same way:

```
node scripts/layout-to-svg.cjs layout-XXXX.json [out.svg]   # or: npm run grab:svg
```

Boxes are drawn largest-first so the smaller nested handle sits on top, colour-
coded by role, each tagged `role termId`. It's the "hit areas" overlay, but
exportable, labeled, and matched to what actually grabs. Overlapping boxes show
nesting; a bare region with only a big box over it is a whole-unit grab.

## Why this beats a screenshot

A screenshot of `e²·x` shows an orange `e`. The grab map shows *why*: the `e`
is a `lnbase` handle (drag → ln both sides), and — before the fix — there was
**no** `coef`/`numer` handle over `e²` at all, so "divide by e²" was
ungrabbable. That's a one-line read from the JSON, invisible in the picture.
