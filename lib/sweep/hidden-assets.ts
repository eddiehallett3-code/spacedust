/**
 * Assets this browser should stop showing.
 *
 * Two things feed this list, and they are different in kind:
 *
 *  - **A burn the app watched.** A fact. Recorded the moment it lands, because
 *    the scan is fed by an index and an index lags: a destroyed asset can come
 *    back on the very next rescan. The index's own `burnt` flag catches up
 *    eventually and does this properly on every device — but not instantly, and
 *    for a cNFT that flag is the *only* thing that will ever say so, because
 *    burning a leaf leaves no account behind.
 *  - **A hide the user asked for.** A preference, not a fact. The user may be
 *    looking at something that really is gone and simply wants it off the
 *    screen. Because it is only a preference it can be undone, which is why the
 *    ids are removable rather than only ever added to.
 */

/**
 * Fold ids into the list.
 *
 * A set union in insertion order: hiding the same asset twice (two tabs, or a
 * rescan that still shows it) must not write a duplicate, and ids already in the
 * list must survive untouched.
 */
export function mergeIds(
  remembered: readonly string[],
  added: readonly string[],
): string[] {
  return [...new Set([...remembered, ...added])];
}

/** Drop one id — the undo for a hide. An id that is not there changes nothing. */
export function removeId(remembered: readonly string[], id: string): string[] {
  return remembered.filter((rememberedId) => rememberedId !== id);
}

/**
 * Drop everything hidden.
 *
 * Generic over any `{ id }`, so NFTs, cNFTs and Core assets are all covered by
 * the same rule without the caller needing to know which is which.
 */
export function hideAssets<T extends { id: string }>(
  assets: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  return assets.filter((asset) => !hidden.has(asset.id));
}
