import "server-only";

import { getHeliusApiKey } from "@/lib/config/env";
import { UpstreamError } from "@/lib/utils/errors";
import { scanWalletTokens } from "@/lib/helius/das.server";
import { scanWalletViaRpc } from "./rpc.server";
import { listEmptyTokenAccounts } from "./empty-accounts.server";
import type { ScanResult } from "./types";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Chooses a token source at runtime.
 *
 * This is the single place that knows Helius is optional. If a key is present
 * we use DAS (one indexed call, best metadata). If not, we fall back to core RPC
 * so a personal deployment runs at zero cost with no account at all.
 */

/**
 * A complete scan: the provider's result plus the reads no provider does.
 *
 * The empty-account read lives outside the two scanners on purpose. Neither
 * source can answer it — both drop a zero balance by design, and DAS does not
 * report a close authority — so it is done here, once, for whichever source
 * ran, rather than twice with two chances to disagree.
 */
export type WalletScanResult = ScanResult & {
  emptyAccounts: EmptyTokenAccount[];
  emptyAccountsError: string | null;
};

/**
 * Attach the wallet's empty token accounts to a scan.
 *
 * A failure here must not fail the scan: the token list is the main event and
 * the rent rows are a bonus. But it must not be silent either — an empty list
 * and a failed read look identical to a user, and only one means "none". The
 * error is carried in the payload so the UI can say which it is.
 */
async function withEmptyAccounts(
  scan: ScanResult,
  owner: string,
): Promise<WalletScanResult> {
  try {
    return {
      ...scan,
      emptyAccounts: await listEmptyTokenAccounts(owner),
      emptyAccountsError: null,
    };
  } catch (error) {
    console.warn(
      `[spacedust] could not read empty token accounts: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      ...scan,
      emptyAccounts: [],
      emptyAccountsError:
        "Could not check for already-empty token accounts. The rest of this scan is unaffected.",
    };
  }
}

/**
 * Scan a wallet, using whichever provider is available.
 *
 * If Helius is configured but fails, we fall back to core RPC rather than
 * showing the user an error — a degraded scan beats no scan. Helius-only
 * failures (an invalid key) are re-thrown, because retrying with a different
 * provider would mask a configuration mistake.
 */
export async function scanWallet(owner: string): Promise<WalletScanResult> {
  if (!getHeliusApiKey()) {
    return withEmptyAccounts(await scanWalletViaRpc(owner), owner);
  }

  try {
    return await withEmptyAccounts(await scanWalletTokens(owner), owner);
  } catch (error) {
    // Log loudly: a silent fallback looks identical to success from the UI's
    // point of view, and hides a broken or exhausted Helius configuration.
    console.warn(
      `[spacedust] Helius DAS failed, falling back to core RPC: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    // A bad key will never start working; tell the user to fix it.
    if (error instanceof UpstreamError && error.provider === "helius") {
      const isConfigProblem =
        /api-key|api key|authentication|unauthorized|credits|quota/i.test(
          error.message,
        );
      if (isConfigProblem) throw error;
    }
    return withEmptyAccounts(await scanWalletViaRpc(owner), owner);
  }
}

export type { ScanResult, ScannedHolding } from "./types";