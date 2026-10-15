import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  BASE_FEE_LAMPORTS,
  DELETE_COMPUTE_UNIT_FLOOR,
  DELETE_COMPUTE_UNITS_PER_UNIT,
  MAX_COMPUTE_UNIT_LIMIT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  RECLAIM_FEE_BPS,
} from "@/lib/utils/constants";
import { getPublicFeeWallet } from "@/lib/config/public-env";
import {
  apiToInstruction,
  createComputeBudgetInstructions,
} from "@/lib/solana/instructions";
import { feeFromRentLamports, fetchRentMinimums } from "@/lib/solana/rent";
import { packTransactions, type PackUnit } from "@/lib/solana/pack";
import { simulateAll } from "@/lib/solana/simulate";
import { auditPlanBeforeSigning } from "@/lib/security/audit-plan";
import type { ApiInstruction } from "@/types/jupiter";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";
import type { SalvageDomain } from "@/types/salvage";

/**
 * Deleting `.sol` domains, and reclaiming the rent their name accounts hold.
 *
 * The shape of this file is deliberately the same as the empty-account closes —
 * build units, pack them, simulate everything, then price the money — with two
 * differences that matter:
 *
 *  - **The instruction is not built here.** It comes from `POST /api/domains`,
 *    because it belongs to the SNS program and this app does not hand-encode
 *    another program's instructions. It arrives in the shape Jupiter's arrive in,
 *    so `apiToInstruction` validates it before anything can be signed.
 *  - **A delete is not a close.** It does not tidy up an idle account; it gives the
 *    name back to the open namespace, destroys its records and subdomains with it,
 *    and cannot be undone. SNS says as much in their own documentation, and every
 *    refusal below exists so that nothing is offered as routine that isn't.
 *
 * The measured unit, from `probes/tmp-sol-rent-probe.mjs` against a real mainnet name
 * account: **207 bytes, 1,801 CU, `err: null`**, refunding that account's own rent —
 * which is between 1,559,040 and 71,159,040 lamports depending on how long the
 * name is, so it is read per domain and never from a constant.
 *
 * Nothing here signs or sends.
 */

export interface PlanDeleteInput {
  connection: Connection;
  owner: PublicKey;
  /** The domains the user ticked, exactly as `/api/domains` reported them. */
  domains: readonly SalvageDomain[];
  /**
   * The server-built delete instructions, index-aligned with `domains`.
   *
   * A missing entry is a refusal, not a silent skip: a domain the user ticked must
   * either be deleted or say why it was not.
   */
  instructions: readonly ApiInstruction[];
}

export interface PlanDeleteResult {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  warnings: string[];
  blockhash: string;
  lastValidBlockHeight: number;
  /** Base fee plus priority fee for every transaction this plan will send. */
  estimatedFeeLamports: number;
  /** The budget those transactions ask for, sized from the unit count. */
  computeUnitLimit: number;
  /** Domains a successful run deletes. */
  deleteCount: number;
  /** Rent those deletes return, before the fee. */
  rentLamports: number;
  /** The Spacedust fee on that rent. */
  reclaimFeeLamports: number;
  /** Rent minus the fee: what actually lands in the wallet. */
  netRentLamports: number;
  /** True when at least one packed transaction failed to simulate. */
  hasFailures: boolean;
}

/** A planning failure, with the warnings gathered along the way. */
export class DeleteError extends Error {
  override readonly name = "DeleteError";

  constructor(
    message: string,
    readonly hint: string,
    readonly warnings: string[] = [],
  ) {
    super(message);
  }
}

/**
 * The compute budget for a batch of deletes.
 *
 * Sized from the unit count, like Payload's, rather than from a round number: the
 * priority fee is billed on the budget that is *requested*, so a delete — which
 * measures 1,801 CU — has no business asking for the sweep's 800,000.
 */
export function deleteComputeBudget(units: number): number {
  const measured = Math.max(units, 1) * DELETE_COMPUTE_UNITS_PER_UNIT;
  const rounded = Math.ceil(measured / 10_000) * 10_000;
  return Math.min(
    Math.max(rounded, DELETE_COMPUTE_UNIT_FLOOR),
    MAX_COMPUTE_UNIT_LIMIT,
  );
}

export async function planDomainDeletes(
  input: PlanDeleteInput,
): Promise<PlanDeleteResult> {
  const { connection, owner, domains, instructions } = input;
  const warnings: string[] = [];
  const units: PackUnit[] = [];
  const ownerAddress = owner.toBase58();

  // The fee wallet, when fees are on — and funded, because a fee sent to an
  // account that cannot exist yet fails the whole transaction rather than creating
  // anything. Verified once for The Void; identical here.
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
        "No fee was charged: the fee wallet has not been funded yet, and a fee this small cannot create it.",
      );
    }
  }

  domains.forEach((domain, index) => {
    const api = instructions[index];

    // A stale list is the risk this check exists for: the registry records who
    // owns the name, and a delete signed by anybody else is refused on chain —
    // after the user has been told their domain is about to go.
    if (domain.owner !== null && domain.owner !== ownerAddress) {
      warnings.push(
        `Left ${domain.name}.sol alone: the registry says it belongs to ${domain.owner.slice(0, 6)}…`,
      );
      return;
    }

    if (!api) {
      warnings.push(
        `Left ${domain.name}.sol alone: its delete instruction could not be built.`,
      );
      return;
    }

    let instruction;
    try {
      instruction = apiToInstruction(api);
    } catch (error) {
      warnings.push(
        `Left ${domain.name}.sol alone: ${
          error instanceof Error ? error.message : "malformed instruction"
        }`,
      );
      return;
    }

    const unitInstructions = [instruction];

    // The fee, from the rent this delete is about to return — after the delete, so
    // it is always funded, and priced per domain so grouping cannot change it.
    const accountFee = feeFromRentLamports(domain.lamports, RECLAIM_FEE_BPS);
    if (feeEnabled && feeWallet && accountFee > 0) {
      unitInstructions.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: new PublicKey(feeWallet),
          lamports: accountFee,
        }),
      );
    }

    units.push({
      // The packer keys units by `mint`; here that is the name account, which is
      // exactly as opaque to it as a token account address is to the close flow.
      mint: domain.address,
      instructions: unitInstructions,
      rentReclaim: true,
    });
  });

  if (units.length === 0) {
    throw new DeleteError(
      "None of these domains can be deleted.",
      "Nothing was signed. Rescan the wallet and try again.",
      warnings,
    );
  }

  const blockhashInfo = await connection.getLatestBlockhash("confirmed");
  const computeUnitLimit = deleteComputeBudget(units.length);
  const prologue = createComputeBudgetInstructions(
    computeUnitLimit,
    PRIORITY_FEE_MICRO_LAMPORTS,
  );

  const packedResult = packTransactions({
    units,
    prologue,
    payer: owner,
    blockhash: blockhashInfo.blockhash,
    // A delete names the name account and the owner. Nothing to shrink with a table.
    lookupTables: [],
  });

  warnings.push(
    ...packedResult.dropped.map(
      (dropped) => `Left ${dropped.mint.slice(0, 6)}… out: ${dropped.reason}`,
    ),
  );

  if (packedResult.transactions.length === 0) {
    throw new DeleteError(
      "These domains are too large to delete in one go.",
      "Try deleting fewer at a time.",
      warnings,
    );
  }

  // Priced from the domains that actually made it into a transaction, so a unit
  // the packer dropped neither promises its rent nor charges a fee on it. Done
  // before the simulation, because the audit needs the fee it should expect and
  // the audit is what decides whether anything gets simulated or signed at all.
  const packedAccounts = new Set(
    packedResult.transactions.flatMap((tx) => tx.mints),
  );
  const packedDomains = domains.filter((domain) =>
    packedAccounts.has(domain.address),
  );
  const rentLamports = packedDomains.reduce(
    (sum, domain) => sum + domain.lamports,
    0,
  );
  const reclaimFeeLamports = feeEnabled
    ? packedDomains.reduce(
        (sum, domain) =>
          sum + feeFromRentLamports(domain.lamports, RECLAIM_FEE_BPS),
        0,
      )
    : 0;

  // ── The audit: what is about to be signed ────────────────────────────────
  // Every field of every delete comes back over the network from `/api/domains`,
  // so each one is checked here: the name account is one the user selected, the
  // wallet is the authority, and the rent goes back to the wallet and nowhere
  // else. A delete cannot be undone, which is why this runs before the cluster is
  // asked anything.
  auditPlanBeforeSigning({
    prologue,
    units,
    packed: packedResult.transactions,
    expected: {
      flow: "salvage",
      owner: owner.toBase58(),
      feeWallet,
      expectedFeeLamports: reclaimFeeLamports,
      expectedSubjects: packedDomains.map((domain) => domain.address),
    },
  });

  const simulations = await simulateAll(connection, packedResult.transactions);

  if (simulations.every((simulation) => !simulation.ok)) {
    const firstError = simulations.find((simulation) => !simulation.ok);
    throw new DeleteError(
      firstError?.error ?? "Every transaction failed to simulate.",
      "Nothing was signed or sent. Rescan the wallet and try again.",
      warnings,
    );
  }

  const priorityFee = Math.ceil(
    (computeUnitLimit * PRIORITY_FEE_MICRO_LAMPORTS) / 1_000_000,
  );

  return {
    packed: packedResult.transactions,
    simulations,
    warnings,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: blockhashInfo.lastValidBlockHeight,
    estimatedFeeLamports:
      packedResult.transactions.length * (BASE_FEE_LAMPORTS + priorityFee),
    computeUnitLimit,
    deleteCount: packedAccounts.size,
    rentLamports,
    reclaimFeeLamports,
    netRentLamports: rentLamports - reclaimFeeLamports,
    hasFailures: simulations.some((simulation) => !simulation.ok),
  };
}

