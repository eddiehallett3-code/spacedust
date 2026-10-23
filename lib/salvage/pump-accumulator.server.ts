import "server-only";

import { rpcCall } from "@/lib/token-source/rpc.server";
import { base64ToBytes } from "@/lib/utils/base64";
import type { PumpAccumulator } from "@/types/salvage";
import {
  PUMP_AMM_PROGRAM_ID,
  derivePumpAccumulator,
  isUserVolumeAccumulatorData,
} from "./pump-accumulator";

/**
 * Read the wallet's Pump.fun user volume accumulator.
 *
 * One derived PDA, one `getAccountInfo`. No `getProgramAccounts` and no scan of
 * Pump's whole account space: the address is deterministic from the wallet, so
 * the read is as small as it can be.
 *
 * The account discriminator is checked before the row is offered. The PDA
 * belongs to Pump AMM and nothing else should live there, but "should" is not a
 * reason to build a close for whatever happens to be at that address.
 */
interface AccountInfoResult {
  value?: {
    data?: [string, string];
    executable?: boolean;
    lamports?: number;
    owner?: string;
  } | null;
}

export async function readPumpAccumulator(
  owner: string,
): Promise<PumpAccumulator | null> {
  const address = derivePumpAccumulator(owner);
  const result = await rpcCall<AccountInfoResult>("getAccountInfo", [
    address.toBase58(),
    { encoding: "base64" },
  ]);

  const account = result.value;
  if (!account || account.owner !== PUMP_AMM_PROGRAM_ID) return null;

  const lamports = account.lamports;
  if (typeof lamports !== "number" || !Number.isFinite(lamports) || lamports <= 0) {
    return null;
  }

  const encoded = account.data?.[0];
  if (!encoded) return null;
  if (!isUserVolumeAccumulatorData(base64ToBytes(encoded))) return null;

  return { address: address.toBase58(), lamports: Math.trunc(lamports) };
}
