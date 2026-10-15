import { PublicKey, type Connection, type ParsedAccountData } from "@solana/web3.js";
import { createRevokeInstruction } from "@solana/spl-token";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import {
  BASE_FEE_LAMPORTS,
  PRIORITY_FEE_MICRO_LAMPORTS,
  REVOKE_COMPUTE_UNIT_LIMIT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";
import { createComputeBudgetInstructions } from "@/lib/solana/instructions";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { pluralize } from "@/lib/utils/format";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { TokenProgramKind } from "@/types/token";

/**
 * Token approvals — who else is allowed to move your balance.
 *
 * An SPL token account carries an optional `delegate`: a third party permitted
 * to transfer (or burn) up to `delegatedAmount` from it, without your signature
 * ever again. Two everyday things create one:
 *
 *  - Listing an NFT. The marketplace is granted a delegate on the asset, which
 *    is how it can move the NFT when a buyer appears while the NFT never leaves
 *    your wallet.
 *  - "Approve" in any dApp, including the ones you would rather not have
 *    approved. This is the reason the feature exists: an approval does not
 *    expire, so a permission granted once to a site that later turns hostile is
 *    still live years afterwards.
 *
 * Revoking costs a signature and about 5,000 lamports, returns nothing, and can
 * break a listing that was still open — which is exactly why every row says what
 * it is for before anything is signed. Nothing here signs or sends.
 */

/**
 * A standing permission, read from the chain.
 *
 * Deliberately carries the *token account*, not just the mint: a delegate lives
 * on the account, so the revoke has to name that exact address and the program
 * that owns it.
 */
export interface TokenApproval {
  /** The token account whose delegate is set. The address to revoke against. */
  tokenAccount: string;
  mint: string;
  /** The address currently allowed to move the balance. */
  delegate: string;
  /** Base units the delegate may move, as reported by the account. */
  delegatedAmountRaw: string;
  /**
   * The allowance in whole units, for display.
   *
   * Meaningless when `unlimited` is true — `u64::MAX` divided by its decimals is
   * a large but arbitrary number — so the UI shows "all of it" instead.
   */
  delegatedAmount: number;
  /**
   * True when the allowance is `u64::MAX` — the whole balance, and anything
   * deposited later. That is what `approve` with an unlimited amount stores.
   */
  unlimited: boolean;
  /** The balance in the account right now, in base units. */
  balanceRaw: string;
  /** Balance in whole units, for display. */
  balance: number;
  decimals: number;
  /** Which token program owns the account. The revoke must name the same one. */
  program: TokenProgramKind;
  /** True when the token program reports the account as frozen. */
  frozen: boolean;
}

/** `u64::MAX`, which is how the token program spells "no limit". */
const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Is this allowance unlimited?
 *
 * An unlimited approval is the one worth shouting about: it covers the current
 * balance *and* everything that lands afterwards, so it does not quietly become
 * harmless once the balance is spent.
 */
export function isUnlimitedApproval(delegatedAmountRaw: string): boolean {
  try {
    return BigInt(delegatedAmountRaw) >= U64_MAX;
  } catch {
    // Unparseable is not unlimited. Reporting a bounded allowance as unlimited
    // would be a scare; the reverse would hide one, so this errs to the truth
    // of the number we were actually given.
    return false;
  }
}

/** The jsonParsed shape of a token account, as far as we rely on it. */
interface ParsedTokenAccountInfo {
  mint?: string;
  owner?: string;
  state?: string;
  delegate?: string;
  delegatedAmount?: { amount?: string } | null;
  tokenAmount?: { amount?: string; decimals?: number } | null;
}

/**
 * Turn one parsed token account into an approval, or `null` when there is
 * nothing to revoke.
 *
 * Returning `null` for "no delegate" is the common case and the whole point:
 * only accounts that actually hand power to someone else are listed.
 */
export function approvalFromParsedAccount(
  tokenAccount: string,
  data: ParsedAccountData | unknown,
  program: TokenProgramKind,
): TokenApproval | null {
  const parsed =
    data && typeof data === "object" && "parsed" in data
      ? ((data as ParsedAccountData).parsed as
          | { info?: ParsedTokenAccountInfo }
          | null)
      : null;
  const info = parsed?.info;
  if (!info) return null;

  const mint = info.mint;
  const delegate = info.delegate;
  if (typeof mint !== "string" || typeof delegate !== "string") return null;

  // A delegate that *is* the account's owner grants nothing: the owner could
  // already move the balance. Wallets that "approve" themselves are noise, and
  // listing them would pad a security report with things that are not risks.
  if (typeof info.owner === "string" && info.owner === delegate) return null;

  const delegatedAmountRaw = info.delegatedAmount?.amount ?? "0";
  const balanceRaw = info.tokenAmount?.amount ?? "0";
  const decimals = info.tokenAmount?.decimals ?? 0;

  return {
    tokenAccount,
    mint,
    delegate,
    delegatedAmountRaw,
    delegatedAmount: toWholeUnits(delegatedAmountRaw, decimals),
    unlimited: isUnlimitedApproval(delegatedAmountRaw),
    balanceRaw,
    balance: toWholeUnits(balanceRaw, decimals),
    decimals,
    program,
    frozen: info.state === "frozen",
  };
}

/**
 * Base units to whole units, guarded.
 *
 * A balance is display-only here, so an absurd or unparseable value degrades to
 * 0 rather than throwing a scan away.
 */
function toWholeUnits(rawAmount: string, decimals: number): number {
  try {
    const value = Number(BigInt(rawAmount)) / 10 ** decimals;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Every standing approval on this wallet.
 *
 * Both token programs are queried: a delegate on a Token-2022 account is exactly
 * as live as one on a legacy account, and revoking it needs the other program id.
 *
 * **Failures are not swallowed.** Everything else in this app degrades politely —
 * a missing price hides a row, a failed rent query falls back to a constant. A
 * security report cannot work that way: "no approvals found" and "we could not
 * look" are different answers, and only one of them is safe to show. So this
 * throws, and the UI says it could not check rather than silently reporting an
 * all-clear.
 */
export async function readTokenApprovals(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenApproval[]> {
  const programs: Array<[PublicKey, TokenProgramKind]> = [
    [new PublicKey(TOKEN_PROGRAM_ID), "legacy"],
    [new PublicKey(TOKEN_2022_PROGRAM_ID), "token2022"],
  ];

  const approvals: TokenApproval[] = [];

  for (const [programId, kind] of programs) {
    const response = await connection.getParsedTokenAccountsByOwner(owner, {
      programId,
    });

    for (const { pubkey, account } of response.value) {
      const approval = approvalFromParsedAccount(
        pubkey.toBase58(),
        account.data,
        kind,
      );
      if (approval) approvals.push(approval);
    }
  }

  // Unlimited approvals first, then the biggest balances. The one that matters
  // most should never be below the fold on a wallet with fifty bounded grants.
  approvals.sort((a, b) => {
    if (a.unlimited !== b.unlimited) return a.unlimited ? -1 : 1;
    return b.balance - a.balance;
  });

  return approvals;
}

/**
 * Split approvals into the ones we can revoke and the ones we cannot.
 *
 * Frozen accounts are the case that matters, and it was found by simulating a
 * real revoke on mainnet rather than in the docs: the token program rejects
 * `Revoke` on a frozen account with `Custom: 17` — *"Account is frozen"*. The
 * delegate is still assigned, and it stays live for whenever the mint's freeze
 * authority thaws the account, but nothing can clear it in the meantime. Offering
 * it would build a transaction that cannot succeed, which is precisely the raw
 * `{"InstructionError":[1,{"Custom":17}]}` feedback this codebase keeps having to
 * eliminate.
 *
 * Frozen rows are kept rather than hidden: a live permission is exactly what this
 * screen exists to surface, even when it cannot be acted on yet.
 */
export function revocableApprovals(approvals: TokenApproval[]): {
  revocable: TokenApproval[];
  frozen: TokenApproval[];
} {
  const revocable: TokenApproval[] = [];
  const frozen: TokenApproval[] = [];

  for (const approval of approvals) {
    if (approval.frozen) frozen.push(approval);
    else revocable.push(approval);
  }

  return { revocable, frozen };
}

export interface PlanRevokeInput {
  connection: Connection;
  owner: PublicKey;
  approvals: TokenApproval[];
}

export interface PlanRevokeResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Base fee plus priority fee for every transaction this plan will send. */
  estimatedFeeLamports: number;
  /** Accounts whose delegate a successful run clears. */
  revokeCount: number;
  /** True when at least one packed transaction failed to simulate. */
  hasFailures: boolean;
}

/** A planning failure, with the warnings gathered along the way. */
export class RevokeError extends Error {
  override readonly name = "RevokeError";
  constructor(
    message: string,
    readonly hint?: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Build and simulate the revokes.
 *
 * Same pipeline as every other flow here — local instruction building, the shared
 * byte-exact packer, simulate-before-sign — so a delegate that has already gone,
 * or an account the mint has frozen, is discovered before the user approves
 * anything.
 *
 * Units are labelled by *token account*, not by mint: a revoke is addressed to an
 * account, and one wallet can hold two accounts for the same mint with different
 * delegates.
 */
export async function planRevokes(
  input: PlanRevokeInput,
): Promise<PlanRevokeResult> {
  const { connection, owner, approvals } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];

  // Frozen accounts are dropped before anything is built. The token program
  // refuses to revoke them (verified on mainnet: `Custom: 17`, "Account is
  // frozen"), so including one would guarantee a transaction that fails. The
  // delegate is still live, and the warning says so.
  const { revocable, frozen } = revocableApprovals(approvals);
  if (frozen.length > 0) {
    warnings.push(
      `${pluralize(frozen.length, "frozen account")} left out: the token program refuses to revoke while an account is frozen, so the delegate stays until the mint's freeze authority thaws it.`,
    );
  }

  for (const approval of revocable) {
    try {
      const account = new PublicKey(approval.tokenAccount);
      const tokenProgram = new PublicKey(
        approval.program === "token2022"
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID,
      );

      units.push({
        mint: approval.tokenAccount,
        instructions: [createRevokeInstruction(account, owner, [], tokenProgram)],
        // A revoke moves no lamports: no account closes, nothing is emptied.
        // Saying so keeps the simulation report honest.
        rentReclaim: false,
      });
    } catch (error) {
      warnings.push(
        `Skipped ${approval.tokenAccount.slice(0, 6)}…: ${
          error instanceof Error ? error.message : "could not build a revoke."
        }`,
      );
    }
  }

  if (units.length === 0) {
    throw new RevokeError(
      "None of the selected approvals could be prepared.",
      "Rescan and try again.",
      warnings,
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const prologue = createComputeBudgetInstructions(
    REVOKE_COMPUTE_UNIT_LIMIT,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    // A revoke references only the token account and its owner, so there is
    // nothing an address lookup table could shrink.
    lookupTables: [],
  });

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Skipped ${dropped.mint.slice(0, 6)}…: ${dropped.reason}`,
    ),
  );

  if (packedResult.transactions.length === 0) {
    throw new RevokeError(
      "The selected approvals are too large to send at once.",
      "Try revoking fewer at a time.",
      warnings,
    );
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // A revoke carries no value and moves no lamports, so the check is small: the
  // only token instruction allowed is a revoke, authorised by the wallet, on an
  // account the user selected — and no SOL may move at all.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "approvals",
      owner: owner.toBase58(),
      feeWallet: null,
      expectedFeeLamports: 0,
      expectedSubjects: packedResult.transactions.flatMap((tx) => tx.mints),
    },
  });

  const simulations = await simulateAll(connection, packedResult.transactions);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new RevokeError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (REVOKE_COMPUTE_UNIT_LIMIT * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports:
      packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee),
    revokeCount: packedResult.transactions.flatMap((tx) => tx.mints).length,
    hasFailures: simulations.some((simulation) => !simulation.ok),
  };
}
