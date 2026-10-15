import type { StakeAccountState } from "@/types/token";

export type { StakeAccountState };


/**
 * Decoding a Stake-program account.
 *
 * A "staked SOL" position is not a token — it is a second account, owned by the
 * Stake program, that a wallet holds. Nothing in the token scan can see it, so
 * the wallet's stake accounts have to be read separately, and this is the part of
 * that read that is pure arithmetic.
 *
 * THE LAYOUT, MEASURED RATHER THAN REMEMBERED
 *
 * `probes/tmp-stake-layout.mjs` dumped a real delegated account and the fields were
 * located by their values, not assumed. The trap is the 48-byte `Lockup` sitting
 * between the withdrawer and the delegation — on a normal account it is all
 * zeroes, which makes it invisible unless you look for it, and putting the voter
 * at 76 instead of 124 produces a filter that silently matches nothing:
 *
 *   u32  tag                     @0    (1 = Initialized, 2 = Stake)
 *   u64  rent_exempt_reserve     @4
 *   pk   staker                  @12
 *   pk   withdrawer              @44
 *   --   Meta.lockup (48 bytes) --
 *   i64  lockup.unix_timestamp   @76
 *   u64  lockup.epoch            @84
 *   pk   lockup.custodian        @92
 *   pk   voter                   @124
 *   u64  stake                   @156
 *   u64  activation_epoch        @164
 *   u64  deactivation_epoch      @172
 *   f64  warmup_cooldown_rate    @180
 *   u64  credits_observed        @188
 *
 * Every stake account is 200 bytes regardless of state, so the size can be
 * filtered on but the state cannot.
 */

/** Field offsets, named so the decoder reads as the table above. */
export const STAKE_ACCOUNT_SIZE = 200;
export const STAKE_TAG_OFFSET = 0;
export const STAKE_WITHDRAWER_OFFSET = 44;
export const STAKE_VOTER_OFFSET = 124;
export const STAKE_AMOUNT_OFFSET = 156;
export const STAKE_ACTIVATION_OFFSET = 164;
export const STAKE_DEACTIVATION_OFFSET = 172;

/** `StakeStateV2`'s discriminant for a delegated account. */
export const STAKE_TAG_DELEGATED = 2;
/** ...and for one that exists but has not been delegated to a validator. */
export const STAKE_TAG_INITIALIZED = 1;

/** The sentinel `deactivation_epoch` carries when a stake is not winding down. */
const NOT_DEACTIVATING = 0xffffffffffffffffn;

export interface ParsedStakeAccount {
  /** The account that must sign to move or close this SOL. */
  withdrawer: string;
  state: StakeAccountState;
  /**
   * Delegated lamports in base units, as a string.
   *
   * A string for the same reason a token balance is one: lamports are a `u64`
   * and can exceed `Number.MAX_SAFE_INTEGER`, so a `number` would quietly round
   * the one figure that matters most here.
   */
  lamports: string;
  /** Which validator it is delegated to, or null when it is not delegated. */
  validator: string | null;
  activationEpoch: number | null;
  /** Null when the stake is not winding down. */
  deactivationEpoch: number | null;
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode 32 bytes as base58.
 *
 * Deliberately not `new PublicKey(...).toBase58()`: this runs over bytes read
 * from an account the scan does not control, and `PublicKey` accepts any 32
 * bytes without checking the curve — so it would render a run of zeroes as an
 * address. The zero check in `readPubkey` is the guard that matters, and doing
 * the encoding here keeps this module dependency-free and unit-testable.
 */
function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);

  let out = "";
  while (value > 0n) {
    out = BASE58_ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  // Each leading zero byte is a leading "1" in base58.
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Read a pubkey at `offset`, or null when the field is a zero placeholder. */
export function readStakePubkey(
  data: Uint8Array,
  offset: number,
): string | null {
  const slice = data.subarray(offset, offset + 32);
  if (slice.length < 32) return null;
  if (slice.every((byte) => byte === 0)) return null;
  return encodeBase58(slice);
}

/**
 * Decode a stake account, or return null when it is not one this scan shows.
 *
 * Null means "not a position we can describe" — the wrong size, a state we do
 * not recognise, or bytes too short to hold the fields. It never means the
 * account is empty, and a caller must not read it as "nothing is staked".
 */
export function parseStakeAccount(
  data: Uint8Array,
  currentEpoch: number,
): ParsedStakeAccount | null {
  if (data.length < STAKE_ACCOUNT_SIZE) return null;
  const view = Buffer.from(data);

  const tag = view.readUInt32LE(STAKE_TAG_OFFSET);
  // 0 = Uninitialized, 3 = RewardsPool (protocol-owned, not a wallet position).
  if (tag !== STAKE_TAG_DELEGATED && tag !== STAKE_TAG_INITIALIZED) return null;

  const withdrawer = readStakePubkey(view, STAKE_WITHDRAWER_OFFSET);
  if (!withdrawer) return null;

  // Initialized but never delegated: the SOL is there, earning nothing yet.
  if (tag === STAKE_TAG_INITIALIZED) {
    return {
      withdrawer,
      state: "inactive",
      lamports: "0",
      validator: null,
      activationEpoch: null,
      deactivationEpoch: null,
    };
  }

  const lamports = view.readBigUInt64LE(STAKE_AMOUNT_OFFSET);
  const activationEpoch = Number(view.readBigUInt64LE(STAKE_ACTIVATION_OFFSET));
  const rawDeactivation = view.readBigUInt64LE(STAKE_DEACTIVATION_OFFSET);
  const deactivating = rawDeactivation !== NOT_DEACTIVATING;
  const deactivationEpoch = deactivating ? Number(rawDeactivation) : null;

  let state: StakeAccountState;
  if (deactivating && currentEpoch >= Number(rawDeactivation)) {
    // Fully deactivated: idle SOL sitting in the account, waiting to be withdrawn.
    state = "inactive";
  } else if (deactivating) {
    state = "deactivating";
  } else if (currentEpoch >= activationEpoch) {
    state = "active";
  } else {
    state = "activating";
  }

  return {
    withdrawer,
    state,
    lamports: lamports.toString(),
    validator: readStakePubkey(view, STAKE_VOTER_OFFSET),
    activationEpoch,
    deactivationEpoch,
  };
}
