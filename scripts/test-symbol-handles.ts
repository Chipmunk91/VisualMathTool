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

interface SpecialAnchor {
  action: string;
  nodeId: string;
  n?: number;
}

const handlesIn = (html: string): Handle[] =>
  Array.from(html.matchAll(/<span ([^>]*data-symbol="true"[^>]*)>/g)).map((match) => ({
    id: match[1].match(/data-term-id="([^"]+)"/)?.[1] ?? "?",
    role: match[1].match(/data-role="([^"]+)"/)?.[1] ?? "?",
  }));

const specialAnchorsIn = (html: string): SpecialAnchor[] =>
  Array.from(html.matchAll(/<span ([^>]*data-special-action="[^"]+"[^>]*)>/g)).map((match) => {
    const rawN = match[1].match(/data-special-n="([^"]+)"/)?.[1];
    return {
      action: match[1].match(/data-special-action="([^"]+)"/)?.[1] ?? "?",
      nodeId: match[1].match(/data-special-node="([^"]+)"/)?.[1] ?? "?",
      n: rawN ? Number(rawN) : undefined,
    };
  });

async function main() {
  // The repo preserves JSX for Vite; tsx's server transform uses the classic
  // runtime, so expose React while exercising the component under Node.
  (globalThis as unknown as { React: typeof React }).React = React;
  const { TreeSideView } = await import("../src/tools/equation-builder/treeview");
  const renderSide = (
    node: TNode,
    side: "left" | "right",
    selectedIds: string[] | null = null,
    rewriteHintIds: string[] | null = null
  ) =>
    renderToStaticMarkup(
      React.createElement(TreeSideView, {
        node,
        side,
        hoveredTermId: null,
        selectedIds,
        rewriteHintIds,
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
  const rightSpecials = specialAnchorsIn(rightHtml);

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
    "S3 e^5 keeps one drag owner plus tap-only ln/root actions",
    rightHandles.filter((h) => h.id === rightLayout.numerator[0].id).length === 1 &&
      rightSpecials.some((special) => special.action === "ln") &&
      rightSpecials.some((special) => special.action === "root" && special.n === 5) &&
      !rightHandles.some((h) => h.role === "lnbase" || h.role === "root"),
    JSON.stringify({ handles: rightHandles, specials: rightSpecials })
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

  // Structural actions are tap anchors, while each complete expression keeps
  // exactly one semantic drag owner.
  const standaloneExpHtml = renderSide(tfn("exp", tc(5)), "left");
  const standaloneExp = handlesIn(standaloneExpHtml);
  const standaloneExpSpecials = specialAnchorsIn(standaloneExpHtml);
  check(
    "S7 standalone e^5 has one owner and ln/fifth-root tap actions",
    standaloneExp.length === 1 &&
      standaloneExp[0].role === "term" &&
      standaloneExpSpecials.some((special) => special.action === "ln") &&
      standaloneExpSpecials.some((special) => special.action === "root" && special.n === 5),
    JSON.stringify({ handles: standaloneExp, specials: standaloneExpSpecials })
  );
  const standalonePowerHtml = renderSide(tpow(tv("x"), 3), "left");
  const standalonePower = handlesIn(standalonePowerHtml);
  const standalonePowerSpecials = specialAnchorsIn(standalonePowerHtml);
  check(
    "S8 standalone x^3 has one owner and a cube-root tap action",
    standalonePower.length === 1 &&
      standalonePower[0].role === "term" &&
      standalonePowerSpecials.some((special) => special.action === "root" && special.n === 3),
    JSON.stringify({ handles: standalonePower, specials: standalonePowerSpecials })
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

  const cubeRootHtml = renderSide(tpow(tadd(tv("x"), tc(1)), tc(1, 3)), "left");
  const cubeRootSpecials = specialAnchorsIn(cubeRootHtml);
  check(
    "S13 reciprocal powers render as indexed radicals with a raise action",
    cubeRootHtml.includes(">3</span><span>√</span>") &&
      cubeRootSpecials.some((special) => special.action === "raise" && special.n === 3),
    cubeRootHtml
  );

  const sinSpecials = specialAnchorsIn(renderSide(tfn("sin", tv("x")), "left"));
  const lnSpecials = specialAnchorsIn(renderSide(tfn("ln", tv("x")), "left"));
  check(
    "S14 special function names expose only their contextual inverse",
    sinSpecials.length === 1 && sinSpecials[0].action === "asin" &&
      lnSpecials.length === 1 && lnSpecials[0].action === "exp",
    JSON.stringify({ sinSpecials, lnSpecials })
  );

  const nestedSpecialHtml = renderSide(tfn("sin", tpow(tv("x"), 3)), "left");
  const nestedSpecials = specialAnchorsIn(nestedSpecialHtml);
  check(
    "S15 deeply nested special glyphs stay tappable without extra drag owners",
    handlesIn(nestedSpecialHtml).length === 1 &&
      nestedSpecials.some((special) => special.action === "asin") &&
      nestedSpecials.some((special) => special.action === "root" && special.n === 3),
    JSON.stringify({ handles: handlesIn(nestedSpecialHtml), specials: nestedSpecials })
  );

  const rewriteExpr = simplify(tmul(tc(2), tadd(tv("x"), tc(3))));
  const hintedHtml = renderSide(rewriteExpr, "left", null, [rewriteExpr.id]);
  check(
    "S16 rewrite hints decorate structure without minting a drag handle",
    hintedHtml.includes("data-rewrite-node=") &&
      handlesIn(hintedHtml).length === handlesIn(renderSide(rewriteExpr, "left")).length,
    hintedHtml
  );

  const repeatedFirst = tmul(tc(2), tadd(tv("x"), tc(3)));
  const repeatedSecond = tmul(tc(2), tadd(tv("x"), tc(3)));
  const repeatedHtml = renderSide(
    tadd(repeatedFirst, repeatedSecond),
    "left",
    null,
    [repeatedFirst.id, repeatedSecond.id]
  );
  check(
    "S17 identical-looking hints retain distinct semantic node ids",
    repeatedHtml.includes(`data-rewrite-node="${repeatedFirst.id}"`) &&
      repeatedHtml.includes(`data-rewrite-node="${repeatedSecond.id}"`),
    repeatedHtml
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
