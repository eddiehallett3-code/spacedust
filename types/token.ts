/**
 * Token domain types.
 *
 * Everything that reaches the UI has already been through `lib/helius` and
 * `lib/utils/sanitize.ts`. Treat these as trusted-for-display, not
 * trusted-for-execution — mint and account addresses are re-validated before
 * any instruction is built (see `lib/utils/sanitize.ts` and
 * `lib/solana/instructions.ts`).
 */

import type { TokenApproval } from "@/lib/solana/approvals";
import type {
  ExcessRentAccount,
  PumpAccumulator,
  SalvageDomain,
  WrappedSolAccount,
} from "@/types/salvage";

/** Which token program owns a mint. Drives which program id we use to close ATAs. */
export type TokenProgramKind = "legacy" | "token2022";

/**
 * What we can honestly say about a transfer-hook token.
 *
 * A Token-2022 mint can carry a transfer-hook extension. `inert` means the
 * extension exists but no program id is set, so nothing runs on a transfer —
 * the token can still be burned in The Void. `active` means a program runs on
 * every transfer, which is why no swapper will touch it. `frozen` outranks
 * both, and `unknown` is what we say when the mint could not be read.
 *
 * The classification lives in `lib/token-source/hook-tokens.ts`; this is only
 * the shape it travels in.
 */
export type HookVerdict = "inert" | "active" | "frozen" | "unknown";

/** Facts about one transfer-hook holding, as best we could read them. */
export interface HookTokenFacts {
  /** The mint this describes. */
  mint: string;
  /** Which token program owns the mint. */
  program: TokenProgramKind;
  /** The hook program the extension points at, or null when none is set. */
  hookProgram: string | null;
  /**
   * The authority allowed to update the hook, or null. All-zeros means the
   * hook is immutable — nobody can change it, the issuer included.
   */
  hookAuthority: string | null;
  /** The verdict. */
  verdict: HookVerdict;
}

/**
 * A staking position we can name, carried on the holding that represents it.
 *
 * A liquid staking token is an ordinary SPL token, so nothing on the mint says
 * what it is. `protocol` is therefore a name we verified for that specific mint
 * — see `lib/staking/staked-tokens.ts` for why the registry is curated by hand
 * rather than inferred from the mint's shape.
 */
export interface StakedHoldingRef {
  /** The protocol whose staking this token represents, e.g. "Marinade". */
  protocol: string;
  /** The asset being staked. "SOL" for every entry today. */
  underlying: string;
  /** The token's own symbol, e.g. "mSOL", so a row can label itself. */
  symbol: string;
}

/** What a native stake account is doing right now. */
export type StakeAccountState =
  | "active"
  | "activating"
  | "deactivating"
  | "inactive";

/**
 * A native SOL stake account.
 *
 * Not a token: SOL delegated to a validator lives in its own account, owned by
 * the Stake program, with no mint and no ATA. The token scan cannot see it, so
 * it is read separately and carried beside the tokens rather than in them —
 * `address` here is a stake account, not a token account, and nothing downstream
 * may hand it to a token instruction.
 *
 * `sol` is `lamports` divided by 1e9 for display; `lamports` is kept as a string
 * because a `u64` can exceed `Number.MAX_SAFE_INTEGER` and the exact figure is
 * the one that matters.
 */
export interface StakedAccount {
  /** The stake account address. The only account that can be withdrawn/closed. */
  address: string;
  state: StakeAccountState;
  /** Delegated lamports, base units, as a string. */
  lamports: string;
  /** Delegated SOL, for display. */
  sol: number;
  /** The validator vote account it is delegated to, or null. */
  validator: string | null;
}

/** A single dust token held by the connected wallet. */
export interface DustToken {
  /** SPL mint address. Validated as base58 + 32 bytes. */
  mint: string;
  /** Display name, already length-capped and stripped of control characters. */
  name: string;
  /** Display symbol, already length-capped and stripped of control characters. */
  symbol: string;
  /**
   * Logo URI. Only ever https/http and only rendered through a proxied image
   * component — never inlined into markup (see `TokenLogo`).
   */
  logoUri: string | null;
  /** Raw balance in base units (string, because it can exceed 2^53). */
  rawAmount: string;
  /** Human-readable balance, e.g. "1,234.56". */
  balance: number;
  /** `decimals` from the mint's on-chain metadata. */
  decimals: number;
  /** Unit price in USD from the Jupiter Price API, or null if unpriceable. */
  priceUsd: number | null;
  /** 24h price change as a percentage, e.g. -3.2 means -3.2%. */
  priceChange24h: number | null;
  /** balance * priceUsd. 0 when unpriceable. */
  valueUsd: number;
  /** Which program owns this mint. */
  program: TokenProgramKind;
  /**
   * The on-chain token account that actually holds this balance.
   *
   * Usually — but **not always** — the canonical associated token account
   * (ATA). Old airdrops and some tools create token accounts at arbitrary
   * addresses, and `getTokenAccountsByOwner` returns those too. We must never
   * *assume* the ATA and close a derived address instead of this one: closing
   * an address that holds no account fails on-chain with `InvalidAccountData`.
   *
   * `null` when the scanner could not determine the address; callers then fall
   * back to the derived ATA.
   */
  tokenAccount: string | null;
  /** True when the Jupiter Price API had no reliable price for this mint. */
  hasNoPrice: boolean;
  /** True when the mint has an active Token-2022 transfer-hook extension. */
  hasTransferHook: boolean;
  /**
   * True when the mint charges a Token-2022 transfer fee.
   *
   * Such a swap leaves a residue in the source ATA, so `closeAccount` would fail.
   * We therefore skip rent reclaim for these rather than let a sweep die.
   */
  hasTransferFee: boolean;
  /**
   * On-chain facts for transfer-hook tokens, read from the chain by the scan
   * route. Present only when the scanner flagged `hasTransferHook`; absent on
   * every other holding so the payload stays lean. Optional so a hand-built
   * token in a test needs no hook data.
   */
  hookFacts?: HookTokenFacts | null;
  /**
   * True when the mint's freeze authority has frozen this holding.
   *
   * A frozen token account cannot be transferred, burned or closed, so neither
   * its value nor its rent is recoverable. The read-only scan relies on this to
   * avoid promising rent it cannot deliver — see `lib/sweep/recoverable.ts`.
   */
  frozen: boolean;
  /**
   * True when the mint is controlled by a **program** rather than a person — the
   * shape a pool's LP token and a program-issued receipt both have.
   *
   * MEASURED, not assumed. A mint authority can be a wallet, but it cannot be a
   * program, so an authority that sits *off the ed25519 curve* is a PDA — which
   * means the mint is owned by something that is not a keypair. The scan's control
   * run over the Incinerator found 996 held mints and every one of them had its
   * authority revoked, so this signal never fired there; that is exactly why it is
   * worth carrying rather than guessing at: the earlier attempt to detect positions
   * by "one-of-one, no decimals" flagged every NFT ever minted.
   *
   * This is a **signal, not proof**. A program-controlled mint is a pool share, a
   * staking receipt or a vault claim — something whose value lives in a program
   * that has to give it back. It is never an ordinary token you can sell.
   *
   * Two consequences, both load-bearing:
   *
   *  - Its balance **cannot be swept**, so its rent cannot be promised either: a
   *    token account holding a balance cannot be closed, and there is no market to
   *    empty it through. See `lib/sweep/recoverable.ts`.
   *  - It must never be **burned**. Burning an LP token gives away the share of the
   *    pool it represents, irreversibly, and The Void pre-selects unpriced tokens.
   */
  poolLike: boolean;
  /**
   * Set when this mint is a staking token we can **name** — mSOL, JitoSOL, and
   * the rest of `lib/staking/staked-tokens.ts`.
   *
   * Without it these are indistinguishable from dust: an ordinary SPL token,
   * priced, listed, and sold by a sweep like anything else. Naming them lets the
   * scan show the position as what it is and keep it out of the sweep, for the
   * same reason a pool share is kept out — a staking position must not be cashed
   * in by accident on the way past some dust.
   *
   * This is a *stronger* answer than `poolLike` (we know the protocol, not just
   * the mint's shape), so it takes precedence wherever both are set: the two are
   * ranked, not merged. See `lib/sweep/recoverable.ts`.
   *
   * `null` means "not a staking token we recognise", never "not staked". A mint
   * missing from the registry keeps whatever `poolLike` already decided.
   */
  staked: StakedHoldingRef | null;
}

/**
 * An NFT or cNFT the wallet holds.
 *
 * Deliberately not a `DustToken`. These are never swapped, never priced, never
 * pre-selected and never swept implicitly — burning one destroys a unique
 * asset, so it stays an explicit choice made with the image in front of you.
 *
 * `compressed` is the cNFT flag. A cNFT is a leaf in a merkle tree rather than
 * a token account, so burning one reclaims no rent; often the only reason to do
 * it is to be rid of spam.
 */
export interface NonFungibleAsset {
  /** Mint address for an uncompressed NFT; the asset id for a compressed one. */
  id: string;
  name: string;
  /** Sanitised image URL, or null when the index has none. */
  imageUri: string | null;
  /** MIME of the primary file, so the UI never renders a video as a still. */
  imageMime: string | null;
  collection: { address: string; name: string | null } | null;
  /** True for cNFTs: no token account, no rent to reclaim. */
  compressed: boolean;
  /** Raw index interface, for grouping and diagnostics. */
  interface: string;
  /** The token account holding it. Null for cNFTs. */
  tokenAccount: string | null;
  /** Which token program owns that account. */
  program: TokenProgramKind;
  /**
   * Frozen by the mint's freeze authority. The owner can neither transfer nor
   * burn a frozen asset, so it must never be offered as burnable.
   */
  frozen: boolean;
  /**
   * What a compressed asset needs in order to be burned, or `null`.
   *
   * A cNFT is a leaf in a merkle tree, so destroying it means telling the
   * Bubblegum program which tree, which leaf, and which two hashes that leaf
   * commits to. None of that can be derived from an address — it all comes from
   * the indexer — so `null` here means "we cannot prove this leaf is in the
   * tree", and the asset must not be offered as burnable.
   */
  merkle: CompressedLeaf | null;
  /** The leaf delegate, when a compressed asset is delegated. */
  delegate: string | null;
}

/**
 * The four facts a compressed NFT's burn is built from.
 *
 * All four come from the indexer. The merkle *proof* — the sibling hashes that
 * connect this leaf to the tree's root — is deliberately not part of this: it
 * has to be fetched fresh at plan time, because the tree can gain a leaf at any
 * moment and any proof older than the tree's current root is worthless.
 */
export interface CompressedLeaf {
  /** The merkle tree holding the leaf. */
  tree: string;
  /** The leaf's index within that tree. */
  leafId: number;
  /** The leaf's own hashes, as the indexer computed them. */
  dataHash: string;
  creatorHash: string;
  /**
   * Bubblegum V2 only — the hash of the asset's own data, or `null` for a V1
   * leaf, which does not commit to one.
   *
   * A V2 leaf cannot be burned without it, so this is read all-or-nothing with
   * the rest: a V2 leaf whose asset-data hash the index did not give us is
   * refused rather than sent with a plausible default.
   */
  assetDataHash: string | null;
  /** Bubblegum V2 only — the leaf's flags word, or `null` for a V1 leaf. */
  flags: number | null;
  /**
   * How many proof accounts a burn of this leaf has to send, or `null`/absent
   * when the tree could not be read during the scan.
   *
   * This is a property of the tree — the length `getAssetProof` returns after
   * its canopy nodes are removed — not of this leaf, and it is fixed for the
   * tree's lifetime. It is cached here so the UI can separate cNFTs that burn
   * inside one transaction from those whose proof needs an address lookup
   * table, without fetching a proof for every card. The proof itself is still
   * fetched fresh at plan time; only its *length* is carried over.
   */
  proofNodes?: number | null;
}

/** Native SOL position, shown separately because it is never swept as input. */
export interface NativeBalance {
  lamports: number;
  sol: number;
  valueUsd: number | null;
}

/**
 * An initialized token account that holds no balance, but still holds its rent.
 *
 * These are invisible to the token list — both scanners drop a zero amount — so
 * they are carried separately. Nothing about them is a dust decision: there is
 * nothing to swap and nothing to burn, only an account to close.
 *
 * Every field here was read from the account itself, never the mint, because
 * that is where the decisions live: closeability is a property of *this*
 * account, not of the token it once held.
 */
export interface EmptyTokenAccount {
  /** The account to close. Closing it returns `lamports` to the owner. */
  address: string;
  /** The mint it was opened for. Used for display only — the mint cannot block a close. */
  mint: string;
  /** Which program owns it. Decides which `closeAccount` to build. */
  program: TokenProgramKind;
  /**
   * The account's own lamports, which is exactly what closing it returns.
   *
   * Read per account rather than priced from `tokenAccountRentLamports`: a
   * Token-2022 account with extensions legitimately holds more than a legacy
   * one, so a single constant would understate it.
   */
  lamports: number;
  /**
   * True when the mint's freeze authority has frozen it.
   *
   * Retained because it is true and worth showing — but it does **not** block a
   * close, which is the opposite of its effect on a swap, a burn or a revoke.
   */
  frozen: boolean;
  /**
   * A close authority, when one is set.
   *
   * When this is anyone other than the owner, the account can no longer be
   * closed by the owner at all: the token program rejects it with
   * "owner does not match".
   */
  closeAuthority: string | null;
  /**
   * Token-2022 withheld transfer fees on this account.
   *
   * Non-zero means the program refuses to close it until the mint harvests
   * them, so those accounts are refused rather than offered.
   */
  withheldFees: number;
}

/** Full result of one wallet scan. */
export interface WalletScan {
  owner: string;
  tokens: DustToken[];
  native: NativeBalance;
  /**
   * USD price for each selectable output asset (SOL, USDC, JUP), keyed by mint.
   *
   * Returned regardless of what the wallet holds. Without this the UI would
   * have to look the price up among the user's own holdings — but SOL is not a
   * token account and most wallets hold neither USDC nor JUP, so the estimate
   * would silently be blank for most users.
   */
  outputPrices: Record<string, number>;
  /**
   * Empty token accounts, kept out of `tokens`.
   *
   * They are not dust: there is no balance to sell or burn. What they hold is
   * rent, and closing them is the only way to get it back. Read separately
   * because both scanners drop a zero amount by design.
   */
  emptyAccounts: EmptyTokenAccount[];
  /**
   * Set when the empty-account read failed.
   *
   * "We could not look" and "there are none" are different answers, and only one
   * of them is safe to render as an empty list. The token list still works, so
   * this degrades to a visible warning rather than failing the scan.
   */
  emptyAccountsError: string | null;
  /**
   * The wallet's Pump.fun user volume accumulator, when it still exists.
   *
   * Pump.fun creates one program-owned account per wallet to track volume for
   * fee tiers. It is not a token account and is invisible to the token scanner;
   * the address is a PDA, so the read is a single account lookup. Closing it
   * returns its rent and resets the volume tracking.
   */
  pumpAccumulator?: PumpAccumulator | null;
  /** Set when the Pump.fun accumulator read failed. */
  pumpAccumulatorError?: string | null;
  /**
   * Token-2022 accounts holding more lamports than their rent-exempt minimum.
   *
   * These are *not* empty accounts: they still hold a token or NFT, so they
   * cannot be closed. Token-2022's `WithdrawExcessLamports` returns only the
   * spare lamports and leaves the balance and account untouched. Read
   * separately from `emptyAccounts` because the action and the rule differ.
   */
  excessRentAccounts?: ExcessRentAccount[];
  /** Set when the excess-rent read failed. */
  excessRentError?: string | null;
  /**
   * Native SOL stake accounts the wallet controls.
   *
   * Read separately from the tokens because a stake account is not a token: no
   * mint, no ATA, invisible to every token query. Kept beside `tokens` rather
   * than inside it so nothing can mistake a stake account for a token account
   * and hand it to a token instruction.
   */
  stakedAccounts: StakedAccount[];
  /**
   * Set when the stake read failed.
   *
   * The same rule the empty-account read follows: "we could not look" and "there
   * are none" are different answers, and only one of them is safe to render as
   * an empty list.
   */
  stakedAccountsError: string | null;
  /**
   * Live rent-exempt minimum for one SPL token account, in lamports, fetched
   * during this scan.
   *
   * Rent is set by the network and has changed before. Anything that prices a
   * reclaim must use this rather than a constant — see `lib/solana/rent.ts`.
   */
  tokenAccountRentLamports: number;
  /**
   * Set when the mint-authority read failed.
   *
   * "We could not look" and "the wallet holds no positions" are different answers,
   * and only one of them is safe to render as an empty list — the same rule the
   * empty-account read follows.
   */
  poolLikeError: string | null;
  /** Number of DAS pages fetched. */
  pages: number;
  /** Wall-clock ms the scan took, for the "scanned in 412ms" caption. */
  durationMs: number;
  /** True when the provider had more results than we fetched. */
  truncated: boolean;
  /** Which backend produced this scan: Helius DAS, or free core RPC. */
  source: "helius-das" | "core-rpc";
  /**
   * NFTs and cNFTs the wallet holds.
   *
   * Kept out of `tokens` entirely rather than mixed in with a flag. An
   * uncompressed NFT arrives from DAS looking exactly like a token — balance 1,
   * decimals 0, its own token account — so anything downstream that iterates
   * `tokens` (the smart filter, the Void's illiquid set, the packer) would treat
   * it as sweepable dust. The Void pre-selects unpriced tokens for burning, so
   * a single misclassification puts an NFT one click from destruction.
   */
  nonFungibles: NonFungibleAsset[];
  /**
   * Standing token approvals, included when the caller asks for them.
   *
   * `null` means the read was attempted and failed; `undefined` means this
   * response did not ask for approvals. The distinction matters: "no approvals"
   * and "we could not look" are different answers, and only one is a clean bill
   * of health.
   */
  approvalsCount?: number | null;
  /** Why the approvals read failed, when `approvalsCount` is null. */
  approvalsError?: string | null;
  /**
   * The approvals themselves, when the caller asked for the full scan.
   *
   * `undefined` means the extras were not requested; `null` means the read
   * failed. The UI keeps the existing count fields for compact views and uses
   * this list only for the expandable security detail.
   */
  approvals?: TokenApproval[] | null;
  /**
   * Non-empty wrapped-SOL accounts, when the caller asked for the full scan.
   *
   * wSOL is deliberately absent from `tokens`: both scanners drop the native
   * mint, and an empty wSOL account belongs to `emptyAccounts`. `undefined`
   * means the extra read was not requested; `[]` means it ran and found none.
   */
  wrappedSol?: WrappedSolAccount[];
  /** Why the wrapped-SOL read failed, when `wrappedSol` is empty. */
  wrappedSolError?: string | null;
  /**
   * `.sns` names the wallet owns, when the caller asked for the full scan.
   *
   * `undefined` means not requested; `[]` means the lookup ran and found none.
   * A name is not a liquid asset: its only value on this page is the rent its
   * account holds, which is why it is shown separately from the recoverable
   * total.
   */
  snsDomains?: SalvageDomain[];
  /** Why the SNS lookup failed, when `snsDomains` is empty. */
  snsError?: string | null;
  /** True when the SNS lookup found more names than the 250-entry cap. */
  snsTruncated?: boolean;
}

/** Reasons a token is hidden when "Smart Filter" is on. */
export type FilterReason =
  | "no-price"
  | "not-tradeable"
  | "high-price-impact"
  | "below-threshold";

/** Per-token view state. Kept out of `DustToken` so the API payload stays lean. */
export interface TokenViewState {
  selected: boolean;
  hiddenBySmartFilter: boolean;
  filterReason: FilterReason | null;
  /** Price impact reported by the most recent Jupiter quote, as a fraction. */
  priceImpactPct: number | null;
  /** Base units of output token expected for this input, from the quote. */
  expectedOutAmount: string | null;
  /** Human output amount, derived from `expectedOutAmount`. */
  expectedOutAmountFormatted: number | null;
  /** Populated when a build or swap failed for this token specifically. */
  error: string | null;
  /** Solana signature once this token's swap landed. */
  signature: string | null;
}