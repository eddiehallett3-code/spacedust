import "server-only";

import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  AccountState,
  getDefaultAccountState,
  getMintCloseAuthority,
  getNonTransferable,
  getPermanentDelegate,
  getTransferFeeConfig,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@/lib/utils/constants";
import type { MintFacts } from "./mint-hazards";

/**
 * Read a mint's powers out of the account bytes we already have.
 *
 * This takes an `AccountInfo` rather than a connection on purpose: the scan
 * already fetches every mint account once to work out which mints are
 * program-controlled (`isPoolPosition`), so hazard notes cost **no extra RPC**.
 * A second pass over the same accounts would have doubled that read for no
 * reason.
 *
 * Returns null when the account is missing or too short to decode. That guard is
 * load-bearing: `bigint-buffer` (via spl-token's u64 layout) has no patched
 * release and overflows on truncated input, which is why the caller checks the
 * length before calling and this checks again.
 */

const LEGACY_PROGRAM = new PublicKey(TOKEN_PROGRAM_ID);
const TOKEN_2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);

export function mintFactsFromAccount(
  mint: string,
  info: AccountInfo<Buffer> | null,
): MintFacts | null {
  if (!info || info.data.length < MintLayout.span) return null;

  const isToken2022 = info.owner.equals(TOKEN_2022);
  const programId = isToken2022 ? TOKEN_2022 : LEGACY_PROGRAM;

  let parsed: ReturnType<typeof unpackMint>;
  try {
    parsed = unpackMint(new PublicKey(mint), info, programId);
  } catch {
    // An undecodable mint has no facts worth reporting, and must never take the
    // scan down with it.
    return null;
  }

  // Every extension lives only on Token-2022. Asking a legacy mint for one is a
  // programming error, not a hazard, so the branch is explicit.
  const transferFee = isToken2022 ? getTransferFeeConfig(parsed) : null;
  const permanentDelegate = isToken2022 ? getPermanentDelegate(parsed) : null;
  const nonTransferable = isToken2022 ? getNonTransferable(parsed) : null;
  const defaultState = isToken2022 ? getDefaultAccountState(parsed) : null;
  const closeAuthority = isToken2022 ? getMintCloseAuthority(parsed) : null;

  return {
    mint,
    program: isToken2022 ? "token2022" : "legacy",
    mintAuthority: parsed.mintAuthority?.toBase58() ?? null,
    freezeAuthority: parsed.freezeAuthority?.toBase58() ?? null,
    // The newer rate is the one that applies now; the older one is only for
    // epochs before `newerTransferFee.epoch`, which a fresh launch is never in.
    transferFeeBps: transferFee
      ? transferFee.newerTransferFee.transferFeeBasisPoints
      : null,
    permanentDelegate: permanentDelegate?.delegate.toBase58() ?? null,
    nonTransferable: nonTransferable !== null,
    defaultFrozen: defaultState?.state === AccountState.Frozen,
    mintCloseAuthority: closeAuthority?.closeAuthority.toBase58() ?? null,
  };
}
