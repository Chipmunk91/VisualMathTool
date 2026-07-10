/**
 * The floating matrix and vector — the tool's equivalent of the equation.
 * Bracketed cells accept expressions ("1/2", "sqrt(2)"). Hovering the "A"
 * opens a menu of special matrices. The scrub slider, the reset, and the
 * det/Av readout are open-world reveals: they only exist once A ≠ I.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { evaluate } from "mathjs";
import { useLinAlg } from "./store";
import { apply, det, entryIndex, isIdentity, type Mat3 } from "./lib/mat3";

const fmt = (v: number): string => {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
};
const pretty = (v: number): string => fmt(v).replace("-", "−");

const S = Math.SQRT1_2; // sin/cos 45°

/** Special matrices, column-major (columns = where î ĵ k̂ land) */
const SPECIAL: { name: string; hint: string; m: Mat3 }[] = [
  { name: "Rotate 90° about z", hint: "spins the blackboard plane; only the z-axis holds still", m: [0, 1, 0, -1, 0, 0, 0, 0, 1] },
  { name: "Rotate 45° about y", hint: "no real eigenvector in the plane — everything turns", m: [S, 0, -S, 0, 1, 0, S, 0, S] },
  { name: "Shear x by y", hint: "ĵ leans over; areas survive (det = 1)", m: [1, 0, 0, 1, 1, 0, 0, 0, 1] },
  { name: "Stretch ×2", hint: "every direction doubles; volume ×8", m: [2, 0, 0, 0, 2, 0, 0, 0, 2] },
  { name: "Squash y ×½", hint: "space flattens toward the floor; volume halves", m: [1, 0, 0, 0, 0.5, 0, 0, 0, 1] },
  { name: "Reflect x", hint: "a mirror — det is negative, orientation flips", m: [-1, 0, 0, 0, 1, 0, 0, 0, 1] },
  { name: "Project onto xy", hint: "the z direction is crushed to nothing — det = 0", m: [1, 0, 0, 0, 1, 0, 0, 0, 0] },
];

/** Bracketed grid of expression cells shared by A and v */
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
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      spellCheck={false}
      className="w-14 rounded bg-transparent text-center font-serif text-lg outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60"
    />
  );
}

export function MatrixPanel() {
  const matrix = useLinAlg((s) => s.matrix);
  const t = useLinAlg((s) => s.t);
  const vectors = useLinAlg((s) => s.vectors);
  const setEntry = useLinAlg((s) => s.setEntry);
  const setMatrix = useLinAlg((s) => s.setMatrix);
  const setT = useLinAlg((s) => s.setT);
  const setVector = useLinAlg((s) => s.setVector);
  const reset = useLinAlg((s) => s.reset);

  const matrixCells = useCells([...matrix], (i, value) => setEntry(i % 3, Math.floor(i / 3), value));
  const v = vectors[0];
  const vectorCells = useCells([...v.v], (i, value) => {
    const next = [...v.v] as [number, number, number];
    next[i] = value;
    setVector(v.id, next);
  });

  // Special-matrix menu on hovering "A"
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setMenuOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setMenuOpen(false), 250);
  };

  const transformed = !isIdentity(matrix);
  const d = det(matrix);
  const av = apply(matrix, v.v);
  const detNote =
    Math.abs(d) < 1e-10
      ? "space flattens — volume 0"
      : `volume ×${pretty(Math.abs(d))}${d < 0 ? ", orientation flips" : ""}`;

  return (
    <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3" data-ui>
      {/* scrub: identity → A. Appears only once there is a transformation */}
      {transformed && (
        <div className="flex w-64 items-center gap-3 text-xs text-muted-foreground">
          <span className="font-serif italic">I</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.002}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            className="h-1 w-full cursor-pointer accent-amber-500"
            title="Scrub the transformation from identity to A"
          />
          <span className="font-serif italic">A</span>
        </div>
      )}

      <div className="flex items-stretch gap-3">
        {/* A card, with the special-matrix menu on hover */}
        <div
          className="relative flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur"
          onMouseLeave={scheduleClose}
        >
          <button
            onMouseEnter={openMenu}
            onClick={() => setMenuOpen((cur) => !cur)}
            className={`rounded px-0.5 font-serif text-xl italic transition-colors ${
              menuOpen ? "text-amber-600" : "text-muted-foreground hover:text-amber-600"
            }`}
            title="Special matrices"
          >
            A =
          </button>
          {menuOpen && (
            <div
              onMouseEnter={openMenu}
              className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-max rounded-lg border border-border bg-card p-1.5 shadow-lg"
            >
              {SPECIAL.map((preset) => (
                <button
                  key={preset.name}
                  title={preset.hint}
                  onClick={() => {
                    setMatrix([...preset.m] as Mat3);
                    setMenuOpen(false);
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
          <Bracketed>
            <div className="grid grid-cols-3 gap-x-1 gap-y-1 px-1.5 py-1">
              {[0, 1, 2].map((row) =>
                [0, 1, 2].map((col) => {
                  const i = entryIndex(row, col);
                  return (
                    <Cell
                      key={i}
                      value={matrixCells.cells[i]}
                      onChange={(text) => matrixCells.edit(i, text)}
                      onCommit={() => matrixCells.commit(i)}
                    />
                  );
                })
              )}
            </div>
          </Bracketed>
          {transformed && (
            <button
              onClick={reset}
              className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              title="Back to the identity matrix"
            >
              ↺
            </button>
          )}
        </div>

        {/* v card */}
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
          <span className="font-serif text-xl italic" style={{ color: "#d97706" }}>
            v =
          </span>
          <Bracketed>
            <div className="flex flex-col gap-y-1 px-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <Cell
                  key={i}
                  value={vectorCells.cells[i]}
                  onChange={(text) => vectorCells.edit(i, text)}
                  onCommit={() => vectorCells.commit(i)}
                />
              ))}
            </div>
          </Bracketed>
        </div>
      </div>

      {/* what the map did, in numbers — only meaningful once A ≠ I */}
      {transformed && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <span className="font-serif italic" style={{ color: "#d97706" }}>
              Av
            </span>{" "}
            = ({av.map(pretty).join(", ")})
          </span>
          <span>
            det <span className="font-serif italic">A</span> = {pretty(d)} — {detNote}
          </span>
        </div>
      )}
    </div>
  );
}
