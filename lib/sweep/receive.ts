import type { OutputAsset } from "@/types/sweep";

/**
 * What the user actually receives from a sweep, split into the parts that add up
 * to it.
 *
 * Two decisions live here rather than inside the panel, because both are easy to
 * get subtly wrong and this is now the largest number on the screen:
 *
 *  - The swap figure is **net of the integrator fee**. That fee is charged
 *    inside the swap instruction, out of the swap's own output, so quoting the
 *    gross would promise money that never lands.
 *  - Rent joins the headline **only when the output asset is SOL**. Rent is
 *    always SOL, so for a SOL sweep it is the same unit and belongs in the total;
 *    for USDC it is a second amount in a second unit, and it is stated on its own
 *    line rather than silently added to a number it has no business being in.
 *
 * Both rent figures arrive already net of the rent fee, because the caller reads
 * them from the plan that prices it.
 */
export interface ReceiveFigures {
  /** Whole units of the output asset, after the swap fee. */
  netSwapOutput: number;
  /** SOL returned as rent, after the rent fee. */
  netRentSol: number;
  /** The headline: both parts when they share a unit, otherwise the swaps only. */
  headline: number;
}

export function receiveFigures({
  expectedOutput,
  feeBps,
  rentLamports,
  outputAsset,
}: {
  /** Expected output across the plan's builds, in whole units of `outputAsset`. */
  expectedOutput: number;
  /** Integrator fee applied to the swaps, in basis points. */
  feeBps: number;
  /** Rent returned by the closes, in lamports, net of the rent fee. */
  rentLamports: number;
  outputAsset: OutputAsset;
}): ReceiveFigures {
  const netSwapOutput = expectedOutput * (1 - feeBps / 10_000);
  const netRentSol = rentLamports / 1e9;

  return {
    netSwapOutput,
    netRentSol,
    headline: netSwapOutput + (outputAsset === "SOL" ? netRentSol : 0),
  };
}
