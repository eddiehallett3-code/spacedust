import "server-only";

import { getServerRpcUrl } from "@/lib/config/env";
import { base64ToBytes } from "@/lib/utils/base64";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";

/**
 * Fee accounts — and whether a fee can actually land in one.
 *
 * A swap fee is paid **in the output mint**, into the fee wallet's token account
 * for that asset (`lib/solana/fee-account.ts` explains why it is derived rather
 * than configured). Two things are checked before any fee is asked for, because
 * Jupiter checks neither:
 *
 *   - **It exists.** Jupiter is stateless: ask for a platform fee paid into a
 *     missing account and `/build` still returns 200 with a perfectly well-formed
 *     swap — one that then fails on chain, for every user, because the fee
 *     transfer has nowhere to land.
 *   - **It is not frozen.** A frozen token account exists, so an existence check
 *     alone would pass one, and a transfer into it fails just the same. That is
 *     the same disaster with a green health check.
 *
 * Both checks fail closed. Anything unknown — RPC down, unexpected data, an
 * account type we do not recognise — means no fee, never a hopeful one.
 */

/** The state byte in an SPL token account. `2` is frozen; transfers cannot land. */
const TOKEN_ACCOUNT_STATE_OFFSET = 108;
const TOKEN_ACCOUNT_FROZEN = 2;

interface AccountLookup {
  /** The program that owns the account, or null when it does not exist. */
  owner: string | null;
  /** Raw account bytes, or null when the response carried none. */
  data: Uint8Array | null;
}

/**
 * One `getAccountInfo`, with every failure collapsed to `null`.
 *
 * Callers treat "could not tell" and "does not exist" identically on purpose: for
 * a fee account they have the same consequence, which is that no fee is charged.
 */
async function getAccount(address: string): Promise<AccountLookup | null> {
  try {
    const response = await fetch(getServerRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "getAccountInfo",
        params: [address, { encoding: "base64" }],
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await response.json()) as {
      result?: { value?: { owner?: string; data?: [string, string] } | null };
    };
    const value = json.result?.value;
    if (!value) return null;
    const encoded = Array.isArray(value.data) ? value.data[0] : null;
    return {
      owner: value.owner ?? null,
      data: encoded ? base64ToBytes(encoded) : null,
    };
  } catch {
    return null;
  }
}

/** Can a fee be paid into this account right now, without failing on chain? */
export async function feeAccountExists(address: string): Promise<boolean> {
  const account = await getAccount(address);
  if (!account || !account.data) return false;
  if (account.owner !== TOKEN_PROGRAM_ID) return false;
  // Too short to be a token account, let alone hold a state byte.
  if (account.data.length <= TOKEN_ACCOUNT_STATE_OFFSET) return false;
  return account.data[TOKEN_ACCOUNT_STATE_OFFSET] !== TOKEN_ACCOUNT_FROZEN;
}
