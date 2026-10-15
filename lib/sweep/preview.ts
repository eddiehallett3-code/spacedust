/**
 * Should a pending preview be kept, remembered, or thrown away?
 *
 * A preview describes one specific selection: the transactions inside it were
 * built for *those* assets, and `execute()` signs those transactions — not
 * whatever happens to be ticked when the user finally clicks. So the moment the
 * selection moves, the preview stops describing the button above it.
 *
 * That is not cosmetic. Unticking an asset after previewing would still sign the
 * batch that burns it, so a user could destroy something they had just
 * deliberately deselected. The Void has handled this from the start; the NFT
 * burn panel did not, which is the kind of gap that only appears once a human
 * starts clicking.
 *
 * Rules:
 *
 *  - the selection did not move → nothing to do;
 *  - a flow is mid-flight, or a finished run's summary is on screen → leave it
 *    alone. The summary in particular must survive: the preview is gone by then,
 *    and the result belongs to the user until they dismiss it;
 *  - the selection moved with a preview open → discard it;
 *  - the selection moved with no preview → just record the new key.
 */
export type PreviewAction = "none" | "remember" | "discard";

export function previewAction(params: {
  /** The selection the existing preview was built from. */
  previousKey: string;
  /** The selection now. */
  currentKey: string;
  isBusy: boolean;
  hasSummary: boolean;
  hasPreview: boolean;
}): PreviewAction {
  const { previousKey, currentKey, isBusy, hasSummary, hasPreview } = params;

  if (previousKey === currentKey) return "none";
  if (isBusy || hasSummary) return "none";
  return hasPreview ? "discard" : "remember";
}
