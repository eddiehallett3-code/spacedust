import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/plan/route";
import { MAX_TOKENS_PER_SWEEP } from "@/lib/utils/constants";

/**
 * The boundary of the money path.
 *
 * `/api/plan` turns a browser request into swap instructions, so everything it
 * accepts has to be something this app itself would have sent. These tests cover
 * the **refusals**, which all happen before any upstream call — so they need no
 * network, no key and no market being open, and they still hold when Jupiter is
 * unreachable.
 *
 * What is deliberately not here: composing a real route. That needs an RPC and
 * Jupiter, and a mocked Jupiter would only prove the mock. The rules that decide
 * what a route *means* — the amounts, and which accounts may be closed — are
 * covered directly in `lib/sweep/*.test.ts`, and the provider behaviour was
 * measured against mainnet by the scripts in `probes/`.
 */

const OWNER = "Fq9auFr6JAd5FDZDMFBikzqAycFKMryvkQUB71VTLbqi";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** A real mint that is not one of the three permitted output assets. */
const PENGU = "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv";

function token(overrides: Record<string, unknown> = {}) {
  return { mint: USDC, rawAmount: "1000000", program: "legacy", ...overrides };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    owner: OWNER,
    outputMint: WSOL,
    slippageBps: 100,
    tokens: [token()],
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  // The fee path is server-side config; a developer running the suite with a
  // wallet exported must not change what these tests exercise.
  delete process.env.NEXT_PUBLIC_FEE_WALLET;
});

describe("POST /api/plan — what it refuses", () => {
  it("refuses a body that is not JSON", async () => {
    expect((await post("{ not json")).status).toBe(400);
  });

  it("refuses an owner that is not an address", async () => {
    expect((await post(validBody({ owner: "not an address" }))).status).toBe(400);
  });

  it("refuses an output asset outside the allow-list", async () => {
    // A security boundary, not a UI preference: an open output mint would let a
    // crafted request point a user's dust at a token the attacker issues.
    const response = await post(validBody({ outputMint: PENGU }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Output asset must be SOL, USDC or JUP.",
    });
  });

  it("refuses an empty token list", async () => {
    expect((await post(validBody({ tokens: [] }))).status).toBe(400);
  });

  it("refuses more tokens than a sweep can carry", async () => {
    const tokens = Array.from({ length: MAX_TOKENS_PER_SWEEP + 1 }, () => token());
    expect((await post(validBody({ tokens }))).status).toBe(400);
  });

  it("refuses slippage outside the permitted band", async () => {
    for (const slippageBps of [0, 10_000]) {
      expect((await post(validBody({ slippageBps }))).status).toBe(400);
    }
  });

  it("refuses a mint that is not an address", async () => {
    const response = await post(
      validBody({ tokens: [token({ mint: "not an address" })] }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a swap amount that is not a base-unit string", async () => {
    // By contract the amount is whole base units, so "1.5" is a client bug and
    // not a value to interpret. A float reaching the planner is how an account
    // ends up holding a residue it can never be closed for.
    const response = await post(
      validBody({ tokens: [token({ swapAmountRaw: "1.5" })] }),
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/plan — what it accepts", () => {
  /**
   * Upstream is stubbed to a flat failure. The point of these two is that the
   * *schema* accepted the request; letting them reach a real Jupiter call would
   * make the suite depend on the network and on the market being open, and the
   * assertion would still only be "not a 400".
   */
  function failUpstream(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
  }

  it("parses a partial swap amount", async () => {
    failUpstream();
    const response = await post(
      validBody({ tokens: [token({ swapAmountRaw: "500000" })] }),
    );
    expect(response.status).not.toBe(400);
  });

  it("parses a request with no swap amount at all", async () => {
    // Absent means "the whole balance", which has to keep working: it is the
    // original dust-sweep request shape.
    failUpstream();
    expect((await post(validBody())).status).not.toBe(400);
  });
});
