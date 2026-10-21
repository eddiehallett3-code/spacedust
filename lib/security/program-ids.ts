import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@/lib/utils/constants";

/**
 * Every program id this app is willing to let into a signed transaction.
 *
 * WHY THIS FILE EXISTS
 *
 * Instructions reach this app from two places it does not fully control: the
 * server routes that talk to Jupiter and to SNS, and — for burns — the Metaplex
 * builders. `apiToInstruction` checks that such an instruction is *well formed*
 * (a real address, a bounded account list, base64 data) and nothing more: it
 * cannot know that the program it names is one we expected, and a
 * `SystemProgram.transfer` draining a wallet is as well formed as a swap.
 *
 * So the allow-list is the other half of that boundary: an instruction is only
 * signable if its program appears below *and* the flow's own rules in
 * `instruction-audit.ts` accept what it does.
 *
 * THE ONE RULE FOR ADDING A PROGRAM
 *
 * It must be a program one of our flows genuinely builds instructions for. Not
 * "a program a response could contain", not "a program that is usually safe" —
 * a program we can point at the line of code that needs it.
 *
 * The ids are copied from the packages that ship them, never from memory: three
 * of them (Core, Noop, and SNS's registry) were read out of `node_modules` while
 * writing this, and Bubblegum's four-name program lookup is documented in
 * `lib/solana/umi-program-repository.ts`.
 */

/** Jupiter's aggregator. The only program whose opaque data we accept at all. */
export const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/** Metaplex Token Metadata — the burn route for a classic NFT. */
export const TOKEN_METADATA_PROGRAM_ID =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/** Metaplex Bubblegum — the burn route for a compressed NFT. */
export const BUBBLEGUM_PROGRAM_ID =
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";

/** SPL Account Compression — Bubblegum verifies a leaf against this. */
export const ACCOUNT_COMPRESSION_PROGRAM_ID =
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK";

/** Metaplex Core — the burn route for a Core asset. */
export const CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

/** SPL Noop — Bubblegum's leaf-owner verification CPI. Moves nothing. */
export const NOOP_PROGRAM_ID = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";

/** The SNS name registry. Its delete instruction is the only thing Salvage uses it for. */
export const SNS_NAME_PROGRAM_ID = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";

/**
 * Human names, so a refusal can say *who* it refused rather than showing a
 * base58 blob. An unknown id is truncated instead of guessed.
 *
 * `simulate.ts` keeps its own label map for phrasing simulation errors; this one
 * is the list the audit reasons about, and the two are allowed to differ only in
 * length — never in the ids they name.
 */
export const PROGRAM_LABELS: Record<string, string> = {
  [SYSTEM_PROGRAM_ID]: "System",
  [COMPUTE_BUDGET_PROGRAM_ID]: "Compute Budget",
  [TOKEN_PROGRAM_ID]: "SPL Token",
  [TOKEN_2022_PROGRAM_ID]: "Token-2022",
  [ASSOCIATED_TOKEN_PROGRAM_ID]: "Associated Token",
  [JUPITER_PROGRAM_ID]: "Jupiter",
  [TOKEN_METADATA_PROGRAM_ID]: "Token Metadata",
  [BUBBLEGUM_PROGRAM_ID]: "Bubblegum",
  [ACCOUNT_COMPRESSION_PROGRAM_ID]: "SPL Account Compression",
  [CORE_PROGRAM_ID]: "Metaplex Core",
  [NOOP_PROGRAM_ID]: "SPL Noop",
  [SNS_NAME_PROGRAM_ID]: "SNS Name Registry",
};

/** The name to use for a program, or a short form of an unknown id. */
export function programLabel(programId: string): string {
  return (
    PROGRAM_LABELS[programId] ?? `${programId.slice(0, 4)}…${programId.slice(-4)}`
  );
}

/**
 * Which programs each flow may touch, as a hard allow-list.
 *
 * Deliberately not "all programs we know": a revoke has no business naming
 * Jupiter, and a sweep has no business naming Metaplex. A flow that finds
 * itself needing a program the list does not have is a decision to make here,
 * in a diff, rather than something that happens quietly at a wallet prompt.
 *
 * `ASSOCIATED_TOKEN` appears where the flow creates an account (a sweep's
 * Jupiter setup, a send's destination), `SYSTEM` only where a fee or a wrapping
 * transfer is built, and `NOOP`/`ACCOUNT_COMPRESSION` only because a compressed
 * burn cannot be built without them.
 */
export const FLOW_PROGRAMS: Record<AuditFlowName, readonly string[]> = {
  sweep: [
    COMPUTE_BUDGET_PROGRAM_ID,
    JUPITER_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    // A sweep that outputs SOL wraps it, and wrapping moves lamports into the
    // wallet's own wrapped-SOL account; and a sweep pays its rent-reclaim fee
    // with a plain SOL transfer to the fee wallet. Banning the program outright
    // would break both routes; what protects the user instead is the destination
    // rule — SOL may only go to the fee wallet, to the wallet itself, or to an
    // account the plan declared.
    SYSTEM_PROGRAM_ID,
  ],
  void: [
    COMPUTE_BUDGET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_METADATA_PROGRAM_ID,
    BUBBLEGUM_PROGRAM_ID,
    ACCOUNT_COMPRESSION_PROGRAM_ID,
    CORE_PROGRAM_ID,
    NOOP_PROGRAM_ID,
    // The Void charges a fee per account burned, and it is a plain SOL transfer.
    SYSTEM_PROGRAM_ID,
  ],
  payload: [
    COMPUTE_BUDGET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    // A cNFT is a leaf in a merkle tree, so sending one is a Bubblegum transfer
    // verified against the tree's root. Its two helpers move nothing: Bubblegum
    // verifies the leaf, the compression program checks the root.
    BUBBLEGUM_PROGRAM_ID,
    ACCOUNT_COMPRESSION_PROGRAM_ID,
    NOOP_PROGRAM_ID,
  ],
  salvage: [
    COMPUTE_BUDGET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SNS_NAME_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
  ],
  approvals: [
    COMPUTE_BUDGET_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  ],
};

/**
 * The five flows, named once.
 *
 * Declared here rather than in the audit so this module has no import of it —
 * the audit imports the allow-list, never the other way round.
 *
 * `salvage` covers the two Pro cleanup routes: empty-account closes and SNS
 * name deletes. Their instructions are different, but both return rent to the
 * same owner and both are audited by the same flow-specific rules.
 */
export type AuditFlowName = "sweep" | "void" | "payload" | "salvage" | "approvals";
