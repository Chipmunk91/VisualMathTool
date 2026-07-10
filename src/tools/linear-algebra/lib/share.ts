/**
 * Shareable state: the whole configuration packed into a ?s= query param
 * (kept before the hash so the hash router never sees it).
 */
import type { SharedState } from "../store";

export function encodeShared(state: SharedState): string {
  const json = JSON.stringify(state);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeShared(param: string): SharedState | null {
  try {
    const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const s = JSON.parse(json) as SharedState;
    if (!Array.isArray(s.matrix) || s.matrix.length !== 9) return null;
    if (s.rows !== 2 && s.rows !== 3) return null;
    if (s.cols !== 2 && s.cols !== 3) return null;
    if (!Array.isArray(s.vectors) || s.vectors.length < 1) return null;
    return s;
  } catch {
    return null;
  }
}

export function shareUrl(state: SharedState): string {
  const { origin, pathname, hash } = window.location;
  const route = hash.split("?")[0] || "#/tools/linear-algebra";
  return `${origin}${pathname}?s=${encodeShared(state)}${route}`;
}

export function sharedFromUrl(): SharedState | null {
  const param = new URLSearchParams(window.location.search).get("s");
  return param ? decodeShared(param) : null;
}
