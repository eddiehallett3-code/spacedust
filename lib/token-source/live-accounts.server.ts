import "server-only";

import { PublicKey, type Connection } from "@solana/web3.js";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type { DustToken } from "@/types/token";

/**
 * Reconcile a DAS result against the accounts it claims still exist.
 *
 * A DAS index is not the chain. Right after a swap closes a source account, the
 * index can keep returning that holding for a while — the wallet then shows a
 * token whose account is gone, with a balance no quote can fill. The same read
 * also reports the account state, which matters because DAS does not always set
 * `ownership.frozen` for fungible Token-2022 accounts.
 *
 * One batched parsed read per 100 accounts. A missing account removes the
 * holding; a frozen one is marked. A failed read changes nothing: an uncertain
 * token is better than a real one silently dropped.
 */
export async function reconcileDustTokenAccounts(
  connection: Connection,
  tokens: DustToken[],
): Promise<DustToken[]> {
  const addresses = [
    ...new Set(
      tokens
        .map((token) => token.tokenAccount)
        .filter(
          (address): address is string =>
            typeof address === "string" && isValidSolanaAddress(address),
        ),
    ),
  ];
  if (addresses.length === 0) return tokens;

  const missing = new Set<string>();
  const frozen = new Set<string>();

  for (let index = 0; index < addresses.length; index += 100) {
    const batch = addresses.slice(index, index + 100);
    try {
      const result = await connection.getMultipleParsedAccounts(
        batch.map((address) => new PublicKey(address)),
      );
      result.value.forEach((info, offset) => {
        const address = batch[offset];
        if (!address) return;
        if (!info) {
          missing.add(address);
          return;
        }
        const data = info.data;
        const state =
          data && "parsed" in data
            ? data.parsed?.info?.state
            : undefined;
        if (state === "frozen") frozen.add(address);
      });
    } catch {
      // A failed verification must not hide a real holding.
      return tokens;
    }
  }

  return tokens
    .filter(
      (token) => !token.tokenAccount || !missing.has(token.tokenAccount),
    )
    .map((token) =>
      token.tokenAccount && frozen.has(token.tokenAccount)
        ? { ...token, frozen: true }
        : token,
    );
}
