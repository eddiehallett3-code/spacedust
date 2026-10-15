import type { NonFungibleAsset, TokenProgramKind } from "@/types/token";

/**
 * Shared scanner contract.
 *
 * Spacedust supports two interchangeable token sources:
 *
 *  - **Helius DAS** (premium): one indexed call, richest metadata.
 *  - **Core RPC + Jupiter** (free): works on any public endpoint, no API key.
 *
 * Both produce `ScannedHolding[]`, so `app/api/tokens` and everything
 * downstream is unaware of which one ran.
 */

/** A fungible holding, after normalisation and sanitisation. */
export interface ScannedHolding {
  mint: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  rawAmount: string;
  decimals: number;
  /** DAS-derived price. Only a fallback — the Jupiter Price API wins. */
  dasPriceUsd: number | null;
  organicScore: number | null;
  holderCount: number | null;
  program: TokenProgramKind;
  /**
   * The on-chain token account that holds `rawAmount`.
   *
   * Not necessarily the canonical ATA — `getTokenAccountsByOwner` and DAS both
   * surface non-canonical accounts. Instruction builders must close *this*
   * address, never a re-derived ATA, or the close fails with
   * `InvalidAccountData`.
   */
  tokenAccount: string | null;
  /** Token-2022 transfer-fee mint: the ATA keeps a residue, so we skip closing. */
  hasTransferFee: boolean;
  /**
   * True when the mint's freeze authority has frozen this holding.
   *
   * A frozen token account can be neither transferred, burned nor closed — only
   * the freeze authority can release it — so its rent is **not** recoverable,
   * and neither is its value. Anything that prices what a sweep would bring back
   * has to skip these rather than count them.
   *
   * The free core-RPC scanner drops frozen accounts before holdings are built
   * (it keeps only `initialized` state), so it reports `false` by omission. DAS
   * reports the flag directly.
   */
  frozen: boolean;
  /** Token-2022 transfer-hook mint: we never sweep these automatically. */
  hasTransferHook: boolean;
}

export interface ScanResult {
  holdings: ScannedHolding[];
  /**
   * NFTs and cNFTs, in their own array.
   *
   * The scanner splits them out so no downstream consumer can mistake one for
   * dust. Both providers must populate this — see the note on
   * `WalletScan.nonFungibles` for why the separation is load-bearing rather
   * than cosmetic.
   */
  nonFungibles: NonFungibleAsset[];
  /** Native SOL balance in lamports. */
  nativeLamports: number;
  pages: number;
  truncated: boolean;
  /** Which provider produced this result, for the UI and for debugging. */
  source: "helius-das" | "core-rpc";
}