"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { STORAGE_KEYS } from "@/lib/utils/constants";

/**
 * Everything this app keeps in the browser, read from the one object that lists it.
 *
 * Reading `STORAGE_KEYS` rather than naming the keys a second time is the entire
 * point. The paragraph above this control enumerates them to the reader, so a key
 * added later that this button did not delete would make that sentence false — and
 * false silently, which is the worst way for a promise on a security page to fail.
 * It is also why the sweep tallies now live in `STORAGE_KEYS`: they were built as
 * strings inside `lib/utils/tally.ts`, so a clear that missed them would have left
 * the counters on screen after the history they count was gone.
 */
const KEYS = Object.values(STORAGE_KEYS);

/**
 * "Clear stored data".
 *
 * The security page has always said that clearing site data removes everything
 * this app keeps. Until this existed the only way to act on that was the browser's
 * own site settings — the page was describing a door it did not have. A claim a
 * reader can test in one click is worth more than the same claim asserted twice,
 * and on this page in particular the claim is the argument.
 *
 * Two steps, because it is destructive: the sweep history is the only part that
 * cannot be rebuilt, and a button that deletes a record on one click is a button
 * people press by accident. The confirmation states what goes, what does not
 * (nothing on chain), and that the page reloads — and the reload is not decoration:
 * those keys are read all over the app, so every reader would otherwise have to be
 * told to read again, and one that was missed would show the deleted data.
 */
export function ClearStoredData() {
  const [confirming, setConfirming] = useState(false);

  function clear() {
    for (const key of KEYS) window.localStorage.removeItem(key);
    window.location.reload();
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Clear stored data
      </Button>
    );
  }

  return (
    // `role="alert"` because this appears in response to a press: without it the
    // consequence text is silent to a screen reader that is still on the button.
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/6 p-3">
      <p className="text-xs leading-relaxed text-muted">
        This deletes your threshold, output asset, filter settings, sweep history,
        hidden assets, the local tally, pending lookup-table cleanup addresses and
        the storage-notice choice from this browser, then reloads the page.
        Nothing on chain changes and no funds are affected.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button variant="danger" size="sm" onClick={clear}>
          Delete and reload
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
