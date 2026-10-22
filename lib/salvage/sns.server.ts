import "server-only";

import {
  Connection,
  PublicKey,
  type AccountInfo,
} from "@solana/web3.js";
import {
  getDomainMint,
  getSnsDomainsForOwner,
} from "@bonfida/spl-name-service";
import { getServerRpcUrl } from "@/lib/config/env";
import type { SalvageDomain } from "@/types/salvage";

/**
 * Read the `.sns` names a wallet owns.
 *
 * This lives outside both routes because two screens need the same answer: the
 * Salvage picker, which can delete a name, and the read-only Wallet Scan, which
 * should at least show that the name exists. Keeping one reader means the two
 * cannot disagree about ownership or rent.
 *
 * The SNS SDK composes a `getProgramAccounts` lookup, which this app's RPC proxy
 * deliberately does not expose. That is why the read happens here, on the
 * server, where the Helius key already lives.
 */

/**
 * The owner stored in a name registry's header: parent(32) · owner(32) ·
 * class(32), then the domain's own data. Read by offset, never assumed to be the
 * wallet that asked.
 */
function ownerOf(data: Buffer | Uint8Array | undefined): string | null {
  if (!data || data.length < 64) return null;
  try {
    return new PublicKey(data.subarray(32, 64)).toBase58();
  } catch {
    return null;
  }
}

/**
 * Read an aligned list of accounts in 100-key batches.
 *
 * `getMultipleAccountsInfo` is capped by the RPC at 100 keys per request in
 * practice; sending 250 used to look like it worked only while nobody owned that
 * many names. Batching keeps the alignment the mapping below relies on.
 */
async function readAccounts(
  connection: Connection,
  keys: readonly PublicKey[],
): Promise<Array<AccountInfo<Buffer> | null>> {
  const out: Array<AccountInfo<Buffer> | null> = [];
  for (let index = 0; index < keys.length; index += 100) {
    const batch = keys.slice(index, index + 100);
    const infos = await connection.getMultipleAccountsInfo(batch);
    out.push(...infos);
  }
  return out;
}

/** Every `.sns` name this wallet owns, capped at 250 for the caller's UI. */
export async function readSnsDomains(owner: string): Promise<{
  domains: SalvageDomain[];
  truncated: boolean;
}> {
  const connection = new Connection(getServerRpcUrl(), "confirmed");
  const wallet = new PublicKey(owner);

  // The SDK returns names without the suffix; strip one defensively so a future
  // response that includes `.sns` cannot render as `name.sns.sns`.
  const found = await getSnsDomainsForOwner(connection, wallet);

  if (found.length === 0) {
    return { domains: [], truncated: false };
  }

  const entries = found.slice(0, 250).map((entry) => ({
    name: String(entry.domain).replace(/\.(sns|sol)$/i, ""),
    key: new PublicKey(entry.key),
  }));

  // Two batched reads rather than two per domain: reading accounts one at a time
  // is what drew 429s from the RPC during the probe run.
  const accounts = await readAccounts(
    connection,
    entries.map((entry) => entry.key),
  );
  const mints = await readAccounts(
    connection,
    entries.map((entry) => getDomainMint(entry.key)),
  );

  const domains: SalvageDomain[] = entries.map((entry, index) => {
    const account = accounts[index];
    return {
      name: entry.name,
      address: entry.key.toBase58(),
      lamports: account?.lamports ?? 0,
      bytes: account?.data.length ?? 0,
      owner: ownerOf(account?.data),
      tokenized: mints[index] !== null,
    };
  });

  return {
    domains,
    // A domain collector can own hundreds, so the page says when it is showing a
    // subset rather than letting 250 look like the whole wallet.
    truncated: found.length > entries.length,
  };
}
