import { describe, expect, it } from "vitest";
import {
  TEST_TRANSFER_LAMPORTS,
  destinationDrift,
  destinationIsVerified,
  parseScannedDestination,
  validateDestination,
  type Verification,
} from "./destination";

/**
 * The destination rules, which are the whole safety story of a batch send.
 *
 * Two of these are not opinions: sending to your own wallet was measured failing
 * with `Custom: 11` (NonNativeHasBalance) — the balance never leaves the account,
 * so the rent-reclaim close has nothing to close — and the test transfer's size
 * is a fixed cost that has to stay small enough to be a mistake rather than a
 * loss.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const OTHER = "1nc1nerator11111111111111111111111111111111";
const THIRD = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const verified = (address: string): Verification => ({
  address,
  signature: "5" + "k".repeat(80),
  lamports: TEST_TRANSFER_LAMPORTS,
  arrived: true,
});

describe("validateDestination", () => {
  it("refuses an empty field", () => {
    const result = validateDestination("   ", OWNER);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("empty");
  });

  it("refuses something that is not an address", () => {
    const result = validateDestination("not-an-address", OWNER);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("invalid");
    expect(result.message).toMatch(/not a valid Solana address/i);
  });

  it("refuses the sending wallet itself, with the reason why", () => {
    const result = validateDestination(OWNER, OWNER);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe("self");
    // The message has to say why, because "you cannot send to yourself" reads
    // like a limitation rather than a consequence of how a close works.
    expect(result.message).toMatch(/cannot be completed/i);
    expect(result.message).toMatch(/no rent to reclaim/i);
  });

  it("accepts any other valid address", () => {
    const result = validateDestination(OTHER, OWNER);
    expect(result).toEqual({ ok: true, address: OTHER });
  });

  it("trims before judging, so a pasted newline is not an error", () => {
    const result = validateDestination(`  ${OTHER}\n`, OWNER);
    expect(result.ok).toBe(true);
    expect(result.address).toBe(OTHER);
  });

  it("does not judge ownership when no wallet is connected", () => {
    const result = validateDestination(OWNER, null);
    expect(result.ok).toBe(true);
  });
});

describe("destinationIsVerified", () => {
  it("allows anything valid when verification is switched off", () => {
    expect(destinationIsVerified(null, OTHER, false)).toBe(true);
  });

  it("requires a verification when it is switched on", () => {
    expect(destinationIsVerified(null, OTHER, true)).toBe(false);
  });

  it("allows the address that was verified", () => {
    expect(destinationIsVerified(verified(OTHER), OTHER, true)).toBe(true);
  });

  it("refuses a different address, even though it is verified somewhere", () => {
    expect(destinationIsVerified(verified(OTHER), THIRD, true)).toBe(false);
  });
});

describe("destinationDrift", () => {
  it("says nothing when there is no verification to drift from", () => {
    const drift = destinationDrift(null, OTHER);
    expect(drift.drifted).toBe(false);
    expect(drift.message).toBeNull();
  });

  it("says nothing while the address is unchanged", () => {
    expect(destinationDrift(verified(OTHER), OTHER).drifted).toBe(false);
  });

  it("ignores whitespace around an otherwise identical address", () => {
    expect(destinationDrift(verified(OTHER), ` ${OTHER} `).drifted).toBe(false);
  });

  it("reports a change with both addresses, so the warning can name them", () => {
    const drift = destinationDrift(verified(OTHER), THIRD);
    expect(drift.drifted).toBe(true);
    expect(drift.from).toBe(OTHER);
    expect(drift.to).toBe(THIRD);
    expect(drift.message).toMatch(/will not be built until/i);
  });

  it("does not claim drift while the field is empty", () => {
    // Clearing the field is how someone starts over; it is not a mismatch.
    expect(destinationDrift(verified(OTHER), "").drifted).toBe(false);
  });
});

/**
 * The scan pipeline, end to end, without a camera.
 *
 * A camera cannot be driven from a test, so the riskiest half is proved another
 * way: a real QR code is *encoded* with the `qrcode` dependency already in the
 * project, painted into pixels, and decoded by the same jsqr call the scanner
 * makes. That covers the two things that could silently be wrong — a
 * CommonJS/ESM interop mistake in how jsqr is imported, and a payload shape the
 * decoder returns differently from what the parser expects — both of which would
 * otherwise only be discovered on somebody's phone.
 */
async function decodeEncodedCode(text: string): Promise<string | null> {
  const [{ default: QRCode }, { default: jsQR }] = await Promise.all([
    import("qrcode"),
    import("jsqr"),
  ]);

  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const scale = 8;
  const quiet = 4;
  const side = (count + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!qr.modules.data[row * count + column]) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const pixel =
            ((row + quiet) * scale + y) * side + (column + quiet) * scale + x;
          pixels[pixel * 4] = 0;
          pixels[pixel * 4 + 1] = 0;
          pixels[pixel * 4 + 2] = 0;
        }
      }
    }
  }

  const found = jsQR(pixels, side, side, { inversionAttempts: "attemptBoth" });
  return found ? found.data : null;
}

describe("a scanned code, end to end", () => {
  it("decodes a wallet's own receive code into the address field", async () => {
    const decoded = await decodeEncodedCode(THIRD);

    expect(decoded).toBe(THIRD);
    expect(parseScannedDestination(decoded ?? "")).toEqual({
      ok: true,
      address: THIRD,
      source: "address",
    });
  });

  it("decodes a Solana Pay request and still lands on just the address", async () => {
    const decoded = await decodeEncodedCode(`solana:${THIRD}?amount=1.25`);

    // The decoder returns the whole request; the parser is what refuses to act
    // on the amount inside it.
    expect(decoded).toBe(`solana:${THIRD}?amount=1.25`);
    expect(parseScannedDestination(decoded ?? "")).toEqual({
      ok: true,
      address: THIRD,
      source: "payment",
    });
  });

  it("decodes an explorer link", async () => {
    const decoded = await decodeEncodedCode(`https://solscan.io/account/${THIRD}`);

    expect(parseScannedDestination(decoded ?? "")).toMatchObject({
      ok: true,
      address: THIRD,
      source: "link",
    });
  });

  it("resolves the decoder through whichever interop path the bundler takes", async () => {
    // jsqr ships a CommonJS bundle whose default export is the function *and*
    // which carries a `.default` property. Both are callable, and this pins the
    // import down so a dependency bump cannot quietly turn it into an object.
    const decoderModule = await import("jsqr");
    expect(typeof decoderModule.default).toBe("function");
  });
});

describe("the test transfer", () => {
  it("is small enough to be a mistake rather than a loss, and big enough to see", () => {
    expect(TEST_TRANSFER_LAMPORTS).toBe(1_000_000);
    expect(TEST_TRANSFER_LAMPORTS / 1_000_000_000).toBeCloseTo(0.001, 9);
  });
});

/**
 * Scanning a QR code.
 *
 * The rule these pin down is that a scan ends with an address or a *reason*:
 * never a blank field, and never a guess at what the code meant. A QR is opaque
 * until decoded, so the reason is the only thing standing between a user and
 * "it didn't work".
 */
describe("parseScannedDestination", () => {
  it("reads a bare address, which is what a wallet's receive code holds", () => {
    expect(parseScannedDestination(THIRD)).toEqual({
      ok: true,
      address: THIRD,
      source: "address",
    });
  });

  it("tolerates the whitespace a scanner or a paste brings with it", () => {
    expect(parseScannedDestination(`  ${THIRD}\n`)).toMatchObject({ ok: true });
  });

  it("reads a Solana Pay request and drops its parameters", () => {
    // The amount in the code is not ours to apply: this field is a destination,
    // and acting on a scanned amount would be making a decision for the user.
    const result = parseScannedDestination(
      `solana:${THIRD}?amount=1.5&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
    );

    expect(result).toEqual({ ok: true, address: THIRD, source: "payment" });
  });

  it("reads an explorer link, with or without a scheme", () => {
    for (const code of [
      `https://solscan.io/account/${THIRD}`,
      `solscan.io/account/${THIRD}`,
      `https://explorer.solana.com/address/${THIRD}`,
    ]) {
      expect(parseScannedDestination(code)).toEqual({
        ok: true,
        address: THIRD,
        source: "link",
      });
    }
  });

  it("takes the last path segment, so a query cannot smuggle a second address", () => {
    // Otherwise a code could carry one address in its path and another in its
    // query, and which one got used would be a guess.
    const result = parseScannedDestination(
      `https://example.com/pay/${THIRD}?to=${OWNER}`,
    );

    expect(result).toMatchObject({ ok: true, address: THIRD });
  });

  it("refuses a link whose address is only in the query", () => {
    expect(
      parseScannedDestination(`https://example.com/pay?to=${THIRD}`),
    ).toMatchObject({ ok: false });
  });

  it("names a code from another chain, rather than calling it unreadable", () => {
    const result = parseScannedDestination(
      "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    );

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.problem).toMatch(/different chain/i);
  });

  it("refuses an empty code", () => {
    expect(parseScannedDestination("   ")).toMatchObject({ ok: false });
  });

  it("refuses text that is not an address at all", () => {
    expect(parseScannedDestination("hello world")).toMatchObject({
      ok: false,
    });
    expect(parseScannedDestination("https://example.com")).toMatchObject({
      ok: false,
    });
  });

  it("refuses an address-shaped string of the wrong length", () => {
    // Base58 and address-shaped, but not 32 bytes — the shape alone is not
    // enough, which is why the extract is validated rather than trusted.
    expect(parseScannedDestination("9xQeWvG816bUx9EPjHmaT23yvVM")).toMatchObject({
      ok: false,
    });
  });

  it("refuses a payment request whose address is not one", () => {
    expect(parseScannedDestination("solana:not-an-address")).toMatchObject({
      ok: false,
    });
  });

  it("refuses a code far too long to be an address or a link", () => {
    const result = parseScannedDestination(`https://example.com/${"x".repeat(600)}`);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.problem).toMatch(/far longer/i);
  });
});
