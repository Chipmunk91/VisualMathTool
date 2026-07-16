/**
 * Renderer-level contract for tree equation grab targets.
 *
 * The algebra suite proves that factor moves are correct. This suite renders
 * the actual markup and proves that each visible factor gets exactly one
 * actionable hitbox, so nested syntax cannot steal its pointer drag.
 *
 * Run: npx tsx scripts/test-symbol-handles.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseEquation } from "../src/tools/equation-builder/parse";
import { type TNode, simplify, tadd, tc, tfn, tmul, tpow, tv } from "../src/tools/equation-builder/tree";

let pass = 0;
let fail = 0;
const check = (name: string, condition: boolean, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? `  [${detail}]` : ""}`);
  condition ? pass++ : fail++;
};

interface Handle {
  id: string;
  role: string;
}

const handlesIn = (html: string): Handle[] =>
  Array.from(html.matchAll(/<span ([^>]*data-symbol="true"[^>]*)>/g)).map((match) => ({
    id: match[1].match(/data-term-id="([^"]+)"/)?.[1] ?? "?",
    role: match[1].match(/data-role="([^"]+)"/)?.[1] ?? "?",
  }));

async function main() {
  // The repo preserves JSX for Vite; tsx's server transform uses the classic
  // runtime, so expose React while exercising the component under Node.
  (globalThis as unknown as { React: typeof React }).React = React;
  const { TreeSideView } = await import("../src/tools/equation-builder/treeview");
  const renderSide = (node: TNode, side: "left" | "right") =>
    renderToStaticMarkup(
      React.createElement(TreeSideView, {
        node,
        side,
        hoveredTermId: null,
        selectedIds: null,
        onHover: () => undefined,
      })
    );

  const reported = parseEquation("e^3*x = sin(y)*e^5/sqrt(3)");
  if (!reported.ok || !reported.tree) throw new Error("reported regression equation did not reach tree mode");
  const leftHtml = renderSide(reported.tree.left, "left");
  const rightHtml = renderSide(reported.tree.right, "right");
  const leftHandles = handlesIn(leftHtml);
  const rightHandles = handlesIn(rightHtml);

  check(
    "S1 reported left side exposes e^3 and x as factors",
    JSON.stringify(leftHandles) ===
      JSON.stringify([
        { id: "L0@n0", role: "coef" },
        { id: "L0", role: "term" },
        { id: "L0@n1", role: "numer" },
      ]),
    JSON.stringify(leftHandles)
  );
  check(
    "S2 reported right side exposes e^5, sin(y), and √3 independently",
    JSON.stringify(rightHandles) ===
      JSON.stringify([
        { id: "R0@N", role: "numer" },
        { id: "R0@n0", role: "coef" },
        { id: "R0@n1", role: "numer" },
        { id: "R0", role: "term" },
        { id: "R0@d0", role: "den" },
      ]),
    JSON.stringify(rightHandles)
  );
  check(
    "S3 e^5 has one hitbox and no nested ln/root hitbox",
    rightHandles.filter((h) => h.id === "R0@n0").length === 1 &&
      !rightHtml.includes('data-role="lnbase"') &&
      !rightHtml.includes('data-role="root"')
  );
  check("S4 tree variables use the same factor contract", !leftHtml.includes('data-role="xdiv"'));

  const signed = simplify(tmul(tc(-2), tfn("sin", tv("x"))));
  const signedHandles = handlesIn(renderSide(signed, "left"));
  check(
    "S5 a leading sign stays separate from positive factor handles",
    signedHandles.some((h) => h.id === "L0@n0" && h.role === "coef") &&
      signedHandles.some((h) => h.id === "L0@n1" && h.role === "numer"),
    JSON.stringify(signedHandles)
  );

  const denominatorOnly = simplify(
    tmul(tpow(tfn("sin", tv("x")), -1), tpow(tadd(tv("x"), tc(1)), -1))
  );
  const denominatorHandles = handlesIn(renderSide(denominatorOnly, "left"));
  check(
    "S6 denominator-only products have no phantom numerator handle",
    !denominatorHandles.some((h) => h.id === "L0@N") &&
      denominatorHandles.some((h) => h.id === "L0@d0" && h.role === "den") &&
      denominatorHandles.some((h) => h.id === "L0@d1" && h.role === "den"),
    JSON.stringify(denominatorHandles)
  );

  // Context remains useful: when a power/exponential is the complete addend,
  // its inverse-operation syntax is available. It becomes atomic only when it
  // is one factor among a product, where factor movement is the primary act.
  const standaloneExp = handlesIn(renderSide(tfn("exp", tc(5)), "left"));
  check(
    "S7 standalone e^5 retains ln and fifth-root operations",
    standaloneExp.some((h) => h.role === "lnbase") && standaloneExp.some((h) => h.role === "root"),
    JSON.stringify(standaloneExp)
  );
  const standalonePower = handlesIn(renderSide(tpow(tv("x"), 3), "left"));
  check(
    "S8 standalone x^3 retains its cube-root operation",
    standalonePower.some((h) => h.role === "root"),
    JSON.stringify(standalonePower)
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
