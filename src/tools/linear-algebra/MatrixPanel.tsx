/**
 * The floating matrices and vectors — the tool's equivalent of the equation.
 * Bracketed cells accept expressions ("1/2", "sqrt(2)"). Hovering "A" or "B"
 * opens special matrices (with a θ box for arbitrary rotations). Journey
 * pills sit beside the cards — low, away from the orbit-drag area — and the
 * whole panel is selection-proof so view drags never highlight text.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { evaluate } from "mathjs";
import { useLinAlg } from "./store";
import { apply, baseFor, entryIndex, matEquals, type Dim, type Mat3 } from "./lib/mat3";
import { journeyProduct, stagesFor, type JourneyKind } from "./lib/journey";
import { svd } from "./lib/svd";
import { invert, invert2 } from "./lib/mat3";
import { rankOf } from "./lib/spaces";
import { shareUrl, sharedFromUrl } from "./lib/share";
import { embedSnippet } from "../../lib/embed";

const fmt = (v: number): string => {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
};
const pretty = (v: number): string => fmt(v).replace("-", "−");

const AXIS_NAMES = ["x", "y", "z"];

/** Bracketed grid of expression cells shared by the matrices and vectors */
function Bracketed({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-stretch">
      <span className="w-1.5 rounded-l border-y border-l border-foreground/50" />
      {children}
      <span className="w-1.5 rounded-r border-y border-r border-foreground/50" />
    </div>
  );
}

function useCells(source: number[], commitValue: (index: number, value: number) => void) {
  const [cells, setCells] = useState<string[]>(() => source.map(fmt));
  useEffect(() => {
    setCells(source.map(fmt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.join(",")]);
  const edit = (index: number, text: string) =>
    setCells((c) => c.map((v, k) => (k === index ? text : v)));
  const commit = (index: number) => {
    try {
      const value = evaluate(cells[index]);
      if (typeof value === "number" && isFinite(value)) {
        commitValue(index, value);
        return;
      }
    } catch {
      /* revert below */
    }
    setCells(source.map(fmt));
  };
  return { cells, edit, commit };
}

function Cell({
  value,
  title,
  onChange,
  onCommit,
}: {
  value: string;
  title?: string;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  return (
    <input
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      spellCheck={false}
      className="w-10 select-text rounded bg-transparent text-center font-serif text-base outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60 sm:w-14 sm:text-lg"
    />
  );
}

/** One editable matrix grid (shared by A and B) */
function MatrixCells({
  rows,
  cols,
  cells,
}: {
  rows: Dim;
  cols: Dim;
  cells: ReturnType<typeof useCells>;
}) {
  return (
    <Bracketed>
      <div
        className="grid gap-x-1 gap-y-1 px-1.5 py-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const i = entryIndex(row, col);
            return (
              <Cell
                key={i}
                value={cells.cells[i]}
                title={`how much ${AXIS_NAMES[row]}-output each unit of ${AXIS_NAMES[col]}-input contributes`}
                onChange={(text) => cells.edit(i, text)}
                onCommit={() => cells.commit(i)}
              />
            );
          })
        )}
      </div>
    </Bracketed>
  );
}

/**
 * The "X =" label that opens a menu of special matrices on hover — with a
 * θ box for arbitrary-angle rotations. Shared by A and B.
 */
function SpecialsMenu({ label, onPick }: { label: string; onPick: (m: Mat3) => void }) {
  const [open, setOpen] = useState(false);
  const [angleText, setAngleText] = useState("90");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  };
  const theta = (() => {
    try {
      const value = evaluate(angleText);
      return typeof value === "number" && isFinite(value) ? (value * Math.PI) / 180 : Math.PI / 2;
    } catch {
      return Math.PI / 2;
    }
  })();
  const C = Math.cos(theta);
  const Sn = Math.sin(theta);
  const specials: { name: string; hint: string; m: Mat3 }[] = [
    { name: `Rotate ${angleText}° about z`, hint: "spins the blackboard plane; only the z-axis holds still", m: [C, Sn, 0, -Sn, C, 0, 0, 0, 1] },
    { name: `Rotate ${angleText}° about y`, hint: "turns the floor; the y-axis holds still", m: [C, 0, -Sn, 0, 1, 0, Sn, 0, C] },
    { name: `Rotate ${angleText}° about x`, hint: "tips the blackboard backward; the x-axis holds still", m: [1, 0, 0, 0, C, Sn, 0, -Sn, C] },
    { name: "Shear x by y", hint: "ĵ leans over; areas survive (det = 1)", m: [1, 0, 0, 1, 1, 0, 0, 0, 1] },
    { name: "Stretch ×2", hint: "every direction doubles; volume ×8", m: [2, 0, 0, 0, 2, 0, 0, 0, 2] },
    { name: "Squash y ×½", hint: "space flattens toward the floor; volume halves", m: [1, 0, 0, 0, 0.5, 0, 0, 0, 1] },
    { name: "Reflect x", hint: "a mirror — det is negative, orientation flips", m: [-1, 0, 0, 0, 1, 0, 0, 0, 1] },
    { name: "Project onto xy", hint: "the z direction is crushed to nothing — det = 0", m: [1, 0, 0, 0, 1, 0, 0, 0, 0] },
  ];
  return (
    <div className="relative flex items-center" onMouseLeave={scheduleClose}>
      <button
        onMouseEnter={openMenu}
        onClick={() => setOpen((cur) => !cur)}
        className={`whitespace-nowrap rounded px-0.5 font-serif text-xl italic transition-colors ${
          open ? "text-amber-600" : "text-muted-foreground hover:text-amber-600"
        }`}
        title="Special matrices"
      >
        {label}
      </button>
      {open && (
        <div
          onMouseEnter={openMenu}
          className="absolute bottom-[calc(100%+18px)] left-0 z-40 w-max rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          <div className="flex items-center gap-1 px-3 pb-1 text-xs text-muted-foreground">
            <span className="font-serif italic">θ</span> =
            <input
              value={angleText}
              onChange={(e) => setAngleText(e.target.value)}
              spellCheck={false}
              className="w-12 select-text rounded bg-muted/50 px-1 py-0.5 text-center font-serif outline-none focus:bg-muted"
            />
            °
          </div>
          {specials.map((preset) => (
            <button
              key={preset.name}
              title={preset.hint}
              onClick={() => {
                onPick([...preset.m] as Mat3);
                setOpen(false);
              }}
              className="block w-full rounded-md px-3 py-1.5 text-left font-serif text-sm transition-colors hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
            >
              {preset.name}
            </button>
          ))}
          <div className="mt-1 border-t border-border px-3 pb-0.5 pt-1 text-center text-[10px] text-muted-foreground">
            special matrices
          </div>
        </div>
      )}
    </div>
  );
}

export function MatrixPanel() {
  const matrix = useLinAlg((s) => s.matrix);
  const matrixB = useLinAlg((s) => s.matrixB);
  const journey = useLinAlg((s) => s.journey);
  const rows = useLinAlg((s) => s.rows);
  const cols = useLinAlg((s) => s.cols);
  const t = useLinAlg((s) => s.t);
  const vectors = useLinAlg((s) => s.vectors);
  const setEntry = useLinAlg((s) => s.setEntry);
  const setEntryB = useLinAlg((s) => s.setEntryB);
  const setMatrix = useLinAlg((s) => s.setMatrix);
  const setMatrixB = useLinAlg((s) => s.setMatrixB);
  const setDims = useLinAlg((s) => s.setDims);
  const transpose = useLinAlg((s) => s.transpose);
  const setJourney = useLinAlg((s) => s.setJourney);
  const setT = useLinAlg((s) => s.setT);
  const setVector = useLinAlg((s) => s.setVector);
  const addSecondVector = useLinAlg((s) => s.addSecondVector);
  const removeSecondVector = useLinAlg((s) => s.removeSecondVector);
  const applyShared = useLinAlg((s) => s.applyShared);
  const reset = useLinAlg((s) => s.reset);

  // Load a shared configuration once, if the URL carries one
  useEffect(() => {
    const shared = sharedFromUrl();
    if (shared) applyShared(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matrixCells = useCells([...matrix], (i, value) => setEntry(i % 3, Math.floor(i / 3), value));
  const matrixBCells = useCells([...matrixB], (i, value) => setEntryB(i % 3, Math.floor(i / 3), value));

  /** Presets are written 3×3; B (and a non-3×3 A) takes the visible block */
  const truncateToDims = (m: Mat3): Mat3 => {
    const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) out[entryIndex(r, c)] = m[entryIndex(r, c)];
    return out;
  };

  const square = rows === cols;
  const transformed = !matEquals(matrix, baseFor(cols)) || journey === "compose";
  const stages = stagesFor(journey, matrix, matrixB, rows, cols);
  const product = journeyProduct(stages);
  const stageCount = stages.length;

  // Journey availability
  const invertible = square && (rows === 3 ? invert(matrix) !== null : invert2(matrix) !== null);
  const svdReady = square && transformed && svd(matrix, rows) !== null;

  // Readout on the end-to-end map
  let detText: string;
  if (rows === 3 && cols === 3) {
    const d =
      product[0] * (product[4] * product[8] - product[5] * product[7]) -
      product[3] * (product[1] * product[8] - product[2] * product[7]) +
      product[6] * (product[1] * product[5] - product[2] * product[4]);
    detText =
      Math.abs(d) < 1e-10
        ? `det = 0 — space flattens, volume 0`
        : `det = ${pretty(d)} — volume ×${pretty(Math.abs(d))}${d < 0 ? ", orientation flips" : ""}`;
  } else if (rows === 2 && cols === 2) {
    const d = product[0] * product[4] - product[3] * product[1];
    detText =
      Math.abs(d) < 1e-10
        ? `det = 0 — the plane collapses to a line`
        : `det = ${pretty(d)} — area ×${pretty(Math.abs(d))}${d < 0 ? ", orientation flips" : ""}`;
  } else if (rows === 2 && cols === 3) {
    detText = "no det — a 2×3 flattens 3D onto the plane; all volume is lost";
  } else {
    const cross = [
      product[1] * product[5] - product[2] * product[4],
      product[2] * product[3] - product[0] * product[5],
      product[0] * product[4] - product[1] * product[3],
    ];
    const area = Math.hypot(cross[0], cross[1], cross[2]);
    detText = `no det — a 3×2 embeds the plane into 3D; area ×${pretty(area)}${
      area < 1e-10 ? " (the plane collapses to a line)" : ""
    }`;
  }
  const rank = rankOf(product, rows, cols);

  // Two vectors: dependence makes the span collapse
  const v = vectors[0];
  const w = vectors[1];
  const dependent =
    !!w &&
    (() => {
      const c = [
        v.v[1] * w.v[2] - v.v[2] * w.v[1],
        v.v[2] * w.v[0] - v.v[0] * w.v[2],
        v.v[0] * w.v[1] - v.v[1] * w.v[0],
      ];
      return Math.hypot(c[0], c[1], c[2]) < 1e-8;
    })();

  const journeyPill = (kind: JourneyKind, label: string, enabled: boolean, hint: string) => (
    <button
      key={kind}
      disabled={!enabled}
      title={hint}
      onClick={() => setJourney(journey === kind ? "single" : kind)}
      className={`rounded-full border px-2.5 py-0.5 font-serif text-xs transition-colors ${
        journey === kind
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
          : enabled
            ? "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            : "cursor-not-allowed border-border/50 text-muted-foreground/40"
      }`}
    >
      {label}
    </button>
  );

  const [copied, setCopied] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const currentShareUrl = () =>
    shareUrl({
      rows,
      cols,
      matrix,
      matrixB,
      journey,
      t,
      vectors: vectors.map((u) => u.v),
    });
  const copyShare = () => {
    navigator.clipboard?.writeText(currentShareUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const copyEmbed = () => {
    navigator.clipboard?.writeText(embedSnippet(currentShareUrl(), "Matrix Meets Vector")).then(() => {
      setCopiedEmbed(true);
      setTimeout(() => setCopiedEmbed(false), 1500);
    });
  };

  return (
    <>
      {/* share — the whole configuration in a link, or an embeddable iframe */}
      <div className="absolute right-4 top-4 flex items-center gap-2 select-none" data-ui>
        <button
          onClick={copyShare}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Copy a link to this exact configuration"
        >
          {copied ? "copied ✓" : "⧉ share"}
        </button>
        <button
          onClick={copyEmbed}
          className="rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          title="Copy an iframe of this exact configuration — plug it into any page"
        >
          {copiedEmbed ? "copied ✓" : "</>"}
        </button>
      </div>

      <div
        className="absolute bottom-6 left-1/2 flex max-w-[96vw] -translate-x-1/2 select-none flex-col items-center gap-2.5 sm:max-w-none"
        data-ui
      >
        {/* scrub across all stages */}
        {transformed && (
          <div className="flex w-72 flex-col gap-0.5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-serif italic">I</span>
              <input
                type="range"
                min={0}
                max={stageCount}
                step={0.004}
                value={Math.min(t, stageCount)}
                onChange={(e) => setT(Number(e.target.value))}
                className="h-1 w-full cursor-pointer accent-amber-500"
                title="Scrub the journey"
              />
              <span className="font-serif italic">{journey === "inverse" ? "I" : journey === "compose" ? "BA" : "A"}</span>
            </div>
            {stageCount > 1 && (
              <div className="flex px-6">
                {stages.map((stage) => (
                  <span key={stage.label} className="flex-1 text-center text-[10px] text-muted-foreground">
                    {stage.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-stretch justify-center gap-3 sm:flex-nowrap">
          {/* journeys — chapters for the scrub, tucked beside the cards */}
          {square && transformed && (
            <div className="flex flex-col justify-center gap-1.5">
              {journeyPill("compose", "× B", true, "Compose with a second matrix — B happens after A")}
              {journeyPill("inverse", "A⁻¹", invertible, invertible ? "Watch A⁻¹ undo A" : "A isn't invertible — nothing can undo it")}
              {journeyPill("svd", "SVD", svdReady, svdReady ? "Every matrix is rotate → stretch → rotate" : "SVD unavailable here")}
            </div>
          )}

          {/* B card — appears for the composition journey, left of A since B·A */}
          {journey === "compose" && (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
              <SpecialsMenu label="B =" onPick={(m) => setMatrixB(truncateToDims(m))} />
              <MatrixCells rows={rows} cols={cols} cells={matrixBCells} />
            </div>
          )}

          {/* A card, with the special-matrix menu on hover */}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
            <SpecialsMenu
              label="A ="
              onPick={(m) => {
                if (rows !== 3 || cols !== 3) setDims(3, 3);
                setMatrix(m);
              }}
            />
            <MatrixCells rows={rows} cols={cols} cells={matrixCells} />

            {/* shape, transpose, reset */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="flex items-center text-xs text-muted-foreground"
                title="The shape of A: rows = output space, columns = input space"
              >
                <button
                  onClick={() => setDims(rows === 3 ? 2 : 3, cols)}
                  title="Toggle the output dimension (rows)"
                  className="rounded px-1 font-serif text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-amber-600"
                >
                  {rows}
                </button>
                <span className="px-0.5">×</span>
                <button
                  onClick={() => setDims(rows, cols === 3 ? 2 : 3)}
                  title="Toggle the input dimension (columns)"
                  className="rounded px-1 font-serif text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-amber-600"
                >
                  {cols}
                </button>
              </div>
              <button
                onClick={transpose}
                className="rounded-full border border-border px-2.5 py-0.5 font-serif text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                title="Transpose — rows become columns (a 2×3 becomes a 3×2)"
              >
                Aᵀ
              </button>
              {transformed && (
                <button
                  onClick={reset}
                  className="rounded-full border border-border px-2.5 py-0.5 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                  title="Back to the identity"
                >
                  ↺
                </button>
              )}
            </div>
          </div>

          {/* vector card(s) — vectors live in the input space (`cols` entries) */}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
            {vectors.map((u) => {
              const cells = Array.from({ length: cols }, (_, i) => i);
              return (
                <div key={u.id} className="flex items-center gap-2">
                  <span className="whitespace-nowrap font-serif text-xl italic" style={{ color: u.color }}>
                    {u.label} =
                  </span>
                  <Bracketed>
                    <div className="flex flex-col gap-y-1 px-1.5 py-1">
                      {cells.map((i) => (
                        <VectorCell key={`${u.id}${i}`} vec={u} index={i} onCommit={setVector} />
                      ))}
                    </div>
                  </Bracketed>
                </div>
              );
            })}
            {vectors.length < 2 ? (
              <button
                onClick={addSecondVector}
                className="rounded-full border border-border px-2 py-0.5 font-serif text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                title="Add a second vector — their span becomes visible"
              >
                +w
              </button>
            ) : (
              <button
                onClick={removeSecondVector}
                className="self-start rounded-full px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                title="Remove w"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* what the map did, in numbers — only meaningful once something moved */}
        {transformed && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {vectors.map((u) => {
              const out = apply(product, u.v);
              return (
                <span key={u.id}>
                  <span className="font-serif italic" style={{ color: u.color }}>
                    {journey === "compose" ? `BA${u.label}` : `A${u.label}`}
                  </span>{" "}
                  = ({out.slice(0, rows).map(pretty).join(", ")})
                </span>
              );
            })}
            <span>{detText}</span>
            {rank < Math.min(rows, cols) && <span>rank {rank}</span>}
            {dependent && <span className="text-amber-600">v and w are parallel — their span is a line, not a plane</span>}
          </div>
        )}
      </div>
    </>
  );
}

/** A single vector component cell, committing through the store */
function VectorCell({
  vec,
  index,
  onCommit,
}: {
  vec: { id: string; v: [number, number, number] };
  index: number;
  onCommit: (id: string, v: [number, number, number]) => void;
}) {
  const [text, setText] = useState(fmt(vec.v[index]));
  useEffect(() => {
    setText(fmt(vec.v[index]));
  }, [vec.v, index]);
  const commit = () => {
    try {
      const value = evaluate(text);
      if (typeof value === "number" && isFinite(value)) {
        const next = [...vec.v] as [number, number, number];
        next[index] = value;
        onCommit(vec.id, next);
        return;
      }
    } catch {
      /* revert */
    }
    setText(fmt(vec.v[index]));
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      spellCheck={false}
      className="w-10 select-text rounded bg-transparent text-center font-serif text-base outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60 sm:w-14 sm:text-lg"
    />
  );
}
