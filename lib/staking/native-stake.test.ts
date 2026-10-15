import { describe, expect, it } from "vitest";
import {
  STAKE_DEACTIVATION_OFFSET,
  parseStakeAccount,
  readStakePubkey,
} from "@/lib/staking/native-stake";

/**
 * A real mainnet stake account, frozen as a fixture — the measured layout.
 *
 * Read from chain with `probes/tmp-stake-parser-check.mjs`, which also confirmed the
 * field at offset 124 is owned by the Vote program. That check is the one that
 * mattered: a 48-byte `Lockup` sits between the withdrawer and the delegation,
 * so the obvious "voter at 76" reads a run of zeroes and matches nothing.
 *
 *   withdrawer    DC9TahF5ofBt6oCmnQyrG9AgaT2q7q78hrXepNf995MR
 *   voter        7tKWFaaLi2FJSqukHxUrnXph8M3ynrqn3kEkKPpgcNHZ  (a real vote account)
 *   stake         422844427 lamports
 *   activation    epoch 986, not deactivating
 *
 * Offline on purpose: the offsets are the thing under test, and a fixture that
 * needs the network cannot run in CI.
 */
const REAL_HEX =
  "0200000080d5220000000000b5273222624e0543aa00d95760d19cb96fb1c3ff8488a0d60b3f767d04b43e70b5273222624e0543aa00d95760d19cb96fb1c3ff8488a0d60b3f767d04b43e70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000664baa6dcbee9a546259a6440805fc8e0fdb201ffb67f2af57c8168fa37e707c0b18341900000000da03000000000000ffffffffffffffff000000000000d03f5540f9500000000000000000";

const WITHDRAWER = "DC9TahF5ofBt6oCmnQyrG9AgaT2q7q78hrXepNf995MR";
const VOTER = "7tKWFaaLi2FJSqukHxUrnXph8M3ynrqn3kEkKPpgcNHZ";

function fixture(): Buffer {
  return Buffer.from(REAL_HEX, "hex");
}

describe("parseStakeAccount", () => {
  it("decodes a real delegated account, field for field", () => {
    expect(parseStakeAccount(fixture(), 1000)).toEqual({
      withdrawer: WITHDRAWER,
      state: "active",
      lamports: "422844427",
      validator: VOTER,
      activationEpoch: 986,
      deactivationEpoch: null,
    });
  });

  it("is still 'activating' before its activation epoch", () => {
    expect(parseStakeAccount(fixture(), 985)?.state).toBe("activating");
    expect(parseStakeAccount(fixture(), 986)?.state).toBe("active");
  });

  it("winds down through 'deactivating' to idle", () => {
    const winding = fixture();
    // The account is not deactivating (`u64::MAX`); give it a real epoch.
    winding.writeBigUInt64LE(1_200n, STAKE_DEACTIVATION_OFFSET);

    expect(parseStakeAccount(winding, 1_100)?.state).toBe("deactivating");
    expect(parseStakeAccount(winding, 1_100)?.deactivationEpoch).toBe(1_200);
    expect(parseStakeAccount(winding, 1_200)?.state).toBe("inactive");
    expect(parseStakeAccount(winding, 1_400)?.state).toBe("inactive");
  });

  it("refuses an account that is not a wallet position", () => {
    // Too short to hold the fields.
    expect(parseStakeAccount(fixture().subarray(0, 199), 1000)).toBeNull();

    // Uninitialized (0) and RewardsPool (3) — the latter is protocol-owned.
    for (const tag of [0, 3]) {
      const other = fixture();
      other.writeUInt32LE(tag, 0);
      expect(parseStakeAccount(other, 1000)).toBeNull();
    }
  });

  it("reports an Initialized account as idle rather than missing", () => {
    // SOL that is in a stake account but not delegated yet: real, earning
    // nothing. Reporting null here would hide it; reporting a validator would
    // invent one.
    const initialized = fixture();
    initialized.writeUInt32LE(1, 0);

    expect(parseStakeAccount(initialized, 1000)).toEqual({
      withdrawer: WITHDRAWER,
      state: "inactive",
      lamports: "0",
      validator: null,
      activationEpoch: null,
      deactivationEpoch: null,
    });
  });
});

describe("readStakePubkey", () => {
  it("encodes a real field exactly as the chain reports it", () => {
    // The encoder is hand-rolled (this module stays dependency-free), so it is
    // checked against an address read from mainnet rather than against itself.
    expect(readStakePubkey(fixture(), 44)).toBe(WITHDRAWER);
    expect(readStakePubkey(fixture(), 124)).toBe(VOTER);
  });

  it("treats an all-zero field as absent, not as an address", () => {
    // Every normal account's Lockup custodian is zero. Rendering that as
    // "11111111111111111111111111111111" would invent a custodian.
    expect(readStakePubkey(new Uint8Array(32), 0)).toBeNull();
  });

  it("returns null when there are not 32 bytes to read", () => {
    expect(readStakePubkey(new Uint8Array(10), 0)).toBeNull();
  });
});
