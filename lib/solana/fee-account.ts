import { PublicKey } from "@solana/web3.js";
import { getOwnerAta } from "@/lib/solana/instructions";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";

/**
 * Where a swap fee lands: the fee wallet's own token account for the output
 * asset.
 *
 * WHY THIS IS DERIVED AND NOT CONFIGURED
 *
 * A swap fee is charged in the output mint, so it needs a token account in that
 * mint — three output assets, three accounts. Treating those as three settings
 * would mean three values that can silently disagree with chain, and a fee
 * account that does not match the output mint produces a swap that fails on
 * chain rather than an error at build time.
 *
 * A wallet's associated token account is a pure function of the wallet and the
 * mint, so one configured address describes the whole set and drift is
 * impossible rather than merely unlikely. `/api/health` compares each derived
 * account with what chain actually holds, and `probes/tmp-direct-fee-probe.mjs` checks
 * the derivation against every token account the fee wallet owns.
 *
 * This is the *whole* fee path: the balance is the wallet's from the moment the
 * swap lands, with no claim step and no third party's cut. Pointing the same
 * platform fee at a Jupiter referral token account instead would charge the user
 * identically but pay 20% of it to Jupiter on claim — see `SWAP_FEE_BPS`.
 */
export function swapFeeAccount(feeWallet: string, outputMint: string): string {
  // `tokenProgram` is explicit even though legacy is the default: every output
  // asset this app offers is a legacy SPL token, and the token program id is
  // part of the derivation seeds, so deriving under Token-2022 would name a
  // different address for the same wallet and mint.
  return getOwnerAta(
    new PublicKey(feeWallet),
    new PublicKey(outputMint),
    new PublicKey(TOKEN_PROGRAM_ID),
  ).toBase58();
}
