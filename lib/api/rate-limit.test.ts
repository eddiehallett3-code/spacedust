import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "@/lib/api/rate-limit";

/**
 * The budgets that stand between the app and somebody else's API key.
 *
 * The unit under test is the arithmetic, not the wiring: an injected clock means
 * the window can be moved forward, which is the only way to test that a budget
 * comes back — and a limit that never resets is a limit that locks users out an
 * hour after launch.
 *
 * `tokens` is used for the counting tests because its budget is 30/min, the
 * smallest here: the numbers stay readable and the rule is the same for every
 * route.
 */

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

describe("createRateLimiter", () => {
  it("allows a client up to its budget, then refuses", () => {
    const check = createRateLimiter();

    for (let i = 0; i < 30; i += 1) {
      expect(check("tokens", "203.0.113.9", T0).allowed).toBe(true);
    }

    const refused = check("tokens", "203.0.113.9", T0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns the budget when the window turns over", () => {
    const check = createRateLimiter();

    for (let i = 0; i < 30; i += 1) check("tokens", "203.0.113.9", T0);
    expect(check("tokens", "203.0.113.9", T0).allowed).toBe(false);

    // Exactly one window later. Not one millisecond before — the boundary is the
    // interesting part, and the comparison behind it is strict.
    expect(check("tokens", "203.0.113.9", T0 + MINUTE - 1).allowed).toBe(false);
    expect(check("tokens", "203.0.113.9", T0 + MINUTE).allowed).toBe(true);
  });

  it("does not spend one client's budget on another", () => {
    const check = createRateLimiter();

    for (let i = 0; i < 30; i += 1) check("tokens", "203.0.113.9", T0);

    expect(check("tokens", "203.0.113.9", T0).allowed).toBe(false);
    expect(check("tokens", "198.51.100.7", T0).allowed).toBe(true);
  });

  it("does not spend one route's budget on another", () => {
    const check = createRateLimiter();

    for (let i = 0; i < 30; i += 1) check("tokens", "203.0.113.9", T0);

    expect(check("tokens", "203.0.113.9", T0).allowed).toBe(false);
    expect(check("asset-proof", "203.0.113.9", T0).allowed).toBe(true);
  });

  it("clamps a flood of rotating keys at the per-route ceiling", () => {
    // The attack the per-client budget cannot stop, and the reason the ceiling
    // exists: a fresh key on every request. 50 client-budgets' worth gets through
    // and the rest are refused, so an unbounded loop cannot run unbounded.
    const check = createRateLimiter();

    let allowed = 0;
    for (let i = 0; i < 2_000; i += 1) {
      if (check("tokens", `10.0.${Math.floor(i / 250)}.${i % 250}`, T0).allowed) {
        allowed += 1;
      }
    }

    expect(allowed).toBe(30 * 50);
  });
});

describe("clientKey", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("https://spacedust.cc/api/rpc", { headers });

  it("prefers the header the platform sets, which a client cannot choose", () => {
    expect(
      clientKey(
        withHeaders({
          "x-real-ip": "198.51.100.7",
          "x-forwarded-for": "203.0.113.9",
        }),
      ),
    ).toBe("198.51.100.7");
  });

  it("counts a client against the hop our proxy appended, not the one it claimed", () => {
    // A caller can prepend anything to `x-forwarded-for`; only the last entry was
    // written by the proxy in front of us. Reading the first gave every request a
    // fresh bucket just by changing the prefix, which is no budget at all.
    expect(
      clientKey(withHeaders({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" })),
    ).toBe("70.41.3.18");
  });

  it("pools requests with no forwarding information rather than exempting them", () => {
    expect(clientKey(withHeaders({}))).toBe("unknown");
  });
});
