/**
 * Shareable derivations: the WHOLE step history — every state, label, and
 * assumption pill — packed into a ?eq= query param (kept before the hash so
 * the hash router never sees it). The recipient gets the full trail: rewind
 * it, replay it, or keep working from the latest step.
 */
import type { EquationState } from "./model";
import type { TreeEq } from "./tree";

export interface SharedStep {
  label: string;
  note?: string;
  dangerous?: boolean;
  pill?: string;
  state: EquationState;
  tree?: TreeEq;
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
      if (!s.state || !Array.isArray(s.state.left) || !Array.isArray(s.state.right)) return null;
      if (s.tree && (!s.tree.left || !s.tree.right)) return null;
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
