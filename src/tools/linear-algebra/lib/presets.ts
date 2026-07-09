import type { Matrix, MatrixDimension } from "./stores/useMatrixStore";

export interface MatrixPreset {
  id: string;
  name: string;
  values: number[][];
  expressions: string[][];
}

const R2 = Math.SQRT2 / 2; // cos(45°) = sin(45°)

const PRESETS_3X3: MatrixPreset[] = [
  {
    id: "identity",
    name: "Identity (do nothing)",
    values: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    expressions: [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]],
  },
  {
    id: "scale-2",
    name: "Uniform scale ×2",
    values: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
    expressions: [["2", "0", "0"], ["0", "2", "0"], ["0", "0", "2"]],
  },
  {
    id: "rotate-z-90",
    name: "Rotate 90° about Z",
    values: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    expressions: [["0", "-1", "0"], ["1", "0", "0"], ["0", "0", "1"]],
  },
  {
    id: "rotate-z-45",
    name: "Rotate 45° about Z",
    values: [[R2, -R2, 0], [R2, R2, 0], [0, 0, 1]],
    expressions: [
      ["sqrt(2)/2", "-sqrt(2)/2", "0"],
      ["sqrt(2)/2", "sqrt(2)/2", "0"],
      ["0", "0", "1"],
    ],
  },
  {
    id: "shear-xy",
    name: "Shear (x picks up y)",
    values: [[1, 1, 0], [0, 1, 0], [0, 0, 1]],
    expressions: [["1", "1", "0"], ["0", "1", "0"], ["0", "0", "1"]],
  },
  {
    id: "reflect-xy",
    name: "Reflect across XY-plane (det < 0)",
    values: [[1, 0, 0], [0, 1, 0], [0, 0, -1]],
    expressions: [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "-1"]],
  },
  {
    id: "project-xy",
    name: "Project onto XY-plane (rank 2)",
    values: [[1, 0, 0], [0, 1, 0], [0, 0, 0]],
    expressions: [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "0"]],
  },
  {
    id: "project-x",
    name: "Project onto X-axis (rank 1)",
    values: [[1, 0, 0], [0, 0, 0], [0, 0, 0]],
    expressions: [["1", "0", "0"], ["0", "0", "0"], ["0", "0", "0"]],
  },
  {
    id: "stretch-squash",
    name: "Stretch X ×2, squash Z ×0.5",
    values: [[2, 0, 0], [0, 1, 0], [0, 0, 0.5]],
    expressions: [["2", "0", "0"], ["0", "1", "0"], ["0", "0", "1/2"]],
  },
];

const PRESETS_2X2: MatrixPreset[] = [
  {
    id: "identity",
    name: "Identity (do nothing)",
    values: [[1, 0], [0, 1]],
    expressions: [["1", "0"], ["0", "1"]],
  },
  {
    id: "scale-2",
    name: "Uniform scale ×2",
    values: [[2, 0], [0, 2]],
    expressions: [["2", "0"], ["0", "2"]],
  },
  {
    id: "rotate-90",
    name: "Rotate 90°",
    values: [[0, -1], [1, 0]],
    expressions: [["0", "-1"], ["1", "0"]],
  },
  {
    id: "rotate-45",
    name: "Rotate 45°",
    values: [[R2, -R2], [R2, R2]],
    expressions: [["sqrt(2)/2", "-sqrt(2)/2"], ["sqrt(2)/2", "sqrt(2)/2"]],
  },
  {
    id: "shear",
    name: "Shear (x picks up y)",
    values: [[1, 1], [0, 1]],
    expressions: [["1", "1"], ["0", "1"]],
  },
  {
    id: "reflect-x",
    name: "Reflect across X-axis (det < 0)",
    values: [[1, 0], [0, -1]],
    expressions: [["1", "0"], ["0", "-1"]],
  },
  {
    id: "project-x",
    name: "Project onto X-axis (rank 1)",
    values: [[1, 0], [0, 0]],
    expressions: [["1", "0"], ["0", "0"]],
  },
];

/** Presets are only defined for square dimensions */
export function getPresets(dimension: MatrixDimension): MatrixPreset[] {
  if (dimension === "3x3") return PRESETS_3X3;
  if (dimension === "2x2") return PRESETS_2X2;
  return [];
}

export function presetToMatrix(preset: MatrixPreset, dimension: MatrixDimension): Matrix {
  return {
    values: preset.values.map((row) => [...row]),
    expressions: preset.expressions.map((row) => [...row]),
    dimension,
  };
}
