/**
 * Standing domain facts — the Phase C "deepen assumptions" layer of
 * docs/design/architecture-review.md.
 *
 * A move's pill ("x ≠ 0", "u, v > 0") records the assumption at the moment it
 * was made. This module reads those standing assumptions — plus any facts the
 * human declares on a symbol in the symbol book — back into the form the
 * simplifier's whitelist queries: `keyOf` keys of expressions licensed as
 * nonzero. The parse is deliberately conservative (Richardson again): a pill
 * either matches the small machine-generated grammar and becomes a fact, or
 * it licenses nothing.
 */
import { keyOf, simplify, tv, varsIn, type TNode } from "./tree";
import { parseEquation } from "./parser";

export interface DomainFacts {
  /** keyOf-keys of expressions known to be ≠ 0 */
  nonzero: Set<string>;
  /** keyOf-keys of expressions known to be > 0 (each also implies ≠ 0) */
  positive: Set<string>;
}

export const emptyFacts = (): DomainFacts => ({ nonzero: new Set(), positive: new Set() });

/** A symbol name as pills print it: x, y2, z_x, y′, f″ … */
const NAME = "[A-Za-z](?:[A-Za-z0-9_]|[′″])*";
const NAME_RE = new RegExp(`^${NAME}$`);
const NAME_LIST_RE = new RegExp(`^${NAME}(?:, ${NAME})*$`);
/** English words some pills use where a name would otherwise match. */
const NOT_SYMBOLS = new Set(["sides", "branch", "value"]);

/** printNode output → something mathjs can read; null when it clearly can't. */
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const normalizeMathText = (text: string): string | null => {
  let out = "";
  for (const ch of text) {
    const sup = SUP.indexOf(ch);
    if (sup >= 0) out += `^${sup}`;
    else if (ch === "⁻") out += "^-";
    else if (ch === "−") out += "-";
    else if (ch === "·") out += "*";
    else if (ch === "π") out += "pi";
    else out += ch;
  }
  // anything else non-ASCII (√, ±, frozen glyphs) is not worth guessing at
  return /^[\x20-\x7E]*$/.test(out) ? out : null;
};

/** Parse one pill expression back to a canonical tree node, or refuse. */
const parseExpressionText = (text: string): TNode | null => {
  const normalized = normalizeMathText(text.trim());
  if (!normalized) return null;
  const parsed = parseEquation(`${normalized} = 0`);
  if (!parsed.ok) return null;
  const node = simplify(parsed.tree.left);
  // Prose pills ("sides", "logarithm argument") parse as symbols too — but
  // this playground's symbols are short (x, y′, z_x). Long names mean prose.
  for (const name of Array.from(varsIn(node))) {
    if (name.length > 3 || NOT_SYMBOLS.has(name)) return null;
  }
  return node;
};

/**
 * Collect domain facts from standing assumption texts (history pills and
 * symbol-book predicates). Composite pills are split on the " · " joiner
 * moves use; atoms outside the grammar ("principal value", "check roots",
 * "sides > 0") contribute nothing.
 */
export function factsFromAssumptions(texts: string[]): DomainFacts {
  const facts = emptyFacts();
  for (const text of texts) {
    for (const atom of text.split(" · ").map((s) => s.trim())) {
      const positive = atom.match(/^(.+) > 0$/);
      if (positive) {
        const lhs = positive[1].trim();
        if (NAME_LIST_RE.test(lhs) && !lhs.split(", ").some((name) => NOT_SYMBOLS.has(name))) {
          for (const name of lhs.split(", ")) facts.positive.add(keyOf(tv(name)));
        } else {
          const node = parseExpressionText(lhs);
          if (node && varsIn(node).size > 0) facts.positive.add(keyOf(node));
        }
        continue;
      }
      const nonzero = atom.match(/^(.+) ≠ 0$/);
      if (nonzero) {
        const lhs = nonzero[1].trim();
        if (NAME_RE.test(lhs) && !NOT_SYMBOLS.has(lhs)) {
          facts.nonzero.add(keyOf(tv(lhs)));
        } else {
          const node = parseExpressionText(lhs);
          // constants are nonzero on their own; only symbolic facts matter
          if (node && varsIn(node).size > 0) facts.nonzero.add(keyOf(node));
        }
      }
    }
  }
  return facts;
}

/** The simplifier license: every expression known nonzero (positive ⇒ nonzero). */
export const assumeKeysOf = (facts: DomainFacts): Set<string> =>
  new Set([...Array.from(facts.nonzero), ...Array.from(facts.positive)]);
