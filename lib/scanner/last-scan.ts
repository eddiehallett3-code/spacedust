import type { WalletScan } from "@/types/token";
import { STORAGE_KEYS } from "@/lib/utils/constants";

/**
 * The last scan, kept so a return visit does not pay for it twice.
 *
 * A scan is the most expensive thing this app does — measured at 49 seconds for a
 * wallet with 3,033 holdings — and a shared link gets opened more than once. The
 * in-memory cache in `apiFetch` dies with the page, so it helps a re-render and not
 * a reload. This is the part that survives: one record, keyed to one wallet,
 * overwritten every time a scan completes.
 *
 * **One key, not one per wallet.** Keeping a record per address would grow without
 * bound on a machine we do not control, storing data about wallets the visitor may
 * not own. The most recent scan is also the only one anything here asks for.
 *
 * **Two sizes of truth.** A wallet with thousands of tokens serialises to
 * megabytes, and localStorage refuses at around five — so the full result is
 * stored only when it fits (`fitsInStorage`), while the summary — a handful of
 * counts — always is. A cached result that cannot be stored is not a failure: the
 * summary is what "what changed since you last looked" needs, and it is tiny.
 */

const STORAGE_KEY = STORAGE_KEYS.lastScan;

/**
 * Roughly where a full result stops being safe to persist.
 *
 * The limit is per origin and shared with the sweep history and the user's own
 * preferences, so a scan is not entitled to most of it. Anything larger keeps its
 * summary and is re-fetched instead.
 */
export const MAX_CACHED_SCAN_CHARS = 200_000;

/** The counts worth diffing, all cheap. */
export interface ScanSummary {
  owner: string;
  /** When the scan behind this summary finished, in epoch milliseconds. */
  at: number;
  tokens: number;
  nfts: number;
  /** `null` when the scan did not read approvals (the sweeper's scan does not). */
  approvals: number | null;
  emptyAccounts: number;
}

export interface StoredScan {
  summary: ScanSummary;
  /** The full result, when it was small enough to keep. */
  scan: WalletScan | null;
}

/** The fields a summary needs, read defensively — a scan is network data. */
type Countable = {
  owner?: unknown;
  tokens?: unknown;
  nonFungibles?: unknown;
  approvals?: unknown;
  emptyTokenAccounts?: unknown;
};

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function summariseScan(scan: WalletScan, at: number): ScanSummary {
  const countable = scan as unknown as Countable;
  return {
    owner: typeof countable.owner === "string" ? countable.owner : "",
    at,
    tokens: count(countable.tokens),
    nfts: count(countable.nonFungibles),
    approvals: Array.isArray(countable.approvals)
      ? countable.approvals.length
      : null,
    emptyAccounts: count(countable.emptyTokenAccounts),
  };
}

/**
 * What moved since the last scan of the same wallet, or null when it did not.
 *
 * Deliberately counts, not conclusions: "2 more tokens" is a fact from two scans,
 * while "2 new dust positions worth cleaning" is an interpretation, and the second
 * kind is how a tool starts nagging.
 */
export function describeChange(
  previous: ScanSummary | null,
  current: ScanSummary,
): string | null {
  if (!previous || previous.owner !== current.owner) return null;

  const parts: string[] = [];
  const push = (delta: number, more: string, fewer: string): void => {
    if (delta === 0) return;
    parts.push(delta > 0 ? `${delta} ${more}` : `${-delta} ${fewer}`);
  };

  push(current.tokens - previous.tokens, "more tokens", "fewer tokens");
  push(current.nfts - previous.nfts, "more collectibles", "fewer collectibles");
  push(
    current.emptyAccounts - previous.emptyAccounts,
    "more empty accounts",
    "fewer empty accounts",
  );
  if (previous.approvals !== null && current.approvals !== null) {
    push(current.approvals - previous.approvals, "more approvals", "fewer approvals");
  }

  if (parts.length === 0) return null;

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return `Since your last scan ${describeAge(previous.at)}: ${list}.`;
}

/** The stored record, or null when there is none, it is unreadable, or it is the wrong shape. */
export function readLastScan(
  storage: Storage | null = safeStorage(),
): StoredScan | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredScan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the record, dropping the full result if the origin's quota refuses it. */
export function writeLastScan(
  value: StoredScan,
  storage: Storage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota, private mode, or storage disabled. Keep the summary, which is the
    // part that makes a returning visit cheaper to explain.
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ summary: value.summary, scan: null }),
      );
    } catch {
      // Nothing else to try, and nothing in the app depends on this succeeding.
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStoredScan(value: unknown): value is StoredScan {
  if (!value || typeof value !== "object") return false;
  const record = value as { summary?: unknown; scan?: unknown };
  if (record.scan !== null && typeof record.scan !== "object") return false;

  const summary = record.summary as Partial<ScanSummary> | undefined;
  return (
    Boolean(summary) &&
    typeof summary?.owner === "string" &&
    typeof summary?.at === "number" &&
    Number.isFinite(summary.at) &&
    typeof summary?.tokens === "number" &&
    typeof summary?.nfts === "number" &&
    typeof summary?.emptyAccounts === "number" &&
    (summary?.approvals === null || typeof summary?.approvals === "number")
  );
}

/** Whether a result is small enough that keeping it will not cost the origin its quota. */
export function fitsInStorage(scan: WalletScan): boolean {
  try {
    return JSON.stringify(scan).length <= MAX_CACHED_SCAN_CHARS;
  } catch {
    // A cyclic or otherwise unserialisable result is not worth keeping either.
    return false;
  }
}

/**
 * "4 minutes ago" — the phrase that makes a cached result honest.
 *
 * A stale result shown without a timestamp is a lie by omission: the numbers look
 * live, so a wallet that has moved is reported as it was. With the age attached,
 * the same figures are useful and accurate.
 */
export function describeAge(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
