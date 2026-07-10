/**
 * The floating matrix — the tool's equivalent of the equation. A bracketed
 * 3×3 of quiet inputs; each cell accepts expressions ("1/2", "sqrt(2)").
 * The scrub slider is an open-world reveal: it only exists once A ≠ I,
 * because until then there is no journey to scrub.
 */
import { useEffect, useState } from "react";
import { evaluate } from "mathjs";
import { useLinAlg } from "./store";
import { entryIndex, isIdentity } from "./lib/mat3";

const fmt = (v: number): string => {
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1000) / 1000;
  return String(r);
};

export function MatrixPanel() {
  const matrix = useLinAlg((s) => s.matrix);
  const t = useLinAlg((s) => s.t);
  const setEntry = useLinAlg((s) => s.setEntry);
  const setT = useLinAlg((s) => s.setT);
  const reset = useLinAlg((s) => s.reset);

  // Cells edit as text and commit on blur/Enter, so "1/" mid-typing is fine
  const [cells, setCells] = useState<string[]>(() => matrix.map(fmt));
  useEffect(() => {
    setCells(matrix.map(fmt));
  }, [matrix]);

  const commit = (row: number, col: number) => {
    const raw = cells[entryIndex(row, col)];
    try {
      const value = evaluate(raw);
      if (typeof value === "number" && isFinite(value)) {
        setEntry(row, col, value);
        return;
      }
    } catch {
      /* fall through to revert */
    }
    setCells(matrix.map(fmt)); // revert the cell to the last good value
  };

  const transformed = !isIdentity(matrix);

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

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-sm backdrop-blur">
        <span className="font-serif text-xl italic text-muted-foreground">A =</span>
        <div className="flex items-stretch">
          <span className="w-1.5 rounded-l border-y border-l border-foreground/50" />
          <div className="grid grid-cols-3 gap-x-1 gap-y-1 px-1.5 py-1">
            {[0, 1, 2].map((row) =>
              [0, 1, 2].map((col) => {
                const i = entryIndex(row, col);
                return (
                  <input
                    key={i}
                    value={cells[i]}
                    onChange={(e) =>
                      setCells((c) => c.map((v, k) => (k === i ? e.target.value : v)))
                    }
                    onBlur={() => commit(row, col)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    spellCheck={false}
                    className="w-14 rounded bg-transparent text-center font-serif text-lg outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60"
                  />
                );
              })
            )}
          </div>
          <span className="w-1.5 rounded-r border-y border-r border-foreground/50" />
        </div>
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
    </div>
  );
}
