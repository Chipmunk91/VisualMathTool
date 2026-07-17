/**
 * Shareable derivations: the WHOLE step history — every state, label, and
 * assumption pill — packed into a ?eq= query param (kept before the hash so
 * the hash router never sees it). The recipient gets the full trail: rewind
 * it, replay it, or keep working from the latest step.
 */
import type { EquationState } from "./model";
import type { TreeEq } from "./tree";

/**
 * A move's TRANSITION SCRIPT, recorded by the move function itself at the
 * moment it runs — it knows exactly what interacted with what, so the replay
 * animator executes a named primitive with a named cast instead of inferring
 * the choreography from before/after diffs.
 */
export interface MoveStory {
  /** old-state terms (optionally one glyph role) that travel and get consumed */
  actors: { term: string; role?: string }[];
  /** old-state terms consumed at the destination */
  site: string[];
  /** new-state terms created by the interaction */
  born: string[];
  /** which primitive plays: a term crossing =, or a divisor forming a fraction */
  kind?: "cross" | "divide" | "simplify";
  /** Destination side for a semantic tree actor whose handle changes shape. */
  to?: "left" | "right";
  /** the term the actors merge into / dive under — its id SURVIVES the step */
  sink?: string;
  /**
   * Tree steps have no single traveling actor (the whole side restructures),
   * so instead of a travel they name the unit(s) the user acted on. The engine
   * gives these a brief fixation pulse before the reflow — the anticipation
   * cue flat moves get, without a (mis)classified travel.
   */
  emphasize?: string[];
}

export interface SharedStep {
  label: string;
  note?: string;
  dangerous?: boolean;
  pill?: string;
  /** Legacy flat snapshots remain readable; new shares store only `tree`. */
  state?: EquationState;
  tree?: TreeEq;
  /** Optional unreduced paper state rendered between the move and result. */
  intermediateTree?: TreeEq;
  story?: MoveStory;
}

export interface SharedHistory {
  steps: SharedStep[];
}

export function encodeHistory(history: SharedHistory): string {
  const json = JSON.stringify(history);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeHistory(param: string): SharedHistory | null {
  try {
    const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const h = JSON.parse(json) as SharedHistory;
    if (!Array.isArray(h.steps) || h.steps.length === 0) return null;
    for (const s of h.steps) {
      if (typeof s.label !== "string") return null;
      const flatOk = !!s.state && Array.isArray(s.state.left) && Array.isArray(s.state.right);
      if (!s.tree && !flatOk) return null;
      if (s.tree && (!s.tree.left || !s.tree.right)) return null;
      if (s.intermediateTree && (!s.intermediateTree.left || !s.intermediateTree.right)) return null;
    }
    return h;
  } catch {
    return null;
  }
}

export function shareUrl(history: SharedHistory): string {
  const { origin, pathname, hash } = window.location;
  const route = hash.split("?")[0] || "#/tools/equation-builder";
  return `${origin}${pathname}?eq=${encodeHistory(history)}${route}`;
}

export function sharedFromUrl(): SharedHistory | null {
  const param = new URLSearchParams(window.location.search).get("eq");
  return param ? decodeHistory(param) : null;
}
