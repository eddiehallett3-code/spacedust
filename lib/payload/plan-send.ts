import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  MAX_COMPUTE_UNIT_LIMIT,
  PAYLOAD_FEE_BPS,
  PRIORITY_FEE_MICRO_LAMPORTS,
  SEND_COMPUTE_UNITS_PER_UNIT,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import { parseBaseAmount } from "@/lib/utils/sanitize";
import {
  createComputeBudgetInstructions,
  tokenProgramFor,
} from "@/lib/solana/instructions";
import { feeFromRentLamports, fetchRentMinimums } from "@/lib/solana/rent";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import {
  buildSend,
  recipientTokenAccount,
  sendEmptiesAccount,
} from "@/lib/solana/transfer";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { DustToken, NonFungibleAsset } from "@/types/token";

/**
 * Payload's planning pipeline.
 *
 * A batch send is N independent "send one thing" units packed into as few
 * transactions as the 1232-byte limit allows. Everything here is measured rather
 * than assumed — `probes/tmp-payload-transfer-probe.mjs` simulated the real instruction
 * runs against real mainnet accounts:
 *
 *   create the recipient's account → transfer → close the source
 *
 * is **394 bytes and 15,243 CU** and simulates clean; **~11 distinct
 * destinations** fit in one transaction; a mixed batch of one NFT plus six token
 * sends is **694 bytes**.
 *
 * Three rules the probe settled, and each one decides what this file refuses
 * rather than what it attempts:
 *
 *  - a transfer with no account create **fails** at the destination
 *    (`InvalidAccountData`), so the create is planned from a real read;
 *  - a send to the owner's own wallet **fails** on the close (`Custom: 11`,
 *    NonNativeHasBalance) — the balance never leaves the account, so there is
 *    nothing to close and no rent to reclaim;
 *  - rent is read **per account**, never from a constant. The account measured in
 *    the probe held 1,488,440 lamports where the constant says 2,039,280 — a 37%
 *    overstatement that would otherwise have been shown to the user as money
 *    coming back, and a fee charged on it.
 *
 * Nothing here signs or sends anything.
 */

export interface PlanSendInput {
  connection: Connection;
  owner: PublicKey;
  /** Where the batch is going. Must differ from `owner`. */
  recipient: PublicKey;
  /** Fungible holdings, each sent in full. */
  tokens: readonly DustToken[];
  /** Uncompressed NFTs. Anything else is refused, with the reason on the row. */
  assets: readonly NonFungibleAsset[];
  /**
   * The address that was verified, when the user asked for verification.
   *
   * A plan is built against one specific string, so this is checked before
   * anything is read: verifying one address and sending to another is the exact
   * failure the feature exists to prevent, and it is not a warning to display
   * beside a send that happens anyway.
   */
  verifiedAddress?: string | null;
  /** Whether verification was switched on for this batch. */
  requireVerification?: boolean;
}

/** One item in the batch, and what will happen to it. */
export interface SendOutcome {
  /** Mint for a token, or the asset id: the same string the row is keyed by. */
  mint: string;
  kind: "token" | "nft";
  /** What the row is labelled with. */
  label: string;
  /** False when this item was refused. */
  sending: boolean;
  /** Why it will not be sent. Never blank when `sending` is false. */
  refused: string | null;
  /** Base units being sent. */
  amount: bigint;
  decimals: number;
  /** True when the send empties the account, so the close and its rent are in. */
  reclaimsRent: boolean;
  /** The source account's own rent, read from the chain. */
  rentLamports: number;
  /** True when the recipient needs an account created, at the sender's cost. */
  createsRecipientAccount: boolean;
  /** What that create is expected to cost, priced from the chain. */
  recipientAccountRentLamports: number;
  /**
   * Payload's fee on this item's rent, priced when the transfer was built.
   *
   * Present so nothing downstream recomputes it from a constant: the rate and the
   * rent it applies to have to stay the pair they were priced as, which is how a
   * hardcoded rent once made The Void charge 2.06% while promising 1.5%.
   */
  feeLamports: number;
}

export interface PlanSendResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Base fee plus priority fee for every transaction this plan will send. */
  estimatedFeeLamports: number;
  /** Every item asked for, including the refused ones. */
  outcomes: SendOutcome[];
  /** Rent the sends are expected to free, before the fee. */
  estimatedRentLamports: number;
  /** Payload's fee, taken from that rent. */
  estimatedFeeOnRentLamports: number;
  /** Rent the sender pays to create the recipient's accounts. */
  estimatedRecipientAccountLamports: number;
  /**
   * Gross rent, minus the fee, minus what the sender pays at the destination.
   *
   * Negative is a real outcome, and the reason this number exists: sending a
   * token to a wallet that has never held it costs that wallet's rent-exempt
   * deposit, which is more than most dust is worth.
   */
  estimatedNetLamports: number;
  /** True when the batch frees less than it costs. The UI has to say so. */
  netIsNegative: boolean;
  /** True when at least one packed transaction failed to simulate. */
  hasFailures: boolean;
}

/** A planning failure with a user-facing message and recovery hint. */
export class SendError extends Error {
  override readonly name = "SendError";
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/**
 * The compute budget for one send transaction.
 *
 * Sized from the unit count rather than from a round number, because the
 * priority fee is billed on the budget that is *requested*: asking for the
 * sweep's 800,000 CU for a batch that measures 15,243 CU per unit would overpay
 * by a factor of several on an action whose only return is rent.
 *
 * Rounded up to the next 10,000 so the figure reads as a budget rather than a
 * measurement, floored at 50,000 for a single unit, and capped at Solana's own
 * ceiling.
 */
export function computeBudgetForUnits(units: number): number {
  const measured = Math.max(units, 1) * SEND_COMPUTE_UNITS_PER_UNIT;
  const rounded = Math.ceil(measured / 10_000) * 10_000;
  return Math.min(Math.max(rounded, 50_000), MAX_COMPUTE_UNIT_LIMIT);
}

/**
 * Why an asset cannot be sent yet.
 *
 * Kept as one function so the reasons are written once. Two of the three are
 * temporary — the routes for them are planned — and the copy says so rather than
 * implying the asset itself is a problem.
 */
export function unsendableAssetReason(asset: NonFungibleAsset): string | null {
  if (asset.compressed) {
    return "Compressed NFTs cannot be sent yet. The Bubblegum transfer route is not built.";
  }
  if (asset.frozen) {
    return "This asset is frozen. Only the mint's freeze authority can thaw it, so it cannot be moved.";
  }
  if (asset.tokenAccount === null) {
    return "The scan could not find the token account holding this asset, and a derived address is never substituted for one we failed to name.";
  }
  if (asset.interface === "ProgrammableNFT" || asset.interface === "V1_PRINT") {
    return "Programmable NFTs need Token Metadata's transfer instruction, which is not built yet.";
  }
  if (asset.interface !== "V1_NFT" && asset.interface !== "LEGACY_NFT") {
    return `Sending a ${asset.interface} is not supported.`;
  }
  return null;
}

/**
 * Read the accounts this plan depends on, batched.
 *
 * One call answers three questions per address: does it exist, what does it hold,
 * and is it frozen. `getMultipleParsedAccounts` rather than `getMultipleAccounts`
 * so the state arrives as the word "frozen" instead of a byte that would have to
 * be indexed out of a layout by hand.
 *
 * A failed batch is *unknown*, not frozen: the simulation stays the judge, and
 * refusing something that is actually fine is the worse mistake of the two.
 */
async function readAccounts(
  connection: Connection,
  addresses: PublicKey[],
): Promise<
  Map<string, { lamports: number; frozen: boolean; amount: bigint } | null>
> {
  const unique = [...new Set(addresses.map((address) => address.toBase58()))];
  const found = new Map<
    string,
    { lamports: number; frozen: boolean; amount: bigint } | null
  >();

  for (let start = 0; start < unique.length; start += 100) {
    const batch = unique.slice(start, start + 100);
    try {
      const response = await connection.getMultipleParsedAccounts(
        batch.map((address) => new PublicKey(address)),
      );
      response.value.forEach((info, index) => {
        const key = batch[index]!;
        if (!info) {
          found.set(key, null);
          return;
        }
        const data = info.data;
        const parsed =
          data && typeof data === "object" && "parsed" in data
            ? (data as { parsed?: { info?: Record<string, unknown> } }).parsed
            : null;
        const amountRaw = (
          parsed?.info?.tokenAmount as { amount?: unknown } | undefined
        )?.amount;
        found.set(key, {
          lamports: info.lamports,
          frozen: parsed?.info?.state === "frozen",
          amount: typeof amountRaw === "string" ? BigInt(amountRaw) : 0n,
        });
      });
    } catch {
      // Unknown rather than frozen — see above. These addresses stay unset, and
      // every caller treats an unset answer as "could not tell".
    }
  }

  return found;
}

/**
 * Plan a batch send.
 *
 * Everything is read before anything is decided: which of the recipient's
 * accounts already exist, what the source accounts hold, and whether either side
 * is frozen. Each refusal is derived from something read, never assumed — the
 * scan's own view of account state is not trusted, because the two scanners this
 * app can run against disagree about it and a frozen account cannot be sent from.
 */
export async function planSend(input: PlanSendInput): Promise<PlanSendResult> {
  const { connection, owner, recipient, tokens, assets } = input;
  const warnings: string[] = [];
  const outcomes: SendOutcome[] = [];

  // ── 0. The destination gate ─────────────────────────────────────────────
  const ownerAddress = owner.toBase58();
  const recipientAddress = recipient.toBase58();

  if (recipientAddress === ownerAddress) {
    throw new SendError(
      "A batch cannot be sent to the address sending it.",
      "A self-send leaves the balance in the same account, so nothing moves — and the close that would reclaim the rent is refused on chain.",
    );
  }

  if (input.requireVerification) {
    if (!input.verifiedAddress) {
      throw new SendError(
        "This destination has not been verified.",
        "Send the test transfer, confirm it arrived, and the batch will be built against that address.",
      );
    }
    if (input.verifiedAddress !== recipientAddress) {
      throw new SendError(
        "The destination changed after it was verified.",
        `The verified address was ${input.verifiedAddress}. Verify ${recipientAddress} in its own right before sending.`,
      );
    }
  }

  if (tokens.length === 0 && assets.length === 0) {
    throw new SendError(
      "Nothing is selected.",
      "Choose at least one token or NFT to send.",
    );
  }

  // ── 1. What is being sent, and what is refused before any read ──────────
  interface Candidate {
    kind: "token" | "nft";
    mint: string;
    label: string;
    decimals: number;
    amount: bigint;
    source: PublicKey | null;
    tokenProgram: PublicKey;
    /** Set when this item will not be sent, so nothing further is read for it. */
    refused: string | null;
    /**
     * False when the account must not be closed after sending.
     *
     * A Token-2022 transfer fee leaves a residue behind even after a full send,
     * so the account is never empty and a close would be refused — the same rule
     * the sweep already applies to rent reclaim.
     */
    closeable: boolean;
  }

  const candidates: Candidate[] = [];

  for (const token of tokens) {
    const tokenProgram = tokenProgramFor(token.program);
    let refused: string | null = null;
    let amount = 0n;

    const parsed = parseBaseAmount(token.rawAmount);
    if (parsed === null) {
      refused =
        "This balance could not be read as an amount, so it was left out.";
    } else {
      amount = parsed;
    }

    if (refused === null && token.frozen) {
      refused =
        "Frozen by the mint's freeze authority. A frozen account cannot be transferred from, so this cannot be sent.";
    }
    if (refused === null && token.hasTransferHook) {
      refused =
        "This mint has a transfer hook, which runs arbitrary code on every transfer. Spacedust does not sign instructions whose effects it cannot see.";
    }
    if (refused === null && amount === 0n) {
      refused = "There is no balance to send.";
    }
    if (refused === null && token.tokenAccount === null) {
      refused =
        "The scan could not name the account holding this balance, and a derived address is never substituted for one we failed to name.";
    }

    let source: PublicKey | null = null;
    if (refused === null && token.tokenAccount) {
      try {
        source = new PublicKey(token.tokenAccount);
      } catch {
        refused = "The account holding this balance is not a valid address.";
      }
    }

    if (refused === null && token.hasTransferFee) {
      warnings.push(
        `${token.symbol || token.mint.slice(0, 4)} charges a transfer fee, so the recipient receives less than the balance shown — and its account cannot be closed, because the fee leaves a residue behind.`,
      );
    }

    candidates.push({
      kind: "token",
      mint: token.mint,
      label: token.symbol || token.name || token.mint.slice(0, 4),
      decimals: token.decimals,
      amount,
      source,
      tokenProgram,
      refused,
      closeable: !token.hasTransferFee,
    });
  }

  for (const asset of assets) {
    let refused = unsendableAssetReason(asset);
    let source: PublicKey | null = null;

    if (refused === null && asset.tokenAccount) {
      try {
        source = new PublicKey(asset.tokenAccount);
      } catch {
        refused = "The account holding this asset is not a valid address.";
      }
    }

    candidates.push({
      kind: "nft",
      mint: asset.id,
      label: asset.name || asset.id.slice(0, 6),
      decimals: 0,
      // One indivisible unit, which is what makes an NFT's send empty its
      // account and free that account's rent.
      amount: 1n,
      source,
      tokenProgram: tokenProgramFor(asset.program),
      refused,
      closeable: true,
    });
  }

  // ── 2. The fee wallet, and whether it can receive ───────────────────────
  // A fee is only charged once a close has returned rent to pay it from, and only
  // when the wallet collecting it is *funded*: Solana refuses to create an account
  // below the rent-exempt minimum, so sending a few thousand lamports to a fresh
  // address fails the whole transaction with `InsufficientFundsForRent` rather
  // than creating anything. Verified once for The Void; the trap is identical here.
  const rent = await fetchRentMinimums(connection);
  const feeWallet = getPublicFeeWallet();
  let feeEnabled = false;

  if (feeWallet) {
    try {
      const info = await connection.getAccountInfo(new PublicKey(feeWallet));
      feeEnabled = (info?.lamports ?? 0) >= rent.emptyAccount;
    } catch {
      feeEnabled = false;
    }
    if (!feeEnabled) {
      warnings.push(
        "No Payload fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it.",
      );
    }
  }

  // ── 3. Read both sides, then decide from what was read ──────────────────
  //
  // Every item needs two addresses looked at: the account the asset is in, and the
  // account it is going to. The destination is derived per mint — one recipient
  // needs an account per mint they do not already hold — and each of those that
  // has to be created costs the *sender* a rent deposit.
  const planned = candidates.map((candidate) => ({
    candidate,
    destination:
      candidate.refused !== null
        ? null
        : recipientTokenAccount(
            recipient,
            new PublicKey(candidate.mint),
            candidate.tokenProgram,
          ),
  }));

  const read = await readAccounts(connection, [
    ...planned.flatMap((entry) =>
      entry.candidate.source ? [entry.candidate.source] : [],
    ),
    ...planned.flatMap((entry) => (entry.destination ? [entry.destination] : [])),
  ]);

  const units: PackUnit[] = [];
  let grossRentLamports = 0;
  let feeLamports = 0;
  let recipientAccountLamports = 0;

  for (const { candidate, destination } of planned) {
    const base: SendOutcome = {
      mint: candidate.mint,
      kind: candidate.kind,
      label: candidate.label,
      sending: false,
      refused: candidate.refused,
      amount: candidate.amount,
      decimals: candidate.decimals,
      reclaimsRent: false,
      rentLamports: 0,
      createsRecipientAccount: false,
      recipientAccountRentLamports: 0,
      feeLamports: 0,
    };

    if (candidate.source === null || destination === null) {
      outcomes.push(base);
      continue;
    }

    const source = read.get(candidate.source.toBase58()) ?? null;
    const atDestination = read.get(destination.toBase58()) ?? null;

    if (source === null) {
      outcomes.push({
        ...base,
        refused:
          "The account holding this no longer exists on chain. Rescan the wallet and try again.",
      });
      continue;
    }

    // Asked of the chain rather than taken from the scan: the free-RPC and DAS
    // scanners disagree about account state, and a frozen account cannot be
    // transferred from.
    if (source.frozen) {
      outcomes.push({
        ...base,
        refused:
          "This account is frozen on chain right now. Only the mint's freeze authority can thaw it.",
      });
      continue;
    }

    if (atDestination?.frozen) {
      outcomes.push({
        ...base,
        refused:
          "The recipient already has an account for this mint, and it is frozen. Only the mint's freeze authority can thaw it.",
      });
      continue;
    }

    // The account's own balance decides whether this send empties it, and only an
    // emptied account may be closed — a close on a non-empty one is refused with
    // `Custom: 11`. The scan's figure is not used for this: it can be stale, and a
    // partial send means the rent stays locked.
    const empties = sendEmptiesAccount(candidate.amount, source.amount);
    const closeSource = candidate.closeable && empties;
    if (!empties) {
      warnings.push(
        `${candidate.label} is no longer the full balance of its account, so the account stays open and its rent is not reclaimed.`,
      );
    }

    const createsRecipientAccount = atDestination === null;
    // Priced from the source account, which holds the same mint and so the same
    // extensions as the destination will, so its own balance is the right
    // estimate. A 165-byte constant would understate every Token-2022 account
    // with extensions; the 2,039,280 constant overstates most legacy ones.
    const recipientAccountRentLamports = createsRecipientAccount
      ? source.lamports
      : 0;

    const instructions = buildSend({
      owner,
      mint: new PublicKey(candidate.mint),
      source: candidate.source,
      recipient,
      amount: candidate.amount,
      decimals: candidate.decimals,
      tokenProgram: candidate.tokenProgram,
      createRecipientAccount: createsRecipientAccount,
      closeSource,
    });

    // ── The fee on the rent this send just freed ──────────────────────────
    // Priced per account rather than per transaction: the packer decides how many
    // units share a transaction, so a per-transaction fee would silently scale
    // with the grouping. It sits after the close, so it is always funded — the
    // close credits the full rent to `owner` first, and the fee is a floor of
    // 1.5% of that rent. No close means no rent, and therefore no fee.
    const accountFee = closeSource
      ? feeFromRentLamports(source.lamports, PAYLOAD_FEE_BPS)
      : 0;

    if (feeEnabled && feeWallet && accountFee > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: new PublicKey(feeWallet),
          lamports: accountFee,
        }),
      );
    }

    units.push({
      mint: candidate.mint,
      instructions,
      rentReclaim: closeSource,
    });

    if (closeSource) {
      grossRentLamports += source.lamports;
      feeLamports += accountFee;
    }
    recipientAccountLamports += recipientAccountRentLamports;

    outcomes.push({
      ...base,
      sending: true,
      reclaimsRent: closeSource,
      rentLamports: source.lamports,
      createsRecipientAccount,
      recipientAccountRentLamports,
      feeLamports: accountFee,
    });
  }

  if (units.length === 0) {
    throw new SendError(
      "None of the selected items can be sent to this address.",
      outcomes.find((outcome) => outcome.refused)?.refused ?? undefined,
    );
  }

  // ── 4. Pack into as few transactions as the 1232-byte limit allows ───────
  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const computeUnitLimit = computeBudgetForUnits(units.length);
  const prologue = createComputeBudgetInstructions(
    computeUnitLimit,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    // Sends need no address lookup tables: every account is local to the asset
    // being sent, unlike a swap that reaches across routing accounts.
    lookupTables: [],
  });

  // An item the packer could not fit would otherwise still read as "sending" on
  // its row, so it becomes an explicit refusal carrying the packer's own reason —
  // and its rent, its fee and its recipient-account cost all come back out of the
  // totals, because none of them are happening now.
  for (const dropped of packedResult.dropped) {
    const outcome = outcomes.find((entry) => entry.mint === dropped.mint);
    if (!outcome) continue;

    outcome.sending = false;
    outcome.refused = `It did not fit in a transaction: ${dropped.reason}`;

    if (outcome.reclaimsRent) {
      grossRentLamports -= outcome.rentLamports;
      feeLamports -= outcome.feeLamports;
      outcome.reclaimsRent = false;
      outcome.feeLamports = 0;
    }
    recipientAccountLamports -= outcome.recipientAccountRentLamports;
    outcome.createsRecipientAccount = false;
    outcome.recipientAccountRentLamports = 0;
  }

  if (packedResult.transactions.length === 0) {
    throw new SendError(
      "The selected items are too large to send together.",
      "Try sending fewer at a time.",
    );
  }

  // ── The audit: what is about to be signed ────────────────────────────────
  // A send is the flow where a wrong address costs the user the asset, so the
  // check is narrow on purpose: every transfer must be authorised by the wallet,
  // every transfer must land in the destination the user set, any account
  // created must belong to that destination, and the only SOL that may leave is
  // the fee, as computed.
  const packedForAudit = new Set(
    packedResult.transactions.flatMap((tx) => tx.mints),
  );
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "payload",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: feeLamports,
      expectedTransferDestinations: candidates
        .filter(
          (candidate) =>
            packedForAudit.has(candidate.mint) && candidate.source !== null,
        )
        .map((candidate) =>
          recipientTokenAccount(
            recipient,
            new PublicKey(candidate.mint),
            candidate.tokenProgram,
          ).toBase58(),
        ),
      allowedAtaOwners: [recipient.toBase58()],
      expectedCloses: candidates
        .filter(
          (candidate) =>
            packedForAudit.has(candidate.mint) && candidate.closeable,
        )
        .flatMap((candidate) =>
          candidate.source ? [candidate.source.toBase58()] : [],
        ),
    },
  });

  // ── 5. Simulate everything before asking for a signature ────────────────
  // The safety gate: a frozen account, a missing destination account, a stale
  // balance — all of it surfaces here, before anything is signed.
  const simulations = await simulateAll(connection, packedResult.transactions);
  const hasFailures = simulations.some((simulation) => !simulation.ok);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new SendError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
    );
  }

  // ── 6. The money ────────────────────────────────────────────────────────
  const priorityFee = Math.ceil(
    (computeUnitLimit * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );
  const estimatedFeeLamports =
    packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee);

  // What the user actually gains: the rent freed, less the fee on it, less what
  // they pay to give the recipient an account to receive into. Negative is a real
  // answer — it is the normal one for dust going to a wallet that has never held
  // that mint — and the UI is expected to say so rather than let it be discovered.
  const estimatedNetLamports =
    grossRentLamports - feeLamports - recipientAccountLamports;

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports,
    outcomes,
    estimatedRentLamports: grossRentLamports,
    estimatedFeeOnRentLamports: feeLamports,
    estimatedRecipientAccountLamports: recipientAccountLamports,
    estimatedNetLamports,
    netIsNegative: estimatedNetLamports < 0,
    hasFailures,
  };
}

