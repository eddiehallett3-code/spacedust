/**
 * The copy a shared link shows, which is a different job from the document
 * title.
 *
 * The document title has to be findable — brand plus keywords, because that is
 * what a search result and a browser tab show. A card in a timeline has no such
 * job: it is competing with everything else in the feed, so it leads with the
 * benefit instead of the category. "Batch tools for a Solana wallet" describes
 * the product; "Clean up your Solana wallet" describes the reason to click.
 *
 * Where this lives matters. It used to be set in the root layout's `openGraph`,
 * which the metadata merge made absolute: every page inherited the landing
 * page's headline, so a shared link to The Void rendered The Void's own card
 * image under the words "Clean up your Solana wallet". The layout now leaves
 * `openGraph.title` unset so each page's own title flows into its card, and only
 * the front door — the one page this copy was written for — opts back in with
 * these.
 *
 * Kept in one place so the card and the landing page cannot drift apart: a
 * promise on the card that the landing page does not repeat is the cheapest way
 * to lose the click that was already made.
 */
export const CARD_TITLE = "Clean up your Solana wallet — swap the dust, reclaim the rent";

/** Shorter than the page description on purpose: a card shows about two lines. */
export const CARD_DESCRIPTION =
  "Six non-custodial tools: batch-swap dust, send or burn what has no market, reclaim the rent in empty accounts, revoke stale approvals, scan any wallet read-only.";
