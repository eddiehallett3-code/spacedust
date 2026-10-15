import {
  PublicKey,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  apiToInstruction,
  apiToInstructions,
  createCloseAccountInstruction,
  getOwnerAta,
  tokenProgramFor,
} from "./instructions";
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
}

export interface ComposeUnitResult {
  units: PackUnit[];
  /** Routes that could not be composed at all; their swaps are dropped. */
  errors: Array<{ mint: string; reason: string }>;
  /** Non-fatal notes (for example: rent reclaim skipped). Swaps still run. */
  warnings: string[];
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
}: ComposeUnitInput): Promise<ComposeUnitResult> {
  const units: PackUnit[] = [];
  const errors: Array<{ mint: string; reason: string }> = [];
  const warnings: string[] = [];

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
    if (plan.account && verification && !verification[index]) {
      plansByMint.set(plan.mint, {
        ...plan,
        account: null,
        reason: "its token account no longer exists — rescan and try again",
      });
      return;
    }
    plansByMint.set(plan.mint, plan);
  });

  for (const build of builds) {
    try {
      const setup = apiToInstructions(build.bundle.setup);
      const swap = apiToInstruction(build.bundle.swap);
      const cleanup = build.bundle.cleanup
        ? apiToInstruction(build.bundle.cleanup)
        : null;
      const other = apiToInstructions(build.bundle.other);

      // Rent reclaim: only ever close the account that really holds the
      // balance, and only when we could confirm it still exists.
      const plan = plansByMint.get(build.mint);
      const closeInstructions: TransactionInstruction[] = [];
      if (plan?.account && plan.program) {
        closeInstructions.push(
          createCloseAccountInstruction(plan.account, owner, plan.program),
        );
      } else if (plan?.reason) {
        warnings.push(`Rent reclaim skipped for ${build.symbol}: ${plan.reason}.`);
      }

      units.push({
        mint: build.mint,
        instructions: [
          ...setup,
          swap,
          ...closeInstructions,
          ...(cleanup ? [cleanup] : []),
          ...other,
        ],
        rentReclaim: closeInstructions.length > 0,
      });
    } catch (error) {
      errors.push({
        mint: build.mint,
        reason: error instanceof Error ? error.message : "Invalid instructions",
      });
    }
  }

  return { units, errors, warnings };
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
 * The accounts this batch will close for its rent, computed by the same function
 * that builds the closes.
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
 * Deriving the expectation from `planClose` means the answer cannot drift again —
 * whatever the composer closes, the audit was told about.
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
  return input.builds
    .map(
      (build) =>
        planClose(build, input.owner, input.tokenPrograms, input.skipCloseMints)
          .account,
    )
    .filter((account): account is PublicKey => account !== null)
    .map((account) => account.toBase58());
}

/**
 * Does each candidate close target actually exist, and is it owned by the
 * mint's token program?
 *
 * Returns one boolean per plan (`true` where there is nothing to check). A
 * failed lookup degrades to "exists", so a flaky RPC never silently strips
 * rent reclaim from an otherwise working sweep.
 */
async function verifyCloseTargets(
  connection: Connection,
  plans: ClosePlan[],
): Promise<boolean[]> {
  const wanted = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.account !== null);
  if (wanted.length === 0) return plans.map(() => true);

  const results = plans.map(() => true);
  try {
    const infos = await connection.getMultipleAccountsInfo(
      wanted.map(({ plan }) => plan.account as PublicKey),
    );
    wanted.forEach(({ plan, index }, infoIndex) => {
      const account = infos[infoIndex];
      if (!account) {
        results[index] = false;
        return;
      }
      // An account owned by anything other than its mint's token program is
      // not something `closeAccount` can act on.
      if (plan.program && !account.owner.equals(plan.program)) {
        results[index] = false;
      }
    });
  } catch {
    return plans.map(() => true);
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