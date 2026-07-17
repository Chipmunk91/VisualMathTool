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
import { addendsOf, type TNode, simplify, tadd, tc, tfn, tmul, tnamed, tpow, tv } from "../src/tools/equation-builder/tree";
import { isAtomicTreeFactorId, treeFactorLayout } from "../src/tools/equation-builder/treeunits";

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
  const renderSide = (node: TNode, side: "left" | "right", selectedIds: string[] | null = null) =>
    renderToStaticMarkup(
      React.createElement(TreeSideView, {
        node,
        side,
        hoveredTermId: null,
        selectedIds,
        onHover: () => undefined,
      })
    );

  const reported = parseEquation("e^3*x = sin(y)*e^5/sqrt(3)");
  if (!reported.ok || !reported.tree) throw new Error("reported regression equation did not reach tree mode");
  const leftHtml = renderSide(reported.tree.left, "left");
  const rightHtml = renderSide(reported.tree.right, "right");
  const leftHandles = handlesIn(leftHtml);
  const rightHandles = handlesIn(rightHtml);
  const leftAddend = addendsOf(reported.tree.left)[0];
  const rightAddend = addendsOf(reported.tree.right)[0];
  const leftLayout = treeFactorLayout(leftAddend.id, leftAddend);
  const rightLayout = treeFactorLayout(rightAddend.id, rightAddend);
  const atomic = (handles: Handle[]) => handles.filter((handle) => isAtomicTreeFactorId(handle.id));

  check(
    "S1 reported left side exposes e^3 and x as factors",
    JSON.stringify(atomic(leftHandles)) ===
      JSON.stringify(leftLayout.numerator.map(({ id, role }) => ({ id, role }))),
    JSON.stringify(leftHandles)
  );
  check(
    "S2 reported right side exposes e^5, sin(y), and √3 independently",
    JSON.stringify(atomic(rightHandles)) ===
      JSON.stringify([...rightLayout.numerator, ...rightLayout.denominator].map(({ id, role }) => ({ id, role }))),
    JSON.stringify(rightHandles)
  );
  check(
    "S3 e^5 keeps its factor handle and nested ln/root operations",
    rightHandles.filter((h) => h.id === rightLayout.numerator[0].id).length === 1 &&
      rightHandles.some((h) => h.role === "lnbase") &&
      rightHandles.some((h) => h.role === "root")
  );
  check("S4 tree variables use the same factor contract", !leftHtml.includes('data-role="xdiv"'));

  const signed = simplify(tmul(tc(-2), tfn("sin", tv("x"))));
  const signedHandles = handlesIn(renderSide(signed, "left"));
  const signedLayout = treeFactorLayout(signed.id, signed);
  check(
    "S5 a leading sign stays separate from positive factor handles",
    JSON.stringify(atomic(signedHandles)) ===
      JSON.stringify(signedLayout.numerator.map(({ id, role }) => ({ id, role }))) &&
      signedHandles.some((handle) => handle.id === signed.id && handle.role === "term"),
    JSON.stringify(signedHandles)
  );

  const denominatorOnly = simplify(
    tmul(tpow(tfn("sin", tv("x")), -1), tpow(tadd(tv("x"), tc(1)), -1))
  );
  const denominatorHandles = handlesIn(renderSide(denominatorOnly, "left"));
  const denominatorLayout = treeFactorLayout(denominatorOnly.id, denominatorOnly);
  check(
    "S6 denominator-only products have no phantom numerator handle",
    denominatorLayout.wholeNumerator === null &&
      JSON.stringify(atomic(denominatorHandles)) ===
        JSON.stringify(denominatorLayout.denominator.map(({ id, role }) => ({ id, role }))),
    JSON.stringify(denominatorHandles)
  );

  // Structural actions remain available both standalone and inside a product.
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

  const screenshot = parseEquation("e^5/x = 3*e^2*sin(y)");
  if (!screenshot.ok || !screenshot.tree) throw new Error("screenshot equation did not reach tree mode");
  const screenshotRight = renderSide(screenshot.tree.right, "right");
  const screenshotHandles = handlesIn(screenshotRight);
  const screenshotAddend = addendsOf(screenshot.tree.right)[0];
  const screenshotLayout = treeFactorLayout(screenshotAddend.id, screenshotAddend);
  check(
    "S9 the reported 3, e² and sin(y) product exposes its three factor handles",
    JSON.stringify(atomic(screenshotHandles)) ===
      JSON.stringify(screenshotLayout.numerator.map(({ id, role }) => ({ id, role }))) &&
      !screenshotRight.includes('data-role="term">·'),
    JSON.stringify(screenshotHandles)
  );
  const selectedIds = screenshotLayout.numerator.slice(1).map((unit) => unit.id);
  const selectedRight = renderSide(screenshot.tree.right, "right", selectedIds);
  check(
    "S10 a selected factor chunk highlights exactly its member handles",
    (selectedRight.match(/data-selected="true"/g) ?? []).length === 2 &&
      selectedIds.every((id) => selectedRight.includes(`data-term-id="${id}"`))
  );

  const landed = simplify(tmul(tc(1, 3), tfn("exp", tc(5)), tpow(tv("x"), -1)));
  const landedHandles = handlesIn(renderSide(landed, "left"));
  const landedLayout = treeFactorLayout(landed.id, landed);
  check(
    "S11 a divided coefficient renders as a denominator unit beside x",
    JSON.stringify(atomic(landedHandles)) ===
      JSON.stringify([...landedLayout.numerator, ...landedLayout.denominator].map(({ id, role }) => ({ id, role }))),
    JSON.stringify(landedHandles)
  );

  const piProduct = simplify(tmul(tnamed("pi"), tv("x")));
  const piHandles = handlesIn(renderSide(piProduct, "left"));
  const piLayout = treeFactorLayout(piProduct.id, piProduct);
  check(
    "S12 π renders as a movable symbolic coefficient",
    JSON.stringify(atomic(piHandles)) ===
      JSON.stringify(piLayout.numerator.map(({ id, role }) => ({ id, role }))) &&
      piLayout.numerator[0]?.role === "coef",
    JSON.stringify(piHandles)
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
