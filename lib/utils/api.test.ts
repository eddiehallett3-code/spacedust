/**
 * What a rate-limit refusal looks like once the client has parsed it.
 *
 * The budget is only half the defence: a 429 that reaches the user as "Request
 * failed (429)" teaches them nothing, and one that reaches them as "try again
 * shortly" invites the immediate retry the budget exists to stop. So the number
 * has to survive the trip — from the body, or from the header an upstream sends
 * on its own — and the sentence has to say it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiFetch } from "./api";

function respond(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  vi.stubGlobal("fetch", async () => new Response(body, { status, headers }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function refusal(): Promise<ApiRequestError> {
  try {
    await apiFetch("/api/tokens");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiRequestError);
    return error as ApiRequestError;
  }
  throw new Error("expected a refusal");
}

describe("a 429 from our own routes", () => {
  it("carries the wait from the body, which survives a header-stripping proxy", async () => {
    respond(
      429,
      JSON.stringify({
        error: "Too many requests from this address. Try again in 12 seconds.",
        retryAfterSeconds: 12,
      }),
    );

    const error = await refusal();
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(12);
    expect(error.message).toContain("12 seconds");
  });

  it("falls back to the Retry-After header when the body says nothing", async () => {
    respond(429, "", { "retry-after": "30" });

    const error = await refusal();
    expect(error.retryAfterSeconds).toBe(30);
    // The generic "Request failed (429)" is replaced rather than left bare.
    expect(error.message).toBe("Too many requests. Try again in 30 seconds.");
  });

  it("reads an HTTP-date Retry-After as well as delta-seconds", async () => {
    const at = new Date(Date.now() + 45_000).toUTCString();
    respond(429, "", { "retry-after": at });

    const error = await refusal();
    // Date parsing lands within a second of the target; the point is that it is a
    // number and not `NaN`.
    expect(error.retryAfterSeconds).toBeGreaterThan(40);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(45);
  });

  it("still says something useful when the server gives no number at all", async () => {
    respond(429, "");

    const error = await refusal();
    expect(error.retryAfterSeconds).toBeUndefined();
    expect(error.message).toBe("Too many requests. Try again shortly.");
  });

  it("leaves a message that already names the wait alone", async () => {
    respond(429, JSON.stringify({ error: "Slow down, try again in 5 seconds." }));

    const error = await refusal();
    expect(error.message).toBe("Slow down, try again in 5 seconds.");
  });
});
