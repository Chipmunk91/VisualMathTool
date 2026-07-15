#!/usr/bin/env node
/**
 * trace-to-filmstrip — render a dev-capture animation trace as an SVG filmstrip.
 *
 * The equation tool's "capture animation" dev toggle downloads a lossless JSON
 * trace of a replay: every animating clone's exact on-screen box, opacity, role
 * and text, sampled every frame, with the phase windows labeled. That JSON is
 * the precise channel (screen video is not) — but humans read pictures, so this
 * turns any trace into a filmstrip: one row per history step, a column of
 * frames sampled across the timeline, each glyph drawn where it actually was,
 * coloured by its animation role, faded by its actual opacity.
 *
 *   node scripts/trace-to-filmstrip.cjs anim-trace-XXXX.json [out.svg]
 *
 * With no out path it writes <input>.svg beside the trace.
 */
const fs = require("fs");
const path = require("path");

const ROLE_COLOR = {
  actor: "#f59e0b",
  "actor-consumed": "#f59e0b",
  follower: "#64748b",
  equals: "#0f172a",
  sink: "#14b8a6",
  mutate: "#a855f7",
  site: "#3b82f6",
  died: "#ef4444",
  born: "#22c55e",
};
const roleColor = (r) => ROLE_COLOR[r] || "#94a3b8";

const CELL_W = 260;
const CELL_H = 150;
const PAD = 12;
const HEADER_H = 22;
const ROW_LABEL_H = 40;
const FRAMES = 9; // columns per step

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function phaseAt(step, t) {
  for (const p of step.phases) if (t >= p.t0 && t <= p.t1) return p.name;
  // between phases (a gap): name the last one that ended
  let last = "";
  for (const p of step.phases) if (t >= p.t0) last = p.name;
  return last;
}

function nearestFrame(frames, t) {
  let best = frames[0];
  let bd = Infinity;
  for (const f of frames) {
    const d = Math.abs(f.t - t);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

function stepBounds(step) {
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const f of step.frames)
    for (const c of f.clones) {
      minx = Math.min(minx, c.x);
      miny = Math.min(miny, c.y);
      maxx = Math.max(maxx, c.x + c.w);
      maxy = Math.max(maxy, c.y + c.h);
    }
  if (!isFinite(minx)) return { minx: 0, miny: 0, maxx: 1, maxy: 1 };
  return { minx, miny, maxx, maxy };
}

function renderCell(step, frame, ox, oy) {
  const b = stepBounds(step);
  const bw = b.maxx - b.minx || 1;
  const bh = b.maxy - b.miny || 1;
  const scale = Math.min((CELL_W - 2 * PAD) / bw, (CELL_H - 2 * PAD) / bh);
  const drawW = bw * scale;
  const drawH = bh * scale;
  const offx = ox + (CELL_W - drawW) / 2;
  const offy = oy + (CELL_H - drawH) / 2;
  const px = (x) => offx + (x - b.minx) * scale;
  const py = (y) => offy + (y - b.miny) * scale;

  const parts = [];
  // cell frame + phase label
  const phase = phaseAt(step, frame.t);
  parts.push(
    `<rect x="${ox}" y="${oy}" width="${CELL_W}" height="${CELL_H}" fill="#fff" stroke="#e2e8f0"/>`
  );
  parts.push(
    `<text x="${ox + 6}" y="${oy + 13}" font-size="10" fill="#475569" font-family="ui-monospace,monospace">${frame.t}ms · ${esc(
      phase
    )}</text>`
  );

  // glyph id -> is-bar
  const barOf = {};
  for (const g of step.glyphs) barOf[g.id] = g.bar;

  for (const c of frame.clones) {
    const x = px(c.x);
    const y = py(c.y);
    const w = Math.max(1, c.w * scale);
    const h = Math.max(1, c.h * scale);
    const col = roleColor(c.r);
    const op = Math.max(0.05, c.op);
    if (barOf[c.id]) {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(
          1
        )}" height="${Math.max(1.5, h).toFixed(1)}" fill="${col}" opacity="${op}"/>`
      );
    } else {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const fs = Math.max(7, Math.min(16, h * 0.95));
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${cy.toFixed(
          1
        )}" font-size="${fs.toFixed(
          1
        )}" fill="${col}" opacity="${op}" text-anchor="middle" dominant-baseline="central" font-family="'Cambria Math','Times New Roman',serif">${esc(
          c.t
        )}</text>`
      );
    }
  }
  return parts.join("");
}

function renderStep(step, oy) {
  const parts = [];
  const stripW = FRAMES * CELL_W;
  parts.push(
    `<text x="4" y="${oy + 15}" font-size="13" fill="#0f172a" font-family="ui-sans-serif,system-ui" font-weight="600">Step ${
      step.index
    }: ${esc(step.label || "")}</text>`
  );
  parts.push(
    `<text x="4" y="${oy + 32}" font-size="11" fill="#64748b" font-family="ui-monospace,monospace">${esc(
      step.from
    )}  →  ${esc(step.to)}</text>`
  );
  const rowY = oy + ROW_LABEL_H;
  for (let i = 0; i < FRAMES; i++) {
    const t = Math.round((step.curtain * i) / (FRAMES - 1));
    const frame = nearestFrame(step.frames, t);
    parts.push(renderCell(step, frame, i * CELL_W, rowY));
  }
  return { svg: parts.join(""), height: ROW_LABEL_H + CELL_H + 18, width: stripW };
}

function legend(y, width) {
  const items = [
    ["actor", "moves"],
    ["follower", "waits, glides last"],
    ["equals", "the anchor"],
    ["sink", "receives / updates"],
    ["mutate", "swaps value"],
    ["died", "fades out (death)"],
    ["born", "fades in (birth)"],
  ];
  const parts = [`<text x="4" y="${y}" font-size="11" fill="#334155" font-family="ui-sans-serif,system-ui" font-weight="600">roles:</text>`];
  let x = 52;
  for (const [role, note] of items) {
    parts.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${roleColor(role)}"/>`);
    parts.push(
      `<text x="${x + 14}" y="${y}" font-size="10" fill="#475569" font-family="ui-sans-serif,system-ui">${role} — ${note}</text>`
    );
    x += 40 + (role.length + note.length) * 5.4;
    if (x > width - 160) {
      x = 52;
      y += 16;
    }
  }
  return { svg: parts.join(""), bottom: y + 8 };
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/trace-to-filmstrip.cjs <trace.json> [out.svg]");
    process.exit(1);
  }
  const trace = JSON.parse(fs.readFileSync(input, "utf8"));
  if (trace.format !== "vmt-anim-trace")
    console.warn("warning: file does not look like a vmt-anim-trace");
  const steps = trace.steps || [];
  const width = Math.max(FRAMES * CELL_W, 700);

  const body = [];
  let y = HEADER_H + 8;
  body.push(
    `<text x="4" y="${HEADER_H}" font-size="15" fill="#0f172a" font-family="ui-sans-serif,system-ui" font-weight="700">animation trace — ${steps.length} step(s), ${FRAMES} frames each</text>`
  );
  const leg = legend(y + 14, width);
  body.push(leg.svg);
  y = leg.bottom + 6;
  for (const step of steps) {
    const r = renderStep(step, y);
    body.push(r.svg);
    y += r.height;
  }
  const height = y + 8;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#f8fafc"/>` +
    body.join("") +
    `</svg>`;

  const out = process.argv[3] || input.replace(/\.json$/, "") + ".svg";
  fs.writeFileSync(out, svg);
  console.log(`wrote ${out}  (${steps.length} steps, ${width}×${height})`);
}

main();
