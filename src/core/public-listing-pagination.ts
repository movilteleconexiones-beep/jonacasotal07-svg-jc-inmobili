/**
 * Deduplicate public catalog pages by immutable property ID.
 *
 * Live inventory can change between offset-based requests: the last item on
 * page N may reappear on page N+1. Never render two cards for the same ID.
 * Preserve the first occurrence and the server-provided order.
 */
export function mergeDistinctListings<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(existing.map(item => item.id));
  const added: T[] = [];
  for (const listing of incoming) {
    if (seen.has(listing.id)) continue;
    seen.add(listing.id);
    added.push(listing);
  }
  return [...existing, ...added];
}
