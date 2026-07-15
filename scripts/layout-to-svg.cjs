#!/usr/bin/env node
/**
 * layout-to-svg — render a dev "grab map" capture as a labeled SVG.
 *
 * The equation tool's "grab map" dev button downloads a lossless JSON of every
 * hitbox: its role, term-id, side, text and exact box. A screenshot shows what
 * a region *looks* like; this shows what it *does* — which handle grabs where.
 * Boxes are drawn largest-first so the smaller nested handle sits on top, the
 * same way the picker resolves ties (smallest box at distance 0 wins), so the
 * drawing matches the actual grab behaviour.
 *
 *   node scripts/layout-to-svg.cjs layout-XXXX.json [out.svg]
 */
const fs = require("fs");

const ROLE_COLOR = {
  coef: "#f59e0b",
  numer: "#3b82f6",
  den: "#8b5cf6",
  term: "#14b8a6",
  xdiv: "#ec4899",
  xmul: "#ec4899",
  neg: "#64748b",
  exp: "#ef4444",
  root: "#ef4444",
  raise: "#ef4444",
  lnbase: "#f97316",
  fn: "#0ea5e9",
  factor: "#f59e0b",
  group: "#22c55e",
};
const roleColor = (r) => ROLE_COLOR[r] || "#94a3b8";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node scripts/layout-to-svg.cjs <layout.json> [out.svg]");
    process.exit(1);
  }
  const L = JSON.parse(fs.readFileSync(input, "utf8"));
  if (L.format !== "vmt-layout-capture") console.warn("warning: not a vmt-layout-capture file");

  const syms = L.symbols || [];
  // frame the drawing on the equation's own region, with margin for labels
  const all = syms.map((s) => s.rect).concat(L.equationRect ? [L.equationRect] : []);
  const minx = Math.min(...all.map((r) => r.x)) - 30;
  const miny = Math.min(...all.map((r) => r.y)) - 40;
  const maxx = Math.max(...all.map((r) => r.x + r.w)) + 220; // room for legend
  const maxy = Math.max(...all.map((r) => r.y + r.h)) + 30;
  const W = Math.ceil(maxx - minx);
  const H = Math.ceil(maxy - miny);
  const X = (x) => (x - minx).toFixed(1);
  const Y = (y) => (y - miny).toFixed(1);

  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#0b1220"/>`);
  parts.push(
    `<text x="8" y="20" font-size="14" fill="#e2e8f0" font-family="ui-monospace,monospace">grab map — ${esc(
      L.equationText || ""
    )}  (${L.mode}, ${syms.length} handles)</text>`
  );

  // draw boxes largest-first so the smallest (the one that actually grabs) is on top
  const ordered = syms
    .map((s, i) => ({ s, i, area: s.rect.w * s.rect.h }))
    .sort((a, b) => b.area - a.area);
  for (const { s } of ordered) {
    const c = roleColor(s.role);
    const { x, y, w, h } = s.rect;
    parts.push(
      `<rect x="${X(x)}" y="${Y(y)}" width="${w.toFixed(1)}" height="${h.toFixed(
        1
      )}" fill="${c}" fill-opacity="0.10" stroke="${c}" stroke-width="1.2" stroke-opacity="0.85" rx="2"/>`
    );
  }
  // glyph text + a role tag on each smallest box, drawn last so labels are legible
  const smallestFirst = [...ordered].reverse();
  for (const { s } of smallestFirst) {
    const { x, y, w, h } = s.rect;
    const c = roleColor(s.role);
    // the glyph
    if (s.text) {
      parts.push(
        `<text x="${X(x + w / 2)}" y="${Y(y + h / 2)}" font-size="${Math.min(
          22,
          Math.max(10, h * 0.5)
        ).toFixed(0)}" fill="#f8fafc" text-anchor="middle" dominant-baseline="central" font-family="'Cambria Math',serif">${esc(
          s.text.slice(0, 6)
        )}</text>`
      );
    }
    // role tag above the box (only for reasonably sized boxes to reduce clutter)
    parts.push(
      `<text x="${X(x)}" y="${Y(y - 2)}" font-size="8.5" fill="${c}" font-family="ui-monospace,monospace">${esc(
        s.role || "?"
      )}${s.termId ? " " + esc(s.termId) : ""}</text>`
    );
  }

  // legend
  const roles = [...new Set(syms.map((s) => s.role))];
  let ly = 40;
  const lx = maxx - minx - 200;
  parts.push(`<text x="${lx}" y="${ly}" font-size="11" fill="#e2e8f0" font-family="ui-sans-serif">roles present:</text>`);
  ly += 16;
  for (const r of roles) {
    parts.push(`<rect x="${lx}" y="${ly - 9}" width="11" height="11" fill="${roleColor(r)}" fill-opacity="0.25" stroke="${roleColor(r)}"/>`);
    parts.push(`<text x="${lx + 16}" y="${ly}" font-size="10" fill="#cbd5e1" font-family="ui-monospace,monospace">${esc(r || "?")}</text>`);
    ly += 15;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    parts.join("") +
    `</svg>`;
  const out = process.argv[3] || input.replace(/\.json$/, "") + ".svg";
  fs.writeFileSync(out, svg);
  console.log(`wrote ${out}  (${syms.length} handles, ${W}×${H})`);
}

main();
