import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@/lib/utils/constants";
import { swapFeeAccount } from "./fee-account";

/**
 * The three addresses below are not invented. `probes/tmp-direct-fee-probe.mjs` derived
 * them for the fee wallet this project runs against, and the same probe asked
 * Jupiter for a swap with `platformFeeBps: 50` pointed at the wSOL one — the
 * output fell by **exactly 50.00 bps**, and that account came back named in the
 * returned instructions, writable.
 *
 * The fee wallet held no token accounts at the time, so the derivation could not
 * be cross-checked against chain. What *is* locked here is the part that would
 * rot silently: which token program the address is derived under, and that each
 * output asset gets its own account rather than sharing one.
 *
 * Note the addresses are not asserted to exist. Nothing here may require chain:
 * whether a fee can actually land is checked against RPC at request time, and
 * fails closed (`lib/solana/fee.server.ts`).
 */

const FEE_WALLET = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const OTHER_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

describe("swapFeeAccount", () => {
  it("derives the fee wallet's account for each output asset", () => {
    expect(swapFeeAccount(FEE_WALLET, WSOL)).toBe(
      "FUhpU6nCAYjxNrPgutWNRmumkw9JY7673RWwrVajy44V",
    );
    expect(swapFeeAccount(FEE_WALLET, USDC)).toBe(
      "8TPpyHnupTn1LmEXPdhExA9uzjGLqGStHt3sPkLzQuL6",
    );
    expect(swapFeeAccount(FEE_WALLET, JUP)).toBe(
      "EHbinR7Q5eGfxSaG1q6VVmd5qi5sLN7NzdkDTmPWZ1h5",
    );
  });

  it("is per-mint, so one asset's account is never charged for another", () => {
    const accounts = [WSOL, USDC, JUP].map((mint) =>
      swapFeeAccount(FEE_WALLET, mint),
    );
    expect(new Set(accounts).size).toBe(3);
  });

  it("is per-wallet, so a fee cannot be aimed at the wrong owner", () => {
    expect(swapFeeAccount(OTHER_WALLET, WSOL)).not.toBe(
      swapFeeAccount(FEE_WALLET, WSOL),
    );
  });

  it("derives under the legacy token program, never Token-2022", () => {
    // The token program id is part of the derivation seeds, so this is the
    // difference between charging the fee wallet and charging nobody. Every
    // output asset this app offers is a legacy SPL token; the derived address
    // must therefore be the legacy one.
    const legacy = new PublicKey(
      getAssociatedTokenAddressSync(
        new PublicKey(WSOL),
        new PublicKey(FEE_WALLET),
        true,
        new PublicKey(TOKEN_PROGRAM_ID),
      ),
    );
    const token2022 = getAssociatedTokenAddressSync(
      new PublicKey(WSOL),
      new PublicKey(FEE_WALLET),
      true,
      new PublicKey(TOKEN_2022_PROGRAM_ID),
    );

    expect(swapFeeAccount(FEE_WALLET, WSOL)).toBe(legacy.toBase58());
    expect(swapFeeAccount(FEE_WALLET, WSOL)).not.toBe(token2022.toBase58());
  });
});
