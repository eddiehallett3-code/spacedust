/**
 * Formatting helpers.
 *
 * All `Intl` formatters are created once at module scope — constructing a
 * `NumberFormat` per render is a measurable cost inside an animated list.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdPreciseFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Format a USD amount.
 *
 * Dust lives below a cent, so anything under $0.01 is rendered with up to 6
 * decimals — otherwise every row would read "$0.00" and the app would look
 * broken.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) {
    const abs = Math.abs(value);
    if (abs < 0.000001) return "<$0.000001";
    return usdPreciseFormatter.format(value);
  }
  if (Math.abs(value) >= 100_000) return compactUsdFormatter.format(value);
  return usdFormatter.format(value);
}

/** Format a plain token amount, trimming trailing zeros and capping precision. */
export function formatAmount(
  value: number | null | undefined,
  maxDecimals = 4,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs < 0.000001) return `<0.000001`;
  if (abs >= 1_000_000_000) {
    return `${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value)}`;
  }
  // Below 1 unit, show more decimals — "0.42" vs "0.0000042" matter here.
  const decimals = abs < 1 ? Math.max(maxDecimals, 6) : maxDecimals;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
  return formatted.replace(/\.?0+$/, "") || "0";
}

/** Format lamports as SOL. */
export function formatSol(lamports: number | bigint | null | undefined): string {
  if (lamports == null) return "—";
  const value = typeof lamports === "bigint" ? Number(lamports) / 1e9 : lamports / 1e9;
  return `${formatAmount(value, 6)} SOL`;
}

/**
 * A fraction → "1.23%". Accepts either a fraction (0.0123) or an already
 * multiplied percentage (1.23) via `isPercent`.
 */
export function formatPercent(
  fraction: number | null | undefined,
  digits = 2,
): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** `1S4cH…9fQ2` — for showing an address without inviting a bad copy-paste. */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (typeof address !== "string" || address.length <= lead + tail + 1) {
    return address ?? "";
  }
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** "just now" / "4m ago" / "3d ago" */
export function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Duration in ms → "412ms" / "1.4s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Count → "1 token" / "12 tokens". */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * "0 of 2 transactions", not "0 of 2 2 transactions".
 *
 * `pluralize` already includes the count; a caller that writes the total before
 * it prints the number twice. The batch overlay did exactly that.
 */
export function formatTransactionProgress(
  completed: number,
  total: number,
): string {
  return `${completed} of ${pluralize(total, "transaction")}`;
}
