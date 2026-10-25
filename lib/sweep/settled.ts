import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { OUTPUT_ASSETS, WSOL_MINT } from "@/lib/utils/constants";
import type { OutputAsset } from "@/types/sweep";

/**
 * What the chain says a sweep actually cost and delivered.
 *
 * The success screen used to report two figures it had not measured: the network
 * fee came from the simulation's estimate, and "You received" came from the
 * amount each swap was **quoted** to produce. Both were reasonable, and both were
 * wrong in a way that only shows up next to the chain:
 *
 *  - a wallet that sets its own priority fee charged 87,000 lamports where the
 *    estimate said 7,000 (Solflare, measured), so the receipt understated the
 *    network fee twelvefold;
 *  - a route that filled slightly worse than quoted made "You received" 459
 *    lamports optimistic (also measured).
 *
 * Neither is a fund bug. Both are the kind of small dishonesty the rest of this
 * codebase refuses to ship, and both are fixable by reading the confirmed
 * transactions we already waited for.
 *
 * `null` means "could not read". Callers must fall back to the quote rather than
 * report a partial sum: half a fee is worse than an estimate, because it looks
 * measured.
 */
export interface SettledSweep {
  /** Network fees actually paid, summed over every confirmed transaction. */
  feeLamports: number;
  /** Output asset units that actually arrived, in whole units. */
  received: number;
  transactionsRead: number;
}

/**
 * Read a sweep's settled cost and delivery from its confirmed transactions.
 *
 * Fee is `meta.fee` per transaction — the only figure that knows about a wallet's
 * own priority fee. Delivery is measured two ways, because the output asset
 * decides where the proceeds land:
 *
 *  - **SOL** (the wSOL mint): proceeds arrive as native lamports, so the owner's
 *    balance delta is corrected for the three things that also move lamports in
 *    the same transaction — the rent the closes credited, the platform fee paid
 *    out, and the network fee. What remains is what the route delivered. Verified
 *    against a real 3-token sweep: 4,923,307 + 7,000 + 44,652 − 2,976,880 =
 *    1,998,079 lamports for that transaction, matching the balance to the lamport.
 *  - **USDC / JUP**: the output token account's balance delta, taken from the
 *    pre/post token balances in the same transaction.
 *
 * All-or-nothing on purpose. One unreadable transaction returns `null`, so the
 * caller reports a quote instead of a number that silently drops a leg.
 */
export async function readSettledSweep(params: {
  connection: Connection;
  signatures: readonly string[];
  owner: string;
  outputAsset: OutputAsset;
  feeWallet?: string | null;
}): Promise<SettledSweep | null> {
  const { connection, signatures, owner, outputAsset, feeWallet } = params;
  if (signatures.length === 0) return null;

  const config = OUTPUT_ASSETS[outputAsset];
  const isNativeOutput = config.mint === WSOL_MINT;

  let feeLamports = 0;
  let rawReceived = 0;

  for (const signature of signatures) {
    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      return null;
    }
    if (!tx?.meta) return null;

    feeLamports += tx.meta.fee;

    const keys = tx.transaction.message.accountKeys.map((entry) => entry.pubkey.toBase58());
    const ownerIndex = keys.indexOf(owner);
    if (ownerIndex === -1) return null;

    const instructions = [
      ...(tx.transaction.message.instructions ?? []),
      ...(tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions ?? []),
    ];

    if (!isNativeOutput) {
      rawReceived += tokenDelta(tx, owner, config.mint);
      continue;
    }

    // Rent the closes handed to this owner, read from each closed account's own
    // pre-balance rather than from a constant: deposits differ by account size.
    let rentCredited = 0;
    let platformFeePaid = 0;
    for (const instruction of instructions) {
      const parsed = "parsed" in instruction ? instruction.parsed : undefined;
      if (!parsed?.info) continue;

      if (parsed.type === "closeAccount" && parsed.info.destination === owner) {
        const closedIndex = keys.indexOf(parsed.info.account);
        if (closedIndex > -1) rentCredited += tx.meta.preBalances[closedIndex] ?? 0;
      }

      if (
        feeWallet &&
        parsed.type === "transfer" &&
        parsed.info.lamports !== undefined &&
        parsed.info.source === owner &&
        parsed.info.destination === feeWallet
      ) {
        platformFeePaid += parsed.info.lamports;
      }
    }

    const ownerDelta =
      (tx.meta.postBalances[ownerIndex] ?? 0) - (tx.meta.preBalances[ownerIndex] ?? 0);

    // Conservation, not optimism: everything else that moved this owner's
    // lamports is known, so the remainder is what the route delivered.
    rawReceived += ownerDelta + tx.meta.fee + platformFeePaid - rentCredited;
  }

  return {
    feeLamports,
    received: Math.max(0, rawReceived) / 10 ** config.decimals,
    transactionsRead: signatures.length,
  };
}

/**
 * Sum of one mint's balance change for one owner, in raw units.
 *
 * Uses `uiTokenAmount.amount` (a string of raw units) rather than the float
 * `uiAmount`: a float would reintroduce the rounding this module exists to
 * remove.
 */
function tokenDelta(
  tx: ParsedTransactionWithMeta,
  owner: string,
  mint: string,
): number {
  const byIndex = (
    balances: readonly {
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount: { amount: string };
    }[],
  ) => new Map(balances.map((entry) => [entry.accountIndex, entry]));

  const before = byIndex(tx.meta?.preTokenBalances ?? []);
  const after = byIndex(tx.meta?.postTokenBalances ?? []);

  let delta = 0;
  for (const index of new Set([...before.keys(), ...after.keys()])) {
    const entry = after.get(index) ?? before.get(index);
    if (!entry || entry.mint !== mint) continue;
    // The owner is stamped on the balance entry itself, so a pool's own account
    // in the same route cannot be mistaken for the user's.
    if (entry.owner !== owner && before.get(index)?.owner !== owner) continue;

    delta +=
      Number(after.get(index)?.uiTokenAmount.amount ?? 0) -
      Number(before.get(index)?.uiTokenAmount.amount ?? 0);
  }
  return delta;
}

