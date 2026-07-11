/**
 * The function catalog — the simple table behind word search: famous
 * functions and equations by name, mapped to typed-equation text that the
 * parser already understands (flat or tree, it doesn't matter here).
 */
export interface CatalogEntry {
  name: string;
  /** what gets fed to parseEquation when chosen */
  text: string;
  /** extra words that should find this entry */
  aliases: string[];
}

export const CATALOG: CatalogEntry[] = [
  { name: "parabola", text: "y = x^2", aliases: ["quadratic function", "square"] },
  { name: "cubic", text: "y = x^3", aliases: ["third power"] },
  { name: "square root", text: "y = sqrt(x)", aliases: ["root", "radical"] },
  { name: "hyperbola", text: "y = 1/x", aliases: ["reciprocal", "inverse proportion"] },
  { name: "sine wave", text: "y = sin(x)", aliases: ["sin", "sinusoid", "wave"] },
  { name: "cosine wave", text: "y = cos(x)", aliases: ["cos"] },
  { name: "tangent", text: "y = tan(x)", aliases: ["tan"] },
  { name: "exponential growth", text: "y = e^x", aliases: ["exp", "e^x", "growth"] },
  { name: "exponential decay", text: "y = e^(-x)", aliases: ["decay", "half-life"] },
  { name: "natural log", text: "y = ln(x)", aliases: ["logarithm", "ln"] },
  { name: "doubling", text: "y = 2^x", aliases: ["powers of two", "2^x", "binary growth"] },
  { name: "bell curve", text: "y = e^(-x^2)", aliases: ["gaussian", "normal distribution"] },
  { name: "logistic curve", text: "y = 1/(1 + e^(-x))", aliases: ["sigmoid", "s-curve", "s curve"] },
  { name: "golden ratio equation", text: "x^2 = x + 1", aliases: ["golden", "fibonacci", "phi"] },
  { name: "unit circle", text: "x^2 + y^2 = 1", aliases: ["circle", "pythagorean"] },
  { name: "quadratic equation", text: "x^2 = 3*x + 10", aliases: ["second degree", "roots"] },
  // the practice equations that used to live in the presets menu
  { name: "linear equation", text: "2*x - 3 = -7", aliases: ["first degree", "solve for x", "2x-3"] },
  { name: "both sides linear", text: "5*x + 4 = 3*x", aliases: ["x on both sides"] },
  { name: "reciprocal equation", text: "6/x = 2", aliases: ["x in denominator", "6/x"] },
  { name: "distribution", text: "2*(x + 3) = 8", aliases: ["parentheses", "expand", "factor out"] },
  { name: "square equation", text: "x^2 = 9", aliases: ["x squared", "both roots"] },
  { name: "sine equation", text: "2*sin(x) = 1", aliases: ["trig equation", "solve sin"] },
  { name: "log equation", text: "ln(x) = 2", aliases: ["solve ln", "natural log equation"] },
  { name: "exponential equation", text: "e^x + 1 = 4", aliases: ["solve exp", "e^x equation"] },
  { name: "isolate y", text: "2*y - 3 = x", aliases: ["solve for y", "two variables"] },
];

/** Word search over names and aliases: prefix matches first, then substrings */
export function searchCatalog(query: string, limit = 8): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (entry: CatalogEntry): number => {
    const names = [entry.name, ...entry.aliases].map((s) => s.toLowerCase());
    if (names.some((s) => s.startsWith(q))) return 0;
    if (names.some((s) => s.split(/\s+/).some((w) => w.startsWith(q)))) return 1;
    if (names.some((s) => s.includes(q))) return 2;
    return -1;
  };
  return CATALOG.map((e) => ({ e, s: score(e) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map(({ e }) => e);
}
