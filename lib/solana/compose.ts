import {
  PublicKey,
  SystemProgram,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { base64ToBytes } from "@/lib/utils/base64";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import {
  apiToInstruction,
  apiToInstructions,
  createCloseAccountInstruction,
  getOwnerAta,
  tokenProgramFor,
} from "./instructions";
import { feeFromRentLamports } from "./rent";
import type { PackUnit } from "./pack";
import type { SwapBuild } from "@/types/sweep";

/**
 * Assembles Jupiter's per-swap instructions into packable units.
 *
 * Instruction order follows Jupiter's documented contract for `/build`
 * (https://developers.jup.ag/docs/swap/build/common-instructions):
 *
 *   compute budget → setup → [our pre-swap] → swap → [our post-swap] → cleanup
 *
 * We only ever add *post-swap* instructions (`closeAccount`), never pre-swap,
 * because the source token account is only empty once the swap has executed.
 */

/**
 * Drop any compute-budget instruction Jupiter supplies.
 *
 * We set one budget for the whole packed transaction, and a second
 * `SetComputeUnitLimit` in the same transaction is a `DuplicateInstruction` the
 * runtime rejects — which the audit refuses first. Today's responses do not
 * carry one; this is what keeps a change on Jupiter's side from turning into a
 * failed sweep on ours.
 */
function withoutComputeBudget(
  instructions: TransactionInstruction[],
): TransactionInstruction[] {
  return instructions.filter(
    (instruction) =>
      instruction.programId.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID,
  );
}

export interface ComposeUnitInput {
  owner: PublicKey;
  builds: SwapBuild[];
  /**
   * Mints whose ATA must **not** be closed. A Token-2022 mint with a transfer
   * fee leaves a residue behind, so `closeAccount` would fail the whole
   * transaction.
   */
  skipCloseMints: Set<string>;
  /** Which token program owns each mint. Drives the correct `closeAccount`. */
  tokenPrograms: Map<string, "legacy" | "token2022">;
  /**
   * Live connection used to confirm a close target really exists before we
   * close it. Optional: without it we fall back to the derived ATA, which is
   * the behaviour that produced on-chain `InvalidAccountData` failures.
   */
  connection?: Connection;
  /**
   * The wallet a rent-reclaim fee is paid to, or null when fees are off.
   *
   * Passed in rather than read here, because the planner that resolves it is the
   * same one that tells the audit what to expect — so the two can never disagree
   * about where the fee goes. Null builds no transfer at all.
   */
  feeWallet: string | null;
  /**
   * The rent-reclaim fee rate, in basis points, applied to each account's own
   * verified deposit. Zero when fees are off.
   *
   * A *rate* rather than a flat amount, because deposits differ: an account
   * funded before the network's rent change holds more than a fresh one, and a
   * Token-2022 account carrying extensions is larger than 165 bytes. Both the
   * rent we report and the fee we take have to follow the account, not a constant
   * — a flat figure understated each, which is how the panel came to disagree
   * with the chain.
   */
  reclaimFeeBps: number;
}

export interface ComposeUnitResult {
  units: PackUnit[];
  /** Routes that could not be composed at all; their swaps are dropped. */
  errors: Array<{ mint: string; reason: string }>;
  /** Non-fatal notes (for example: rent reclaim skipped). Swaps still run. */
  warnings: string[];
  /**
   * The deposit each close will return, per mint, read from the chain.
   *
   * Only closed accounts appear. Callers total these rather than multiplying a
   * single figure by a count, so the numbers on screen match what the closes
   * actually hand back.
   */
  rentByMint: Map<string, number>;
  /** The fee charged on each of those deposits, per mint, already floored. */
  feeByMint: Map<string, number>;
}

/** A resolved close target, or the reason we are not reclaiming rent. */
interface ClosePlan {
  mint: string;
  /** The account to close, or null when the reclaim must be skipped. */
  account: PublicKey | null;
  /** The owning token program, when known. */
  program: PublicKey | null;
  reason: string | null;
}

/**
 * Build one packable unit per swap, wired up with rent reclaim where safe.
 *
 * If a single token's instructions are malformed we drop that token entirely
 * rather than letting it poison the batch — one bad route must not cost the
 * user the other twenty.
 */
export async function composePackUnits({
  owner,
  builds,
  skipCloseMints,
  tokenPrograms,
  connection,
  feeWallet,
  reclaimFeeBps,
}: ComposeUnitInput): Promise<ComposeUnitResult> {
  const units: PackUnit[] = [];
  const errors: Array<{ mint: string; reason: string }> = [];
  const warnings: string[] = [];
  const rentByMint = new Map<string, number>();
  const feeByMint = new Map<string, number>();

  // ── Rent reclaim ──────────────────────────────────────────────────────────
  // After the swap the user's token account should hold zero. Closing it returns
  // the rent-exempt deposit the account was holding — very often worth more than
  // the dust token itself, which is why closing happens only after the swap has
  // drained the account. The figure is read per account and never assumed: the
  // network's minimum and a funded deposit differ, and both have moved before.
  //
  // The account we close must be the one that actually holds the balance, and
  // it must really exist. Closing an address that holds no account is rejected
  // on-chain with `InvalidAccountData`, and because the packer puts many swaps
  // in one transaction, a single bad instruction fails the entire sweep.
  const closePlans = builds.map((build) =>
    planClose(build, owner, tokenPrograms, skipCloseMints),
  );

  // Confirm every candidate in one round trip. This is the difference between
  // "the sweep works" and "the sweep dies on an opaque instruction error" when
  // rent was already reclaimed by an earlier sweep.
  const verification = connection
    ? await verifyCloseTargets(connection, closePlans)
    : null;

  const plansByMint = new Map<string, ClosePlan>();
  closePlans.forEach((plan, index) => {
    if (plan.account && verification && !verification[index]?.exists) {
      plansByMint.set(plan.mint, {
        ...plan,
        account: null,
        reason: "its token account no longer exists — rescan and try again",
      });
      return;
    }
    plansByMint.set(plan.mint, plan);
  });

  // Indexed, because the verification read is keyed by the same position: the
  // per-account deposit is what the fee is priced from.
  for (const [index, build] of builds.entries()) {
    try {
      const setup = withoutComputeBudget(apiToInstructions(build.bundle.setup));
      const swap = apiToInstruction(build.bundle.swap);
      const cleanup = build.bundle.cleanup
        ? apiToInstruction(build.bundle.cleanup)
        : null;
      const other = withoutComputeBudget(apiToInstructions(build.bundle.other));

      // Rent reclaim: only ever close the account that really holds the
      // balance, and only when we could confirm it still exists.
      const plan = plansByMint.get(build.mint);
      const postSwap: TransactionInstruction[] = [];
      if (plan?.account && plan.program) {
        postSwap.push(
          createCloseAccountInstruction(plan.account, owner, plan.program),
        );

        // The rent-reclaim fee, taken from the rent that close is about to
        // return — so it sits immediately after the close and is always funded:
        // the close credits the whole deposit to `owner` first, and the fee is a
        // floor of 1.5% of it.
        //
        // Priced per account **from that account's own deposit**, which is the
        // figure `verifyCloseTargets` just read. A flat per-account figure used to
        // stand here, and it was wrong in both directions at once: an account
        // funded before the network's rent change holds more than a fresh one, and
        // a Token-2022 account with extensions is larger than 165 bytes — so the
        // rent we promised and the fee we took both understated what came back.
        //
        // Pricing per account rather than per transaction is deliberate too: the
        // packer decides how many swaps share a transaction, so a per-transaction
        // fee would silently scale with the grouping.
        //
        // A deposit we could not read earns no fee at all. A percentage of a guess
        // is worse than no charge, and it is what made the two disagree.
        const rentLamports = verification?.[index]?.lamports ?? 0;
        const accountFee =
          feeWallet && reclaimFeeBps > 0 && rentLamports > 0
            ? feeFromRentLamports(rentLamports, reclaimFeeBps)
            : 0;
        if (feeWallet && accountFee > 0) {
          postSwap.push(
            SystemProgram.transfer({
              fromPubkey: owner,
              toPubkey: new PublicKey(feeWallet),
              lamports: accountFee,
            }),
          );
        }
        if (rentLamports > 0) {
          rentByMint.set(build.mint, rentLamports);
          if (accountFee > 0) feeByMint.set(build.mint, accountFee);
        }
      } else if (plan?.reason) {
        warnings.push(`Rent reclaim skipped for ${build.symbol}: ${plan.reason}.`);
      }

      units.push({
        mint: build.mint,
        instructions: [
          ...setup,
          swap,
          ...postSwap,
          ...(cleanup ? [cleanup] : []),
          ...other,
        ],
        rentReclaim: postSwap.length > 0,
      });
    } catch (error) {
      errors.push({
        mint: build.mint,
        reason: error instanceof Error ? error.message : "Invalid instructions",
      });
    }
  }

  return { units, errors, warnings, rentByMint, feeByMint };
}

/**
 * Decide whether, and where, to reclaim rent for one swap.
 *
 * Three cases:
 *
 *  1. The scanner reported the account holding the balance and it **is** the
 *     canonical ATA. Close it — the overwhelmingly common case.
 *  2. The scanner reported the account and it is **not** the canonical ATA.
 *     Jupiter's swap only ever drains the ATA, so this account will still hold
 *     a balance and `closeAccount` would fail. Skip the reclaim and say why.
 *  3. No account was reported (older client, or DAS omitted it). Fall back to
 *     the derived ATA, which the caller verifies on-chain.
 */
function planClose(
  build: SwapBuild,
  owner: PublicKey,
  tokenPrograms: Map<string, "legacy" | "token2022">,
  skipCloseMints: Set<string>,
): ClosePlan {
  const skip: ClosePlan = {
    mint: build.mint,
    account: null,
    program: null,
    reason: null,
  };

  if (skipCloseMints.has(build.mint)) return skip;

  try {
    const mint = new PublicKey(build.mint);
    // The close must use the mint's *own* program. A Token-2022 account
    // cannot be closed by the legacy Token program.
    const program = tokenProgramFor(tokenPrograms.get(build.mint) ?? "legacy");
    const derived = getOwnerAta(owner, mint, program);

    const reported = build.tokenAccount;
    if (!reported) {
      return { mint: build.mint, account: derived, program, reason: null };
    }
    if (new PublicKey(reported).equals(derived)) {
      return { mint: build.mint, account: derived, program, reason: null };
    }

    // A non-canonical token account: the swap cannot drain it, so there is no
    // rent to reclaim and attempting it would break the whole transaction.
    return {
      mint: build.mint,
      account: null,
      program: null,
      reason: "it is held in a non-standard token account",
    };
  } catch {
    // Nothing usable could be derived — skip the reclaim, keep the swap.
    return skip;
  }
}

/**
 * The account a swap's own cleanup closes, when it closes one.
 *
 * A swap that outputs SOL wraps it: the setup creates the wallet's wrapped-SOL
 * account and the cleanup closes it again, so the lamports come back as plain
 * SOL. That close is built by Jupiter, not by us, and it is on an account no
 * *swap* names — the wrapped-SOL account is created and destroyed inside the
 * batch. Reading it back out of the bundle the composer is about to splice in is
 * what tells the audit the truth: the close is part of the plan, because the
 * plan is the thing that carries it.
 *
 * Only a token-program `CloseAccount` counts, and only when its refund goes to
 * the owner. Anything else is deliberately left undeclared: the audit refuses a
 * close that pays a third party on its own terms, and a close this function
 * cannot read must not be quietly excused.
 */
function cleanupCloseTarget(
  build: SwapBuild,
  owner: PublicKey,
): string | null {
  const cleanup = build.bundle.cleanup;
  if (!cleanup) return null;
  if (
    cleanup.programId !== TOKEN_PROGRAM_ID &&
    cleanup.programId !== TOKEN_2022_PROGRAM_ID
  ) {
    return null;
  }
  let data: Uint8Array;
  try {
    data = base64ToBytes(cleanup.data);
  } catch {
    return null;
  }
  // CloseAccount is instruction index 9 on both token programs.
  if (data.length !== 1 || data[0] !== 9) return null;
  const account = cleanup.accounts?.[0]?.pubkey;
  const refund = cleanup.accounts?.[1]?.pubkey;
  if (!account || refund !== owner.toBase58()) return null;
  return account;
}

/**
 * The accounts this batch will close for its rent, computed by the same code that
 * builds the closes.
 *
 * WHY THIS IS EXPORTED rather than reconstructed by the caller: two pieces of
 * code need to agree on which accounts get closed, and they disagreed. `planClose`
 * falls back to the **derived ATA** when the scanner could not name the account
 * holding a balance — but the audit's list of expected closes was built from
 * `build.tokenAccount` alone, so that fallback was missing from it. The composer
 * then closed the derived ATA, the audit had never been told about it, and it
 * warned *"The batch closes …, an account the plan did not name"* about a close
 * the app had decided on itself. A warning that fires on correct behaviour is
 * worse than no warning: it teaches the reader to ignore the panel.
 *
 * That same lesson repeats one level up. Our own `closeAccount` is not the only
 * close in a batch: a SOL-output swap's own cleanup closes the wallet's
 * wrapped-SOL account once **per swap**, an account no swap names. Undeclared,
 * that produced the identical warning four times over a four-token sweep — about
 * one account the plan had created itself. So the expectation is read from every
 * bundle the composer will splice, not only from the mint it came from.
 *
 * Deriving the answer from the builds the composer uses means it cannot drift
 * again — whatever the composer closes, the audit was told about.
 *
 * The converse is deliberately not promised: `verifyCloseTargets` may drop a
 * target that no longer exists, so the batch can close *fewer* than this. That is
 * the safe direction — the audit only ever complains about a close it was not
 * told about.
 */
export function plannedCloseAccounts(input: {
  owner: PublicKey;
  builds: SwapBuild[];
  skipCloseMints: Set<string>;
  tokenPrograms: Map<string, "legacy" | "token2022">;
}): string[] {
  const accounts = new Set<string>();
  for (const build of input.builds) {
    const close = planClose(
      build,
      input.owner,
      input.tokenPrograms,
      input.skipCloseMints,
    );
    if (close.account) accounts.add(close.account.toBase58());
    const cleanupClose = cleanupCloseTarget(build, input.owner);
    if (cleanupClose) accounts.add(cleanupClose);
  }
  return [...accounts];
}

/**
 * Does each candidate close target actually exist, and is it owned by the
 * mint's token program?
 *
 * Returns one boolean per plan (`true` where there is nothing to check). A
 * failed lookup degrades to "exists", so a flaky RPC never silently strips
 * rent reclaim from an otherwise working sweep.
 */
/** What a close target's own account says about itself. */
interface CloseTarget {
  exists: boolean;
  /**
   * The account's rent-exempt deposit, read from the account itself.
   *
   * Zero means "unknown", not "empty": a target whose deposit could not be read
   * earns no fee and is left out of the rent total, because a percentage of a
   * guess is how the panel came to disagree with the chain.
   */
  lamports: number;
}

async function verifyCloseTargets(
  connection: Connection,
  plans: ClosePlan[],
): Promise<CloseTarget[]> {
  const wanted = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.account !== null);
  if (wanted.length === 0) {
    return plans.map(() => ({ exists: true, lamports: 0 }));
  }

  const results: CloseTarget[] = plans.map(() => ({ exists: true, lamports: 0 }));
  try {
    const infos = await connection.getMultipleAccountsInfo(
      wanted.map(({ plan }) => plan.account as PublicKey),
    );
    wanted.forEach(({ plan, index }, infoIndex) => {
      const account = infos[infoIndex];
      if (!account) {
        results[index] = { exists: false, lamports: 0 };
        return;
      }
      // An account owned by anything other than its mint's token program is
      // not something `closeAccount` can act on.
      if (plan.program && !account.owner.equals(plan.program)) {
        results[index] = { exists: false, lamports: 0 };
        return;
      }
      results[index] = { exists: true, lamports: account.lamports };
    });
  } catch {
    return plans.map(() => ({ exists: true, lamports: 0 }));
  }
  return results;
}

/** Sum of every build's expected output, in output-token base units. */
export function totalOutputRaw(builds: SwapBuild[]): bigint {
  let total = 0n;
  for (const build of builds) {
    try {
      total += BigInt(build.outAmount);
    } catch {
      // Skip an unparseable quote rather than failing the whole total.
    }
  }
  return total;
}