/**
 * Scene colors, chosen to read on both the light and dark page background
 * (the canvas is transparent — the page shows through).
 * Axis convention x/y/z ↔ î/ĵ/k̂ uses the familiar r/g/b family, softened.
 */
export const COLOR = {
  iHat: "#e11d48", // rose-600
  jHat: "#059669", // emerald-600
  kHat: "#0284c7", // sky-600
  vector: "#f59e0b", // amber-500 — the site's accent, for the user's vector
  grid: "#8b8b94",
  axis: "#8b8b94",
} as const;
