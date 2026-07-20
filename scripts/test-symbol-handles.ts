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
import { addendsOf, type TNode, printNode, simplify, tadd, tc, tdiff, tfn, tint, tmul, tnamed, tpow, tv } from "../src/tools/equation-builder/tree";
import type { FactorizationHintView } from "../src/tools/equation-builder/treeview";
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
  surface?: string;
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
      surface: match[1].match(/data-special-surface="([^"]+)"/)?.[1],
    };
  });

async function main() {
  // The repo preserves JSX for Vite; tsx's server transform uses the classic
  // runtime, so expose React while exercising the component under Node.
  (globalThis as unknown as { React: typeof React }).React = React;
  const { TreeSideView } = await import("../src/tools/equation-builder/treeview");
  const { CalculusContextPanel, VisualizationSetup } = await import("../src/tools/equation-builder/contextpanels");
  const { analyzeRelation } = await import("../src/tools/equation-builder/relation");
  const renderSide = (
    node: TNode,
    side: "left" | "right",
    selectedIds: string[] | null = null,
    factorizationHints: ReadonlyMap<string, FactorizationHintView> | null = null
  ) =>
    renderToStaticMarkup(
      React.createElement(TreeSideView, {
        node,
        side,
        hoveredTermId: null,
        selectedIds,
        factorizationHints,
        onHover: () => undefined,
      })
    );
  const hintMap = (...hints: Array<{ before: TNode; after: TNode; label?: string }>) =>
    new Map<string, FactorizationHintView>(
      hints.map(({ before, after, label = "factor the expression" }) => [
        before.id,
        {
          nodeId: before.id,
          label,
          before: printNode(before),
          after: printNode(after),
          onApply: () => undefined,
          onDismiss: () => undefined,
        },
      ])
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

  // A variable exponent makes a power an EXPONENTIAL — its inverse anchor is
  // ln, exactly like e^u (2^x thaws to x·ln 2; an opaque base wraps with the
  // sides > 0 pill). Integer powers keep their root anchor and never gain ln.
  const constBaseExpSpecials = specialAnchorsIn(renderSide(tpow(tc(2), tv("x")), "left"));
  check(
    "S8b 2^x is an exponential: ln tap anchor, no root",
    constBaseExpSpecials.some((special) => special.action === "ln") &&
      !constBaseExpSpecials.some((special) => special.action === "root"),
    JSON.stringify(constBaseExpSpecials)
  );
  const varBaseExpSpecials = specialAnchorsIn(renderSide(tpow(tv("b"), tv("x")), "left"));
  check(
    "S8c b^x offers the ln tap anchor",
    varBaseExpSpecials.some((special) => special.action === "ln"),
    JSON.stringify(varBaseExpSpecials)
  );
  const varExponentSpecials = specialAnchorsIn(renderSide(tpow(tv("x"), tv("b")), "left"));
  check(
    "S8d x^b offers the ln tap anchor",
    varExponentSpecials.some((special) => special.action === "ln"),
    JSON.stringify(varExponentSpecials)
  );
  check(
    "S8e x^3 keeps root-only — an integer power is not an exponential",
    !standalonePowerSpecials.some((special) => special.action === "ln"),
    JSON.stringify(standalonePowerSpecials)
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
    "S14 complete special functions expose only their contextual inverse",
    sinSpecials.length === 1 && sinSpecials[0].action === "asin" &&
      sinSpecials[0].surface === "structure" &&
      lnSpecials.length === 1 && lnSpecials[0].action === "exp" &&
      lnSpecials[0].surface === "structure",
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

  const variableExpHtml = renderSide(tfn("exp", tmul(tc(-1), tv("x"))), "right");
  check(
    "S16 every pixel of e^(-x) belongs to its structural ln action",
    variableExpHtml.includes("data-special-hitbox=\"true\"") &&
      variableExpHtml.includes("data-exponent-layer=\"passive\"") &&
      !variableExpHtml.includes("pointer-events-none") &&
      specialAnchorsIn(variableExpHtml).some(
        (special) => special.action === "ln" && special.surface === "structure"
      ),
    variableExpHtml
  );

  const factorableExpr = simplify(tadd(tmul(tc(2), tv("x")), tc(6)));
  const factoredExpr = simplify(tmul(tc(2), tadd(tv("x"), tc(3))));
  const hintedHtml = renderSide(
    factorableExpr,
    "left",
    null,
    hintMap({ before: factorableExpr, after: factoredExpr, label: "factor out the common term" })
  );
  check(
    "S17 factorization cards sit above structure without minting a drag handle",
    hintedHtml.includes("data-factorization-overlay=") &&
      hintedHtml.includes("data-factorization-target=") &&
      hintedHtml.includes('aria-label="Dismiss factorization suggestion"') &&
      handlesIn(hintedHtml).length === handlesIn(renderSide(factorableExpr, "left")).length,
    hintedHtml
  );

  const repeatedFirst = tmul(tc(2), tadd(tv("x"), tc(3)));
  const repeatedSecond = tmul(tc(2), tadd(tv("x"), tc(3)));
  const repeatedHtml = renderSide(
    tadd(repeatedFirst, repeatedSecond),
    "left",
    null,
    hintMap(
      { before: repeatedFirst, after: simplify(tadd(tmul(tc(2), tv("x")), tc(6))) },
      { before: repeatedSecond, after: simplify(tadd(tmul(tc(2), tv("x")), tc(6))) }
    )
  );
  check(
    "S18 identical-looking factorization cards retain distinct semantic node ids",
    repeatedHtml.includes(`data-factorization-target="${repeatedFirst.id}"`) &&
      repeatedHtml.includes(`data-factorization-target="${repeatedSecond.id}"`),
    repeatedHtml
  );

  const nestedExpHtml = renderSide(tfn("exp", tc(5)), "left");
  const nestedExpSpecials = specialAnchorsIn(nestedExpHtml);
  check(
    "S19 e^5 gives the whole exponential ln and its exponent the more specific root action",
    nestedExpSpecials.some((special) => special.action === "ln" && special.surface === "structure") &&
      nestedExpSpecials.some(
        (special) => special.action === "root" && special.n === 5 && special.surface === "operator"
      ),
    JSON.stringify(nestedExpSpecials)
  );
  check(
    "S20 every contextual action advertises the dashed blue hover treatment",
    (nestedSpecialHtml.match(/outline-dashed/g) ?? []).length === nestedSpecials.length &&
      (nestedSpecialHtml.match(/outline-sky-400\/70/g) ?? []).length === nestedSpecials.length,
    nestedSpecialHtml
  );

  const derivativeHtml = renderSide(tdiff(tv("y"), "x", "ordinary"), "left");
  check(
    "S21 derivative notation is one movable algebra factor with a stable model symbol",
    handlesIn(derivativeHtml).length === 1 &&
      derivativeHtml.includes("data-model-symbol=\"sym_3c\"") &&
      derivativeHtml.includes(">d</span>"),
    derivativeHtml
  );
  const integralHtml = renderSide(tint(tfn("sin", tv("t")), "t", { lower: tc(0), upper: tnamed("pi") }), "right");
  check(
    "S22 definite integrals remain first-class movable notation",
    handlesIn(integralHtml).length === 1 && integralHtml.includes("∫") &&
      integralHtml.includes("π") && integralHtml.includes("data-model-symbol=\"sym_38\""),
    integralHtml
  );

  const multiRelation = parseEquation("y = s*t");
  if (!multiRelation.ok) throw new Error("multivariable UI fixture did not parse");
  const analysis = analyzeRelation(multiRelation.tree);
  const viewHtml = renderToStaticMarkup(
    React.createElement(VisualizationSetup, {
      analysis,
      value: analysis.viewCandidates.find((candidate) => candidate.spec.kind === "scalar-field-2d")!.spec,
      onChange: () => undefined,
    })
  );
  check(
    "S23 visualization setup exposes one-input slices and a two-input field explicitly",
    viewHtml.includes("y against s") && viewHtml.includes("y against t") && viewHtml.includes("y over s, t"),
    viewHtml
  );
  const calculusHtml = renderToStaticMarkup(
    React.createElement(CalculusContextPanel, {
      operation: "differentiate",
      symbols: analysis.symbols,
      context: { mode: "partial", withRespectTo: "s", dependent: ["y"], heldConstant: ["t"] },
      onContext: () => undefined,
      onApply: () => undefined,
      onClose: () => undefined,
    })
  );
  check(
    "S24 calculus panel requires visible per-symbol roles and promises no inference",
    calculusHtml.includes("no target or source is inferred") &&
      calculusHtml.includes("depends on s") && calculusHtml.includes("held constant"),
    calculusHtml
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
