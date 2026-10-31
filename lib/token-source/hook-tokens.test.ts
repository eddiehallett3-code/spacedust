import { describe, expect, it } from "vitest";
import {
  classifyTransferHook,
  describeHookVerdict,
  partitionHookTokens,
} from "@/lib/token-source/hook-tokens";
import type { DustToken, HookTokenFacts } from "@/types/token";

/**
 * The transfer-hook verdicts.
 *
 * A Token-2022 mint can carry a transfer-hook extension, and the scanner flags
 * every one of them the same way — `hasTransferHook: true`. But two very
 * different holdings hide behind that flag:
 *
 *  - the extension is present with **no program id** (all zeros), so nothing
 *    runs on a transfer and the token can still be burned in The Void;
 *  - a **real program** is set, so every transfer runs it, and neither a swapper
 *    nor this app will move the token.
 *
 * The first is recoverable, the second is not, and telling them apart is the
 * whole job of this module. A blanket "we don't touch hooks" would strand the
 * rent locked under the recoverable ones.
 */

/** The all-zeros key the chain uses for an unset pubkey. */
const ZEROS = "11111111111111111111111111111111";
/** A stand-in for a real deployed hook program. */
const HOOK_PROGRAM = "HookProgram1111111111111111111111111111111";

/** A minimal holding, as `partitionHookTokens` needs it. */
function holding(overrides: Partial<DustToken> & { hookFacts?: HookTokenFacts | null } = {}) {
  return {
    mint: "Mint1111111111111111111111111111111111111",
    frozen: false,
    hookFacts: null,
    ...overrides,
  } as Pick<DustToken, "mint" | "frozen" | "hookFacts">;
}

function facts(verdict: HookTokenFacts["verdict"], hookProgram: string | null = null): HookTokenFacts {
  return {
    mint: "Mint1111111111111111111111111111111111111",
    program: "token2022",
    hookProgram,
    hookAuthority: null,
    verdict,
  };
}

describe("classifyTransferHook", () => {
  it("calls a zeroed program id inert, even though the extension is present", () => {
    // The case the scanner cannot distinguish and that used to make every hook
    // token disappear: extension present, no program to run.
    expect(classifyTransferHook({ hookProgram: ZEROS, frozen: false })).toBe("inert");
    expect(classifyTransferHook({ hookProgram: null, frozen: false })).toBe("inert");
  });

  it("calls a real program active", () => {
    expect(classifyTransferHook({ hookProgram: HOOK_PROGRAM, frozen: false })).toBe(
      "active",
    );
  });

  it("lets frozen outrank both, because nothing can move it", () => {
    expect(classifyTransferHook({ hookProgram: HOOK_PROGRAM, frozen: true })).toBe(
      "frozen",
    );
    expect(classifyTransferHook({ hookProgram: ZEROS, frozen: true })).toBe("frozen");
  });

  it("says unknown rather than guessing when the mint could not be read", () => {
    expect(
      classifyTransferHook({ hookProgram: HOOK_PROGRAM, frozen: false, readable: false }),
    ).toBe("unknown");
  });
});

describe("describeHookVerdict", () => {
  it("only offers The Void for an inert hook", () => {
    expect(describeHookVerdict("inert").voidable).toBe(true);
    expect(describeHookVerdict("active").voidable).toBe(false);
    expect(describeHookVerdict("frozen").voidable).toBe(false);
    expect(describeHookVerdict("unknown").voidable).toBe(false);
  });

  it("only raises alarm for a frozen holding", () => {
    expect(describeHookVerdict("frozen").alarming).toBe(true);
    expect(describeHookVerdict("inert").alarming).toBe(false);
    expect(describeHookVerdict("active").alarming).toBe(false);
  });

  it("gives every verdict its own label", () => {
    const labels = (["inert", "active", "frozen", "unknown"] as const).map(
      (verdict) => describeHookVerdict(verdict).label,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("partitionHookTokens", () => {
  it("puts an inert holding in recoverable and an active one in stuck", () => {
    const inert = holding({ mint: "Inert111", hookFacts: { ...facts("inert"), mint: "Inert111" } });
    const active = holding({ mint: "Active11", hookFacts: { ...facts("active", HOOK_PROGRAM), mint: "Active11" } });

    const { recoverable, stuck } = partitionHookTokens([inert, active]);

    expect(recoverable.map((token) => token.mint)).toEqual(["Inert111"]);
    expect(stuck.map((token) => token.mint)).toEqual(["Active11"]);
  });

  it("keeps a frozen inert token out of recoverable: it cannot be burned", () => {
    const frozen = holding({ mint: "Frozen1", frozen: true, hookFacts: { ...facts("frozen"), mint: "Frozen1" } });

    const { recoverable, stuck } = partitionHookTokens([frozen]);

    expect(recoverable).toHaveLength(0);
    expect(stuck.map((token) => token.mint)).toEqual(["Frozen1"]);
  });

  it("falls back to the frozen flag when a holding has no hook facts", () => {
    const bare = holding({ mint: "Bare111", hookFacts: null });

    const { recoverable, stuck } = partitionHookTokens([bare]);

    // No facts and not frozen reads as inert: recoverable.
    expect(recoverable.map((token) => token.mint)).toEqual(["Bare111"]);
    expect(stuck).toHaveLength(0);
  });
});
