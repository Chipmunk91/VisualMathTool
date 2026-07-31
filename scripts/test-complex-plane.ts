/**
 * Focused render contract for the standalone complex-plane view.
 *
 * Run: node --import tsx scripts/test-complex-plane.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ComplexPlane,
  complexViewportHalfSpan,
  type ComplexValue,
} from "../src/tools/equation-builder/complexplane";
import {
  ComplexMappingPane,
  evaluateRealMappingValue,
  MappingLensControl,
  scalarHasComplexCarrier,
} from "../src/tools/equation-builder/complexview";
import { parseEquation } from "../src/tools/equation-builder/parse";
import { analyzeRelation } from "../src/tools/equation-builder/relation";
import { analyzeIsolationSemantics } from "../src/tools/equation-builder/semantics";

(globalThis as unknown as { React: typeof React }).React = React;

let passed = 0;
let failed = 0;
const check = (name: string, condition: boolean) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  condition ? passed++ : failed++;
};

const staticHtml = renderToStaticMarkup(
  React.createElement(ComplexPlane, {
    value: { re: 3, im: 4 },
  }),
);
check("V1 renders Cartesian components, modulus, and argument", /Re/.test(staticHtml) && /modulus/.test(staticHtml));
check("V2 a read-only plane keeps ordinary vertical touch panning", staticHtml.includes("touch-action:pan-y"));
check("V3 a read-only plane has no interactive plot overlay", !staticHtml.includes("complex-plane control"));

const changedValues: ComplexValue[] = [];
const directHtml = renderToStaticMarkup(
  React.createElement(ComplexPlane, {
    value: { re: 1, im: -1 },
    onValueChange: (value) => changedValues.push(value),
  }),
);
check("V4 direct mode exposes a keyboard-addressable complex-plane control", directHtml.includes("complex-plane control"));
check(
  "V5 direct mode reserves touch only on its plot hit surface",
  directHtml.includes("touch-action:pan-y") && directHtml.includes("touch-action:none"),
);
check("V6 direct mode does not add the path parameter slider", !directHtml.includes('type="range"'));

const pathHtml = renderToStaticMarkup(
  React.createElement(ComplexPlane, {
    value: { re: 1, im: 0 },
    path: {
      valueAt: (parameter) => ({ re: Math.cos(parameter), im: Math.sin(parameter) }),
      parameter: 0,
      min: 0,
      max: 2 * Math.PI,
      onParameterChange: () => undefined,
    },
  }),
);
check("V7 path mode retains its accessible native parameter slider", pathHtml.includes('type="range"'));
check("V8 path rendering never emits invalid SVG coordinates", !pathHtml.includes("NaN"));

const isolationFrom = (text: string) => {
  const parsed = parseEquation(text);
  if (!parsed.ok) throw new Error(parsed.message);
  const isolation = analyzeRelation(parsed.tree).isolations[0];
  if (!isolation) throw new Error(`No explicit isolation for ${text}`);
  return isolation;
};

const squareIsolation = isolationFrom("f(x) = x^2");
const squareSemantics = analyzeIsolationSemantics(squareIsolation);
const squareReal = squareSemantics.mappingCandidates.find((candidate) => candidate.lens === "default-real");
const squareComplex = squareSemantics.mappingCandidates.find(
  (candidate) => candidate.lens === "complex-alternative"
);
if (!squareReal || !squareComplex) throw new Error("Square mapping signatures are missing");
const lensHtml = renderToStaticMarkup(
  React.createElement(MappingLensControl, {
    candidates: squareSemantics.mappingCandidates,
    value: squareReal,
    onChange: () => undefined,
  }),
);
check("V9 the mapping lens exposes its R-to-R signature", lensHtml.includes("x ∈ ℝ") && lensHtml.includes("f ∈ ℝ"));
check("V10 a proven square range is shown without claiming a guessed range", lensHtml.includes("range [0, ∞)"));
check(
  "V10a mapping-lens controls keep a 44px mobile touch target",
  /aria-label="Current mapping[^"]*"[^>]*class="[^"]*min-h-11/.test(lensHtml),
);

const linkedHtml = renderToStaticMarkup(
  React.createElement(ComplexMappingPane, {
    isolation: squareIsolation,
    signature: squareComplex,
    input: "x",
    fixed: {},
    realProbe: 1,
    onRealProbe: () => undefined,
    complexProbe: { re: 1, im: 1 },
    onComplexProbe: () => undefined,
    display: "cartesian",
    onDisplay: () => undefined,
  }),
);
check("V11 C-to-C renders linked input and output planes", (linkedHtml.match(/Complex plane for/g) ?? []).length === 2);
check("V12 only the complex input plane is directly manipulable", (linkedHtml.match(/complex-plane control/g) ?? []).length === 1);

const pathIsolation = isolationFrom("z(t) = e^(i*t)");
const pathSemantics = analyzeIsolationSemantics(pathIsolation);
const realPath = pathSemantics.mappingCandidates.find((candidate) => candidate.lens === "default-real");
if (!realPath) throw new Error("Real-parameter complex path signature is missing");
const mappingPathHtml = renderToStaticMarkup(
  React.createElement(ComplexMappingPane, {
    isolation: pathIsolation,
    signature: realPath,
    input: "t",
    fixed: {},
    realProbe: 1,
    onRealProbe: () => undefined,
    complexProbe: { re: 1, im: 1 },
    onComplexProbe: () => undefined,
    display: "exponential",
    onDisplay: () => undefined,
  }),
);
check("V13 R-to-C renders a parameter path slider", mappingPathHtml.includes('type="range"'));
check("V14 complex representation controls expose Cartesian, polar, and exponential forms", (
  mappingPathHtml.includes("a + bi") &&
  mappingPathHtml.includes("polar") &&
  mappingPathHtml.includes("re^(iθ)")
));
check(
  "V14a complex representation controls keep a 44px mobile touch target",
  /class="[^"]*min-h-11[^"]*"[^>]*>a \+ bi<\/button>/.test(mappingPathHtml),
);

const practicalInputViewport = complexViewportHalfSpan([{ re: 1, im: 1 }], 6);
const expandedViewport = complexViewportHalfSpan([{ re: 3, im: 10 }], 6);
check(
  "V15 direct manipulation starts with a practical stable window and expands for a large initial point",
  practicalInputViewport === 6 && expandedViewport >= 10,
);

const fixedViewportHtml = [
  renderToStaticMarkup(
    React.createElement(ComplexPlane, {
      value: { re: 1, im: 1 },
      onValueChange: () => undefined,
      viewportHalfSpan: 12,
    }),
  ),
  renderToStaticMarkup(
    React.createElement(ComplexPlane, {
      value: { re: 100, im: 100 },
      viewportHalfSpan: 12,
    }),
  ),
];
const explicitScales = fixedViewportHtml.map(
  (html) => html.match(/data-units-per-pixel="([^"]+)"/)?.[1],
);
check(
  "V16 an explicit viewport gives controlled and read-only planes the same numeric scale",
  explicitScales[0] !== undefined && explicitScales[0] === explicitScales[1],
);

const amplifiedIsolation = isolationFrom("w(z) = 100*z");
const amplifiedSemantics = analyzeIsolationSemantics(amplifiedIsolation);
const amplifiedComplex = amplifiedSemantics.mappingCandidates.find(
  (candidate) => candidate.lens === "complex-alternative",
);
if (!amplifiedComplex) throw new Error("Amplified complex mapping signature is missing");
const amplifiedHtml = renderToStaticMarkup(
  React.createElement(ComplexMappingPane, {
    isolation: amplifiedIsolation,
    signature: amplifiedComplex,
    input: "z",
    fixed: {},
    realProbe: 1,
    onRealProbe: () => undefined,
    complexProbe: { re: 1, im: 1 },
    onComplexProbe: () => undefined,
    display: "cartesian",
    onDisplay: () => undefined,
  }),
);
const linkedViewports = [...amplifiedHtml.matchAll(/data-viewport-half-span="([^"]+)"/g)].map(
  (match) => Number(match[1]),
);
const linkedScales = [...amplifiedHtml.matchAll(/data-units-per-pixel="([^"]+)"/g)].map(
  (match) => Number(match[1]),
);
check(
  "V17 linked complex planes expose one stable shared viewport",
  linkedViewports.length === 2 &&
    linkedViewports[0] === linkedViewports[1] &&
    linkedScales.length === 2 &&
    linkedScales[0] === linkedScales[1],
);
check(
  "V18 linked scale preserves the visible magnitude difference for z to 100z",
  linkedViewports[0] >= 100 && amplifiedHtml.includes("both planes use the same scale"),
);
check(
  "V19 mobile linked views use a compact input/output switch with full-size touch targets",
  amplifiedHtml.includes('aria-label="Choose complex plane"') &&
    amplifiedHtml.includes("lg:hidden") &&
    amplifiedHtml.includes("min-h-11") &&
    amplifiedHtml.includes("hidden lg:block"),
);

const absIsolation = isolationFrom("r(t) = abs(i*t)");
const rotatingIsolation = isolationFrom("r(t) = re(e^(i*t))");
const absAtTwo = evaluateRealMappingValue(absIsolation.expression, { t: 2 });
const rotatingAtOne = evaluateRealMappingValue(rotatingIsolation.expression, { t: 1 });
check(
  "V20 real graph samples may pass through complex intermediate values",
  Math.abs(absAtTwo - 2) < 1e-12 &&
    Math.abs(rotatingAtOne - Math.cos(1)) < 1e-12,
);
check(
  "V21 the final scalar carrier, not complex intermediate arithmetic, selects the Argand value pane",
  !scalarHasComplexCarrier({ kind: "real", value: 1 }) &&
    scalarHasComplexCarrier({ kind: "complex", re: 0, im: 1 }),
);

const rootSquareIsolation = isolationFrom("f(x) = (sqrt(x))^2");
check(
  "V22 a default-real graph does not recover a value through complex fallback outside its domain",
  Number.isNaN(evaluateRealMappingValue(rootSquareIsolation.expression, { x: -1 })),
);
check(
  "V23 an explicit complex lens evaluates the same formula on its principal continuation",
  evaluateRealMappingValue(
    rootSquareIsolation.expression,
    { x: -1 },
    { scalarRealm: "complex", mappingSignatureId: "test-complex-root-square" },
  ) === -1,
);

const inverseTrigIsolation = isolationFrom("f(z) = atan(z)");
const inverseTrigComplex = analyzeIsolationSemantics(inverseTrigIsolation)
  .mappingCandidates.find((candidate) => candidate.lens === "complex-alternative");
if (!inverseTrigComplex) throw new Error("Complex inverse-trig mapping signature is missing");
const inverseTrigLensHtml = renderToStaticMarkup(
  React.createElement(MappingLensControl, {
    candidates: analyzeIsolationSemantics(inverseTrigIsolation).mappingCandidates,
    value: inverseTrigComplex,
    onChange: () => undefined,
  }),
);
check(
  "V24 inverse trig names its own branch cuts without a misleading Arg interval",
  inverseTrigLensHtml.includes("principal inverse trig · standard branch cuts") &&
    !inverseTrigLensHtml.includes("Arg ∈"),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
