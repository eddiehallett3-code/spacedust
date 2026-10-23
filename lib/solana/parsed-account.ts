/**
 * Reading a parsed token account.
 *
 * Two planners need the same one field from a token account — its withheld
 * transfer-fee balance — and every other field they read is already in the same
 * `jsonParsed` reply. Kept here so the sweep's composer and Payload's planner
 * cannot disagree about what "no withheld fees" means.
 */

/**
 * The withheld transfer-fee balance on a parsed token account.
 *
 * `0` when the account has no `transferFeeAmount` extension at all (every legacy
 * account, and most Token-2022 ones). `null` when the account could not be read
 * as a token account, which a caller must treat as "cannot prove it is safe to
 * close" rather than as zero.
 *
 * A malformed value reads as `1`, not `0`: an unparseable withheld balance is not
 * evidence of no withheld balance, and the token program refuses a close while
 * the real figure is non-zero (`Custom: 35`).
 */
export function withheldFeesOf(data: unknown): number | null {
  if (!data || typeof data !== "object" || !("parsed" in data)) return null;
  const info = (
    data as {
      parsed?: {
        info?: {
          extensions?: Array<{
            extension?: string;
            state?: { withheldAmount?: unknown };
          }>;
        };
      };
    }
  ).parsed?.info;
  if (!info) return null;

  const entry = (info.extensions ?? []).find(
    (extension) => extension?.extension === "transferFeeAmount",
  );
  if (!entry) return 0;

  const value = Number(entry.state?.withheldAmount ?? Number.NaN);
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.trunc(value);
}
