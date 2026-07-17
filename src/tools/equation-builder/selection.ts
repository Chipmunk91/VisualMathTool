/** Pure selection rules shared by touch, mouse and architecture tests. */
import type { Side } from "./model";
import type { TreeEq } from "./tree";
import { resolveTreeFactor, resolveTreeFactorGroup } from "./treeunits";

export interface SymbolSelection {
  side: Side;
  termIds: string[];
}

/**
 * Select or toggle one displayed factor. A selection is always a coherent
 * chunk from one product row and one side of its fraction bar. Tapping a
 * different row starts a new chunk instead of creating an invalid subset.
 */
export function toggleTreeFactorSelection(
  te: TreeEq,
  current: SymbolSelection | null,
  side: Side,
  factorId: string,
  additive: boolean
): SymbolSelection | null {
  const factor = resolveTreeFactor(te, factorId);
  if (!factor || factor.side !== side) return current;
  if (!additive || !current || current.side !== side) return { side, termIds: [factorId] };

  const nextIds = current.termIds.includes(factorId)
    ? current.termIds.filter((id) => id !== factorId)
    : [...current.termIds, factorId];
  if (nextIds.length === 0) return null;
  const group = resolveTreeFactorGroup(te, nextIds);
  return group ? { side, termIds: group.ids } : { side, termIds: [factorId] };
}
