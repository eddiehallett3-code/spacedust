import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";
import { getServerRpcUrl } from "@/lib/config/env";
import {
  STAKE_ACCOUNT_SIZE,
  STAKE_WITHDRAWER_OFFSET,
  parseStakeAccount,
} from "./native-stake";
import type { StakedAccount } from "@/types/token";

/**
 * Read the wallet's native SOL stake accounts.
 *
 * WHY THIS IS A SEPARATE READ
 *
 * A staked SOL position is an account, not a token: no mint, no ATA, nothing
 * `getTokenAccountsByOwner` can see. The only way to find one is to ask the
 * Stake program for accounts whose withdraw authority is this wallet.
 *
 * WHY THE RESULT IS RE-CHECKED
 *
 * `getProgramAccounts` with a `memcmp` filter is the whole read, and if the
 * offset is wrong the filter does not error — it returns nothing. That failure
 * mode is indistinguishable from "this wallet has no stake", and it is not
 * hypothetical: the voter field was assumed to be at 76 and is really at 124
 * (a 48-byte `Lockup` sits in between — see `native-stake.ts`). So every account
 * that comes back has its decoded withdraw authority compared against the wallet
 * we asked about, and a mismatch is dropped rather than trusted. A filter that
 * quietly matched nothing looks exactly like a wallet with no stake; a filter
 * that quietly matched the *wrong* accounts would be a false claim about
 * someone's SOL, which is worse.
 *
 * AVAILABILITY
 *
 * `getProgramAccounts` is not offered by the public RPC endpoint, so this read
 * only works on the Helius path. Losing it must not lose the scan: a failure is
 * reported as a string and the token list is unaffected — the same rule the
 * empty-account read follows in `lib/token-source/index.server.ts`.
 */

const STAKE_PROGRAM_ID = "Stake11111111111111111111111111111111111111";

export interface NativeStakeRead {
  accounts: StakedAccount[];
  /** Set when the read failed. Distinct from an empty list, which means "none". */
  error: string | null;
}

export async function readNativeStakeAccounts(
  owner: string,
): Promise<NativeStakeRead> {
  try {
    const connection = new Connection(getServerRpcUrl(), "confirmed");

    const [epochInfo, found] = await Promise.all([
      connection.getEpochInfo(),
      connection.getProgramAccounts(new PublicKey(STAKE_PROGRAM_ID), {
        filters: [
          // Every stake account is 200 bytes in every state, so this narrows the
          // program's 1.4M accounts without excluding any of them by state.
          { dataSize: STAKE_ACCOUNT_SIZE },
          {
            memcmp: {
              offset: STAKE_WITHDRAWER_OFFSET,
              bytes: owner,
            },
          },
        ],
      }),
    ]);

    const accounts: StakedAccount[] = [];
    for (const { pubkey, account } of found) {
      const parsed = parseStakeAccount(account.data, epochInfo.epoch);
      if (!parsed) continue;
      // See the note above: never trust the filter alone.
      if (parsed.withdrawer !== owner) continue;

      accounts.push({
        address: pubkey.toBase58(),
        state: parsed.state,
        lamports: parsed.lamports,
        sol: Number(parsed.lamports) / 1e9,
        validator: parsed.validator,
      });
    }

    // Largest first, matching how the dust list is ordered.
    accounts.sort((a, b) => b.sol - a.sol);

    return { accounts, error: null };
  } catch {
    return {
      accounts: [],
      error:
        "Could not read this wallet's stake accounts. The rest of the scan is unaffected.",
    };
  }
}
