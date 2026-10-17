import {
  PublicKey,
  SystemProgram,
  type Connection,
  type ParsedAccountData,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createBurnInstruction } from "@solana/spl-token";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  BASE_FEE_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
} from "@/lib/utils/constants";
import {
  fetchRentMinimums,
  voidFeeFromRentLamports,
} from "@/lib/solana/rent";
import {
  createCloseAccountInstruction,
  createComputeBudgetInstructions,
  getOwnerAta,
  tokenProgramFor,
} from "@/lib/solana/instructions";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { sumForMints } from "@/lib/sweep/totals";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import type { DustToken } from "@/types/token";

/**
 * The Void's planning pipeline.
 *
 * For tokens with no liquidity a swap is pointless — there is no route, so
 * there is nothing to gain. The only thing left worth doing is destroying the
 * balance and closing the account, which returns the rent that was locked in it.
 *
 * Two instructions per token, both built locally — no Jupiter call, no server
 * round-trip, and never mixed into a swap transaction:
 *
 *   burn (empty the account) → closeAccount (return the rent)
 *
 * Everything else is shared with the swap flow on purpose: same packer, same
 * 1232-byte measurement, same simulate-before-sign gate. Nothing here signs or
 * sends anything.
 */

export interface PlanVoidInput {
  connection: Connection;
  owner: PublicKey;
  tokens: DustToken[];
}

export interface PlanVoidResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Precise fee estimate, based on the real transaction count. */
  estimatedFeeLamports: number;
  /** Rent-exempt minimum for one token account, as reported by the chain. */
  tokenAccountRentLamports: number;
  /**
   * The deposit each close returns, per mint, read from the account itself.
   *
   * Per mint rather than one figure: deposits differ between accounts, and the
   * panel and the success screen both total these rather than multiplying.
   */
  rentByMint: Map<string, number>;
  /** The Void's fee on each of those deposits, per mint. */
  feeByMint: Map<string, number>;
  /** Rent we expect back: one token account closed per burned token. */
  estimatedRentReclaimLamports: number;
  /** Gross rent minus The Void's fee — what actually lands in the wallet. */
  estimatedNetRentLamports: number;
  /** The Void's fee on that rent, in lamports. Zero when fees are off. */
  estimatedVoidFeeLamports: number;
  /** True when at least one transaction failed to simulate. */
  hasFailures: boolean;
}

/** A planning failure with a user-facing message and recovery hint. */
export class VoidError extends Error {
  override readonly name = "VoidError";
  constructor(
    message: string,
    readonly hint?: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

/**
 * The token account to burn from.
 *
 * Prefers the address the scanner actually found — for a non-canonical holding
 * that is the only account that holds anything, and it is still owned by the
 * mint's token program, so the burn is valid. Falls back to the derived ATA
 * when the scanner had no address for this token.
 */
function resolveTokenAccount(
  token: DustToken,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  const reported = token.tokenAccount;
  if (reported) {
    try {
      return new PublicKey(reported);
    } catch {
      // Fall through to the derived ATA.
    }
  }
  return getOwnerAta(owner, mint, tokenProgram);
}

/**
 * Which of these token accounts are frozen.
 *
 * A frozen account can be neither burned nor closed — the token program rejects
 * both — so offering one guarantees a preview that cannot succeed.
 *
 * `getMultipleParsedAccounts` rather than `getMultipleAccounts`, so the state
 * comes back as the word "frozen" instead of a byte we would have to index into
 * a layout by hand. Batched, because one RPC call takes at most 100 keys.
 *
 * Unverifiable is not the same as frozen: a failed call returns an empty set and
 * leaves those tokens offered, so the simulation stays the judge. Refusing
 * something that is actually fine would be the worse mistake of the two.
 */
/**
 * One batched read of the accounts this batch will close.
 *
 * Two facts come out of the same call: whether an account is **frozen** (so it is
 * refused with a reason rather than at simulation) and its own **rent-exempt
 * deposit** (so the rent promised and The Void's fee are both priced from the
 * account itself). Pricing from a single constant understated every account that
 * was larger than a fresh 165-byte one, or funded before the network's rent change.
 */
async function readTokenAccounts(
  connection: Connection,
  accounts: PublicKey[],
): Promise<{ frozen: Set<string>; lamportsByAccount: Map<string, number> }> {
  const frozen = new Set<string>();
  const lamportsByAccount = new Map<string, number>();
  const unique = [...new Set(accounts.map((account) => account.toBase58()))];

  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100);
    try {
      const response = await connection.getMultipleParsedAccounts(
        batch.map((address) => new PublicKey(address)),
      );
      response.value.forEach((info, index) => {
        const address = batch[index];
        if (!address || !info) return;
        lamportsByAccount.set(address, info.lamports);
        const data = info.data;
        const parsed =
          data && typeof data === "object" && "parsed" in data
            ? (data as ParsedAccountData).parsed
            : null;
        const state = (parsed?.info as { state?: unknown } | undefined)?.state;
        if (state === "frozen") frozen.add(address);
      });
    } catch {
      // Unknown is not frozen, and an unread deposit earns no fee.
    }
  }

  return { frozen, lamportsByAccount };
}

export async function planVoid(
  input: PlanVoidInput,
): Promise<PlanVoidResult> {
  const { connection, owner, tokens } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];
  /**
   * The deposit each close returns, and the fee charged on it, per mint — from
   * the batched read below, not from one figure multiplied by a count.
   */
  const rentByMint = new Map<string, number>();
  const feeByMint = new Map<string, number>();

  // The fee wallet, if fees are switched on. Read from the *public* config
  // because this pipeline runs in the browser and has to build the transfer.
  const feeWallet = getPublicFeeWallet();

  // Rent, from the chain rather than a constant. This one number drives both
  // what the user is told they get back AND the fee, which is a percentage of
  // it — so a stale copy here does not just misreport, it mischarges.
  const rent = await fetchRentMinimums(connection);

  // It is not enough for a fee wallet to be configured — it has to be *funded*.
  // Solana refuses to create an account below the rent-exempt minimum, and The
  // Void's fee is tens of thousands of lamports, far below what a fresh address
  // needs. Sending it to an unfunded address fails the entire transaction with
  // `InsufficientFundsForRent` rather than creating anything. Verified once,
  // before any fee is added.
  let feeEnabled = false;
  if (feeWallet) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(feeWallet));
      feeEnabled = (info?.lamports ?? 0) >= rent.emptyAccount;
    } catch {
      // Could not check — skip the fee rather than risk the whole burn.
      feeEnabled = false;
    }
    if (!feeEnabled) {
      warnings.push(
        `No Void fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it. Send it a little SOL to start collecting.`,
      );
    }
  }

  // ── 0. Refuse frozen accounts before offering to burn them ───────────────
  // A frozen account can be neither burned nor closed, so offering one is
  // offering a preview that cannot succeed.
  //
  // The NFT side already refuses frozen assets (`nftBurnability`); this is the
  // same rule for fungibles, where it was missing — and that gap is why a user's
  // entire feedback for a frozen token was a raw
  // `{"InstructionError":[2,{"Custom":17}]}`. Nothing upstream had looked, so
  // the burn was built, simulated, and refused by the token program.
  //
  // Asked of the chain rather than taken from the scan, because the two
  // scanners disagree: the free-RPC one already drops non-initialised accounts,
  // while the DAS one cannot report this at all.
  const candidateAccounts: PublicKey[] = [];
  for (const token of tokens) {
    try {
      candidateAccounts.push(
        resolveTokenAccount(
          token,
          owner,
          new PublicKey(token.mint),
          tokenProgramFor(token.program),
        ),
      );
    } catch {
      // A mint that will not parse is reported by the loop below, with a better
      // message than this pre-pass could give.
    }
  }
  const { frozen: frozenAccounts, lamportsByAccount } = await readTokenAccounts(
    connection,
    candidateAccounts,
  );

  // ── 1. One burn + close pair per token ────────────────────────────────────
  // Everything is validated locally: the mint must parse, the amount must fit
  // a u64, and the ATA must be derivable. A token that fails any of this is
  // reported, never silently dropped.
  for (const token of tokens) {
    try {
      const mint = new PublicKey(token.mint);
      const amount = BigInt(token.rawAmount);
      if (amount <= 0n) {
        warnings.push(`${token.symbol}: nothing left to send.`);
        continue;
      }

      const tokenProgram = tokenProgramFor(token.program);
      // Burn from the account that actually holds the balance. For a
      // non-canonical holding this differs from the ATA, and burning from an
      // address that holds no account fails with `InvalidAccountData`.
      const account = resolveTokenAccount(token, owner, mint, tokenProgram);

      // Refused here rather than at simulation, so the row can say why instead
      // of the whole preview failing on a raw program error.
      if (frozenAccounts.has(account.toBase58())) {
        warnings.push(
          `${token.symbol}: frozen by the mint's authority, so it cannot be burned. Skipping.`,
        );
        continue;
      }

      /**
       * A pool share is never burned, and this is the one refusal here that
       * protects value rather than reporting a limit.
       *
       * The mint is controlled by a program, which means the balance is a claim
       * on a pool rather than a token with a market — so it is exactly the shape
       * this page exists to list, and exactly the shape that must not be
       * destroyed. Burning it closes the account and gives away the share of the
       * pool it represented, irreversibly, for nothing. Withdrawing it is the
       * only route that returns value, and that belongs to a planner that knows
       * the pool's program. See `lib/sweep/pool-positions.ts`.
       */
      // A named staking token is refused for the same reason, in its own words:
      // burning it destroys a claim on staked SOL, which is not a pool share and
      // should not be described as one. See `lib/staking/staked-tokens.ts`.
      if (token.staked) {
        warnings.push(
          `${token.symbol}: a staking token (${token.staked.protocol}), so burning it would destroy the position for nothing. Skipping.`,
        );
        continue;
      }

      if (token.poolLike) {
        warnings.push(
          `${token.symbol}: held in a liquidity pool, so burning it would give the share away for nothing. Skipping.`,
        );
        continue;
      }

      const instructions: TransactionInstruction[] = [
        // Burn first: `closeAccount` refuses to run on a non-empty account.
        createBurnInstruction(account, mint, owner, amount, [], tokenProgram),
        // The close must use the mint's own program — a Token-2022 account
        // cannot be closed by the legacy Token program.
        createCloseAccountInstruction(account, owner, tokenProgram),
      ];

      // ── The Void's fee ───────────────────────────────────────────────────
      // Taken from the rent the close above is about to return. A burn destroys
      // the token, so the reclaimed rent *is* the only value in a Void send —
      // there is no output amount to charge a percentage of.
      //
      // Priced per account, from **that account's own deposit**, which is the
      // figure the batched read above just returned. A single per-account amount
      // used to stand here, and it understated both the rent shown and the fee
      // taken on any account larger than a fresh 165-byte one.
      //
      // Priced per account rather than per transaction on purpose: the packer
      // decides how many units share a transaction, so a per-transaction fee
      // would be charged once per *packet* and would silently scale with the
      // grouping. This amount is exact regardless of how units are grouped.
      //
      // It sits after the close, so it can always be funded: the close credits
      // the full rent to `owner` first, and the fee is a floor of 1.5% of it.
      //
      // A deposit we could not read earns no fee at all — a percentage of a guess
      // is worse than no charge.
      const rentLamports = lamportsByAccount.get(account.toBase58()) ?? 0;
      const accountFee =
        feeWallet && feeEnabled && rentLamports > 0
          ? voidFeeFromRentLamports(rentLamports)
          : 0;
      if (feeWallet && accountFee > 0) {
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: owner,
            toPubkey: new PublicKey(feeWallet),
            lamports: accountFee,
          }),
        );
      }

      units.push({ mint: token.mint, instructions, rentReclaim: true });
      if (rentLamports > 0) {
        rentByMint.set(token.mint, rentLamports);
        if (accountFee > 0) feeByMint.set(token.mint, accountFee);
      }
    } catch (error) {
      warnings.push(
        `Skipped ${token.symbol}: ${
          error instanceof Error ? error.message : "could not build a burn."
        }`,
      );
    }
  }

  if (units.length === 0) {
    throw new VoidError(
      "None of the selected tokens could be prepared to send into The Void.",
      "Rescan the wallet and try again.",
      warnings,
    );
  }

  // ── 2. Pack into the fewest possible transactions ─────────────────────────
  // Burns are small, so this is usually one transaction for a whole wallet.
  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    // Burns need no ALTs: every account is local to the token being burned.
    lookupTables: [],
  });

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`,
    ),
  );

  if (packedResult.transactions.length === 0) {
    throw new VoidError(
      "The selected sends are too large to go at once.",
      "Try sending fewer tokens into The Void at a time.",
      warnings,
    );
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // A burn destroys the token and a close returns the rent, so this checks the
  // two things that could go wrong: a burn authorised by someone else, and a
  // close whose rent does not come back to the wallet. The fee is one SOL
  // transfer per closed account, priced against the chain's own rent figure.
  const auditClosedMints = new Set(
    packedResult.transactions.flatMap((tx) => tx.rentReclaimMints),
  );
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "void",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: sumForMints(feeByMint, auditClosedMints),
    },
  });

  // ── 3. Simulate everything before asking for a signature ──────────────────
  // The safety gate. Frozen accounts, transfer-hook mints and stale balances
  // all surface here, before the user approves anything.
  const simulations = await simulateAll(connection, packedResult.transactions);
  const hasFailures = simulations.some((simulation) => !simulation.ok);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new VoidError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee =
    Math.ceil((COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000);
  const estimatedFeeLamports =
    packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee);

  const closedMints = new Set(
    packedResult.transactions.flatMap(
      (transaction) => transaction.rentReclaimMints,
    ),
  );

  // One fee transfer per closed account, so the total is a sum over the accounts
  // that made it into a transaction — each priced from its own deposit.
  const grossRentLamports = sumForMints(rentByMint, closedMints);
  const estimatedVoidFeeLamports = sumForMints(feeByMint, closedMints);

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports,
    tokenAccountRentLamports: rent.tokenAccount,
    rentByMint,
    feeByMint,
    estimatedRentReclaimLamports: grossRentLamports,
    estimatedNetRentLamports: grossRentLamports - estimatedVoidFeeLamports,
    estimatedVoidFeeLamports,
    hasFailures,
  };
}
