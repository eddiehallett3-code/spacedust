/**
 * Turning raw failures into things a human can act on.
 *
 * Solana error surfaces are famously opaque (a "custom program error: 0x1" three
 * frames deep). We map the common cases to advice, and fall back to the raw
 * text so nothing is ever swallowed.
 */

import {
  describeEmptyWallet,
  describeFeeShortfall,
  EmptyWalletError,
  FeeShortfallError,
} from "@/lib/solana/fee-shortfall";

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

/**
 * Phantom's words for "this site is no longer authorised", shared between the
 * message the user reads and the button that fixes it.
 *
 * Exported so a panel can offer the one action that works — disconnect — rather
 * than telling someone to go and find a menu item while nothing responds.
 */
export const WALLET_DEAUTHORISED_PATTERN =
  /requested method and\/or account has not been authorized|has not been authorized by the user|no longer has Spacedust authorised/i;

/** True when the only way forward is to reconnect the wallet. */
export function needsWalletReconnect(message: string): boolean {
  return WALLET_DEAUTHORISED_PATTERN.test(message);
}

const RULES: Rule[] = [
  {
    // The WalletConnect relay is one DNS lookup away from working, and this is
    // what its absence looks like: the relay host does not resolve, so a request
    // can never reach the wallet. Captured on a real device as
    // `ERR_NAME_NOT_RESOLVED` against `relay.walletconnect.org` — five attempts
    // in a row — and it presents in the worst possible way, because connecting can
    // still appear to work (or was completed earlier) while the signing request
    // quietly goes nowhere: the page waits, the wallet never prompts.
    test: /ERR_NAME_NOT_RESOLVED|relay\.walletconnect\.org/i,
    map: () => ({
      title: "Could not reach WalletConnect",
      message:
        "The relay that carries requests to your wallet could not be reached, so nothing was sent to it.",
      hint: "Check your connection, and try turning off any DNS-level ad blocker, VPN or custom Private DNS setting — those are what usually stop this host resolving.",
    }),
  },
  {
    // A wallet that accepted the request and never answered it. Distinct from a
    // refusal: nothing was declined and nothing was sent.
    //
    // On Android the cause is known and it is not the user's mistake. Phantom's
    // Mobile Wallet Adapter support never starts the local socket the protocol
    // needs from an ordinary browser, so Phantom opens and shows nothing — no
    // prompt, no error. That was measured on a real device and is recorded in
    // `components/wallet/wallet-modal.tsx`. The advice therefore names the route
    // that works, rather than a permission dialog that is not the problem.
    test: /did not answer the signing request|Wallet connection timed out/i,
    map: () => ({
      title: "Your wallet never answered",
      message:
        "The wallet opened but never came back with a signature, so nothing was sent and nothing was charged.",
      hint: "If you connected with Mobile Wallet Adapter, Phantom opens but cannot finish the request from an ordinary browser. Use the “Open in Phantom” link under the wallet list instead — it runs the whole app inside Phantom — or connect with WalletConnect.",
    }),
  },
  {
    // Phantom's words for "this site is no longer authorised", which is what a
    // user gets after restarting the extension or clearing site permissions: the
    // page still believes it is connected, the wallet has forgotten the approval,
    // and the request is refused before anything is shown or signed.
    //
    // Named exactly, because the generic fallback ("Something went wrong") tells
    // the user nothing and invites a retry that cannot possibly work — and because
    // Phantom support's own advice after a domain review is to restart the app,
    // which is precisely what puts users in this state.
    test: WALLET_DEAUTHORISED_PATTERN,
    map: () => ({
      title: "Reconnect your wallet",
      message:
        "Your wallet no longer has Spacedust authorised — this happens after the extension restarts or site permissions are cleared. Nothing was signed or sent.",
      hint: "Disconnect and connect again (or reload the page), then run the preview and sign in one go.",
    }),
  },
  {
    // The mobile wallet adapter keeps its authorization in memory, so a page
    // that was reloaded (or a session that expired) can look connected in the
    // app while the wallet no longer holds a session. The fix is to reconnect,
    // which is worth saying outright rather than passing along the raw text.
    test: /Wallet not connected/i,
    map: () => ({
      title: "Your wallet session has ended",
      message:
        "The app still shows your address, but the wallet no longer holds an open session — this happens after the page reloads or the connection times out.",
      hint: "Disconnect and connect again, then run the preview and sign in one go.",
    }),
  },
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
        "The wallet could not cover the network fee, so the transaction was not accepted.",
      // Not "reclaim rent to fund it": that is circular for a wallet with no
      // SOL, because the close that would return the rent needs the fee first.
      // The plan-time case states the exact amount — this is the fallback for a
      // failure that arrives later, where there are no figures to quote.
      hint: "Send a little SOL to this wallet from another wallet or exchange and try again. Solana takes the fee before a close releases anything, so the rent cannot pay for the transaction that returns it.",
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

  // Checked before the rules: these two already know their own numbers — how
  // much is missing, and the address to send it to — and the generic
  // "top up ~0.01 SOL" rule below would throw all of that away.
  if (error instanceof EmptyWalletError) {
    return describeEmptyWallet(error.payer);
  }
  if (error instanceof FeeShortfallError) {
    return describeFeeShortfall(error.shortfall);
  }

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