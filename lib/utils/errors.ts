/**
 * Turning raw failures into things a human can act on.
 *
 * Solana error surfaces are famously opaque (a "custom program error: 0x1" three
 * frames deep). We map the common cases to advice, and fall back to the raw
 * text so nothing is ever swallowed.
 */

/** One error message plus optional recovery guidance. */
export interface FriendlyError {
  title: string;
  message: string;
  /** Optional next step shown as secondary text. */
  hint?: string;
}

interface Rule {
  test: RegExp;
  map: (match: RegExpMatchArray) => FriendlyError;
}

/**
 * Jupiter's words for "there is no route through this token".
 *
 * Used twice: to friendly-map the error, and to decide that a token which
 * failed planning belongs in the Void rather than the swap list.
 */
const NO_LIQUIDITY_PATTERN = /No routes found|no route|COULD_NOT_FIND_ANY_ROUTE|NoLiquidity/i;

/** True when a plan failure means the token has no liquidity to swap through. */
export function isNoLiquidityFailure(reason: string): boolean {
  return NO_LIQUIDITY_PATTERN.test(reason);
}

const RULES: Rule[] = [
  {
    test: /user rejected|declined|cancell?ed by (the )?user/i,
    map: () => ({
      title: "Signature declined",
      message: "You rejected the transaction in your wallet.",
      hint: "Nothing was submitted and nothing was charged. You can try again whenever you like.",
    }),
  },
  {
    test: /blockhash not found|block height exceeded|expired blockhash/i,
    map: () => ({
      title: "Blockhash expired",
      message:
        "The transaction's blockhash expired before it was signed — usually because the preview sat open for a while.",
      hint: "Nothing was swapped for that token. Run the preview again and sign promptly; a fresh blockhash is built each time.",
    }),
  },
  {
    test: /insufficient lamports|insufficient funds for fee|InsufficientFunds/i,
    map: () => ({
      title: "Not enough SOL for fees",
      message:
        "Your wallet needs a small amount of SOL to cover network fees before any swap can land.",
      hint: "Top up ~0.01 SOL, or reclaim rent from an empty token account to fund it.",
    }),
  },
  {
    test: /InvalidAccountForFee|NotEnoughSigners/i,
    map: () => ({
      title: "Wrong fee payer",
      message: "The transaction was not built with your wallet as the fee payer.",
      hint: "This is a bug — please report it with the token you were sweeping.",
    }),
  },
  {
    test: /AccountNotFound|account does not exist|invalid account data/i,
    map: () => ({
      title: "Token account moved",
      message:
        "One of the token accounts changed between scanning and swapping — it may have been moved or closed.",
      hint: "Rescan your wallet and try again.",
    }),
  },
  {
    test: NO_LIQUIDITY_PATTERN,
    map: () => ({
      title: "No liquidity",
      message: "Jupiter could not find a route for this token.",
      hint: "It may have zero liquidity or be completely delisted. Skipping it is the safe move.",
    }),
  },
  {
    test: /TokenInvalidAccountOwner|owner mismatch|Account is not owned/i,
    map: () => ({
      title: "Token-2022 restriction",
      message:
        "This mint has a Token-2022 extension that blocks transfers or requires a transfer hook.",
      hint: "These tokens usually cannot be swept safely. Skipping it.",
    }),
  },
  {
    test: /TransferFeeRequired|transfer fee/i,
    map: () => ({
      title: "Transfer fee token",
      message: "This Token-2022 mint charges a transfer fee, so you would net less than shown.",
      hint: "Skipping it unless you specifically want to handle it.",
    }),
  },
  {
    test: /InvalidAccountData|Frozen|AccountFrozen|unauthorized/i,
    map: () => ({
      title: "Account is frozen",
      message: "The token issuer has frozen this account. Only the issuer can thaw it.",
      hint: "Nothing can be done here, so we skipped it.",
    }),
  },
  {
    test: /SlippageExceeded|EXPIRED|too much slippage|0x1$/i,
    map: () => ({
      title: "Price moved",
      message: "The market moved more than your slippage tolerance allows.",
      hint: "Try again, or raise the slippage tolerance if you accept more price risk.",
    }),
  },
  {
    test: /429|rate limit|Too Many Requests/i,
    map: () => ({
      title: "Rate limited",
      message: "Too many requests hit the RPC or Jupiter too quickly.",
      hint: "Wait a few seconds and try again. Free tiers are generous but not infinite.",
    }),
  },
  {
    test: /fetch failed|Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED/i,
    map: () => ({
      title: "Network error",
      message: "Could not reach the server. Check your connection and try again.",
    }),
  },
  {
    test: /429$|quota|credits/i,
    map: () => ({
      title: "API quota reached",
      message: "The Helius daily credit allowance for this key is used up.",
      hint: "Add a different HELIUS_API_KEY, or wait for the daily reset.",
    }),
  },
];

/** Turn any thrown value into a user-facing error object. */
export function toFriendlyError(error: unknown): FriendlyError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return "Unknown error";
            }
          })();

  for (const rule of RULES) {
    const match = raw.match(rule.test);
    if (match) return rule.map(match);
  }

  // Nothing matched. Never swallow the original message — Solana errors are
  // cryptic but they are the only clue when something unexpected happens.
  return {
    title: "Something went wrong",
    message: raw.length > 240 ? `${raw.slice(0, 240)}…` : raw,
  };
}

/** Thrown when the app is configured without the API keys it needs. */
export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  constructor(message: string) {
    super(message);
  }
}

/** Thrown when an API we depend on returns something we cannot trust. */
export class UpstreamError extends Error {
  override readonly name = "UpstreamError";
  constructor(
    message: string,
    readonly provider: "helius" | "jupiter",
    readonly status?: number,
  ) {
    super(message);
  }
}