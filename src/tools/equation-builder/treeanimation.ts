import type { MoveStory } from "./share";
import type { DragPayload, DropTarget } from "./operations";
import { addendsOf, keyOf, type TreeEq } from "./tree";
import { ownerOfTreeHandleId, resolveTreeFactorGroup } from "./treeunits";

export type TreeAnimationStage = {
  kind: "move" | "simplify";
  tree: TreeEq;
  story?: MoveStory;
};

export interface TreeAnimationGlyph {
  term: string | null;
  text: string;
  role: string | null;
  side: "left" | "right" | null;
}

/**
 * Find the new handle that represents a tree actor after its owner/zone id
 * legitimately changes. Matching is constrained to the recorded target side
 * and the complete glyph sequence, never a loose single-letter match.
 */
export function treeActorDestinationTerm(
  actors: TreeAnimationGlyph[],
  next: TreeAnimationGlyph[],
  story?: MoveStory
): string | null {
  if (!story?.to || actors.length === 0) return null;
  const readable = (glyphs: TreeAnimationGlyph[]) =>
    glyphs.map((glyph) => glyph.text).join("").replace(/[·()]/g, "");
  const actorText = readable(actors);
  const targetTerms = new Map<string, TreeAnimationGlyph[]>();
  next.forEach((glyph) => {
    if (glyph.side !== story.to || !glyph.term) return;
    if (!targetTerms.has(glyph.term)) targetTerms.set(glyph.term, []);
    targetTerms.get(glyph.term)!.push(glyph);
  });
  const match = Array.from(targetTerms.entries()).find(
    ([, glyphs]) =>
      readable(glyphs) === actorText &&
      (story.kind !== "divide" || glyphs.some((glyph) => glyph.role === "den"))
  );
  return match?.[0] ?? null;
}

/** Record a drag's semantic cast before the operation changes its handles. */
export function treeMoveStory(te: TreeEq, payload: DragPayload, target: DropTarget): MoveStory {
  const ids = "ids" in payload ? payload.ids : "termId" in payload && payload.termId ? [payload.termId] : [];
  const movable = ["terms", "factorGroup", "coef", "numer", "den"].includes(payload.kind);
  const role =
    payload.kind === "coef"
      ? "coef"
      : payload.kind === "numer"
        ? "numer"
        : payload.kind === "den"
          ? "den"
          : undefined;
  const to =
    target.kind === "side" || target.kind === "under" || target.kind === "unit"
      ? target.side
      : undefined;
  const group = payload.kind === "factorGroup" ? resolveTreeFactorGroup(te, payload.ids) : null;
  const divide =
    target.kind === "under" ||
    payload.kind === "coef" ||
    payload.kind === "numer" ||
    (payload.kind === "factorGroup" && group?.zone === "n");
  const explicitSink =
    target.kind === "under" || target.kind === "onterm" || target.kind === "unit"
      ? ownerOfTreeHandleId(target.kind === "unit" ? target.unitId : target.termId)
      : null;
  const sink = explicitSink ?? (to ? addendsOf(te[to])[0]?.id : undefined);
  return {
    actors: movable ? ids.filter(Boolean).map((term) => ({ term, role })) : [],
    site: [],
    born: [],
    emphasize: ids.filter(Boolean),
    kind: divide ? "divide" : "cross",
    to,
    sink,
  };
}

const sameTree = (a: TreeEq, b: TreeEq): boolean =>
  keyOf(a.left) === keyOf(b.left) && keyOf(a.right) === keyOf(b.right);

/**
 * Turn one algebra history step into the visual states a student would write:
 * first perform the operation literally, then simplify the result. The second
 * stage is omitted when the operation is already canonical.
 */
export function treeAnimationStages(
  finalTree: TreeEq,
  intermediateTree?: TreeEq,
  story?: MoveStory
): TreeAnimationStage[] {
  if (!intermediateTree || sameTree(intermediateTree, finalTree)) {
    return [{ kind: "move", tree: finalTree, story }];
  }
  return [
    { kind: "move", tree: intermediateTree, story },
    {
      kind: "simplify",
      tree: finalTree,
      story: { actors: [], site: [], born: [], kind: "simplify" },
    },
  ];
}
