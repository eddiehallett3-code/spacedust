/**
 * Shapes mirroring Jupiter Swap API v2 `GET /build` and Price API v3.
 *
 * We only model the fields we actually consume. Jupiter sends more; unknown
 * fields are ignored on purpose so a Jupiter-side addition can never break us.
 *
 * Reference: https://developers.jup.ag/docs/swap/build
 */

/** One account reference inside a Jupiter instruction. */
export interface ApiInstructionAccount {
  pubkey: string;
  isWritable: boolean;
  isSigner: boolean;
}

/** A Jupiter instruction, before we convert it to a web3.js Instruction. */
export interface ApiInstruction {
  programId: string;
  accounts: ApiInstructionAccount[];
  /** Base64-encoded instruction data. */
  data: string;
}

/** One hop in Jupiter's route plan. */
export interface RoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
  };
  percent: number;
  bps: number;
}

/** Raw `/build` response, exactly as Jupiter returns it. */
export interface JupiterBuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  routePlan: RoutePlanStep[];
  computeBudgetInstructions: ApiInstruction[];
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  otherInstructions: ApiInstruction[];
  tipInstruction: ApiInstruction | null;
  /** ALT address -> encoded addresses. Null when the route needed no lookups. */
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: {
    /** Base58 blockhash. (Jupiter serialises as a byte array; we re-encode.) */
    blockhash: string;
    lastValidBlockHeight: number;
  };
  /** Jupiter platform fee, always 0 on /build unless we ask for one. */
  platformFeeBps?: number;
}

/** Jupiter error envelope. */
export interface JupiterErrorBody {
  error: string;
  code?: number;
}

/** Price API v3 entry. */
export interface JupiterPriceEntry {
  usdPrice: number;
  blockId: number;
  decimals: number;
  priceChange24h: number;
}