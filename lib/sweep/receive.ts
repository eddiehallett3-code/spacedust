import type { OutputAsset } from "@/types/sweep";

/**
 * What the user actually receives from a sweep, split into the parts that add up
 * to it.
 *
 * One decision lives here rather than inside the panel:
 *
 *  - Rent joins the headline **only when the output asset is SOL**. Rent is
 *    always SOL, so for a SOL sweep it is the same unit and belongs in the total;
 *    for USDC it is a second amount in a second unit, and it is stated on its own
 *    line rather than silently added to a number it has no business being in.
 *
 * There is no swap fee to subtract. Slingshot charges nothing on the swap itself;
 * its only fee is the 1.5% on reclaimed rent, which the caller has already netted
 * off before this is called.
 */
export interface ReceiveFigures {
  /** Whole units of the output asset. */
  swapOutput: number;
  /** SOL returned as rent, after the rent fee. */
  netRentSol: number;
  /** The headline: both parts when they share a unit, otherwise the swaps only. */
  headline: number;
}

export function receiveFigures({
  expectedOutput,
  rentLamports,
  outputAsset,
}: {
  /** Expected output across the plan's builds, in whole units of `outputAsset`. */
  expectedOutput: number;
  /** Rent returned by the closes, in lamports, net of the rent fee. */
  rentLamports: number;
  outputAsset: OutputAsset;
}): ReceiveFigures {
  const swapOutput = expectedOutput;
  const netRentSol = rentLamports / 1e9;

  return {
    swapOutput,
    netRentSol,
    headline: swapOutput + (outputAsset === "SOL" ? netRentSol : 0),
  };
}
