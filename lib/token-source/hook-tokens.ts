import type { DustToken, HookVerdict } from "@/types/token";

/**
 * Transfer-hook tokens, and what can honestly be done with them.
 *
 * A Token-2022 mint can carry a **transfer hook** extension: a program id that
 * the token program calls on every transfer (and on burn and mint-to). When a
 * hook program is set, Solana's routers — Jupiter, and therefore Slingshot —
 * will not build a swap, because the transfer would run code whose effects
 * nobody can predict from the quote alone. That is exactly the symptom a
 * holder sees: a token in their wallet that no swapper will touch.
 *
 * The distinction this module exists to draw is between the two states that
 * both get flagged `hasTransferHook` by the scanner:
 *
 *  - **inert** — the extension is present but its program id is the all-zeros
 *    default. No program runs. The token transfers and burns like any other,
 *    and the reason a swap fails is a router limitation, not a property of the
 *    token. These are recoverable: send them to The Void and take the rent.
 *  - **active** — a real hook program is set. Every transfer runs it, so this
 *    app will not move or burn them: that is a decision, not an oversight.
 *
 * A third state, **frozen**, outranks both: the issuer's freeze authority has
 * locked the account, so nothing can move it at all.
 *
 * This file is pure — no RPC, no React — so the classification can be tested
 * and so both the read-only scan and the sweeper can share one answer.
 */

/** The all-zeros key, which is how an unset pubkey is stored on chain. */
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

/**
 * Classify one transfer-hook holding from the two facts that decide it.
 *
 * `hookProgram` is the program id from the mint's TransferHook extension, or
 * null when we could not read it. A null/zero program id with a live extension
 * is the `inert` case; anything else non-null is `active`. Frozen always wins,
 * and an unreadable mint is `unknown` rather than a guess.
 */
export function classifyTransferHook(input: {
  /** The extension's program id, or null when it was not read. */
  hookProgram: string | null | undefined;
  /** True when the holding's account is frozen. */
  frozen: boolean;
  /** False when the mint could not be read at all. */
  readable?: boolean;
}): HookVerdict {
  if (input.readable === false) return "unknown";
  if (input.frozen) return "frozen";

  // No program id read, or the zero key: the extension is present but inert.
  if (input.hookProgram == null || input.hookProgram === DEFAULT_PUBKEY) {
    return "inert";
  }

  return "active";
}

/** The copy and the affordances each verdict implies. */
export interface HookVerdictDescription {
  /** Short label for a badge. */
  label: string;
  /** One sentence a holder can act on. */
  detail: string;
  /** Should we offer it to The Void (burn + reclaim rent)? */
  voidable: boolean;
  /** Is this something the holder needs to worry about? */
  alarming: boolean;
}

/**
 * The single source of truth for what each verdict means, in words and in what
 * the UI is allowed to offer. Kept beside the classifier so a new verdict
 * cannot be added without a description to go with it.
 */
export function describeHookVerdict(
  verdict: HookVerdict,
): HookVerdictDescription {
  switch (verdict) {
    case "inert":
      return {
        label: "Hook extension, no program",
        detail:
          "This token has a transfer-hook extension but no hook program is set, so nothing runs on a transfer. Swappers refuse it anyway. It can be burned in The Void to reclaim its rent.",
        voidable: true,
        alarming: false,
      };
    case "active":
      return {
        label: "Live transfer hook",
        detail:
          "A hook program runs on every transfer of this token, so no swapper can quote it and this app will not move or burn it. Only the program's own author can change that.",
        voidable: false,
        alarming: false,
      };
    case "frozen":
      return {
        label: "Frozen by issuer",
        detail:
          "The issuer's freeze authority has locked this account. It cannot be transferred, burned or closed until that authority releases it.",
        voidable: false,
        alarming: true,
      };
    case "unknown":
      return {
        label: "Could not read",
        detail:
          "The mint could not be read to confirm what its hook does. Nothing here will act on it.",
        voidable: false,
        alarming: false,
      };
  }
}

/**
 * The hook tokens in a list of holdings, split into what the app can offer.
 *
 * `recoverable` are the ones The Void can genuinely burn (inert, not frozen);
 * `stuck` are the rest. This is the one function the flows call to decide what
 * to put in front of a holder, so the count in a summary and the rows in a
 * list can never disagree.
 */
export function partitionHookTokens<T extends Pick<DustToken, "mint" | "frozen" | "hookFacts">>(
  tokens: ReadonlyArray<T>,
): { recoverable: T[]; stuck: T[] } {
  const recoverable: T[] = [];
  const stuck: T[] = [];

  for (const token of tokens) {
    const verdict =
      token.hookFacts?.verdict ??
      classifyTransferHook({ hookProgram: null, frozen: token.frozen });

    if (verdict === "inert" && !token.frozen) recoverable.push(token);
    else stuck.push(token);
  }

  return { recoverable, stuck };
}
