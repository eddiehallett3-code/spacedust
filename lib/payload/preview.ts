import type { PlanSendResult, SendOutcome } from "@/lib/payload/plan-send";
import type { PackedTransaction, SimulationOutcome } from "@/types/sweep";

/**
 * The part of Payload's state that describes a prepared plan.
 *
 * Extracted because it has to be written in **two** places: when a preview is
 * built, and when `execute` rebuilds the batch because its blockhash aged out
 * while the preview sat open. The second one used to store the new plan in the
 * ref and skip the state, so the panel went on showing the previous plan's rent,
 * fee and transaction count while the wallet was asked to sign the new one. The
 * figures on screen now come from one mapping, used by both paths, so they cannot
 * drift apart again.
 */
export interface PayloadPreview {
  packed: PackedTransaction[];
  simulations: SimulationOutcome[];
  outcomes: SendOutcome[];
  warnings: string[];
  rentLamports: number;
  feeLamports: number;
  recipientAccountLamports: number;
  netLamports: number;
  netIsNegative: boolean;
  networkFeeLamports: number;
}

export function previewFigures(result: PlanSendResult): PayloadPreview {
  return {
    packed: result.packed,
    simulations: result.simulations,
    outcomes: result.outcomes,
    warnings: result.warnings,
    rentLamports: result.estimatedRentLamports,
    feeLamports: result.estimatedFeeOnRentLamports,
    recipientAccountLamports: result.estimatedRecipientAccountLamports,
    netLamports: result.estimatedNetLamports,
    netIsNegative: result.netIsNegative,
    networkFeeLamports: result.estimatedFeeLamports,
  };
}
