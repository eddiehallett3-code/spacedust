import type { DustToken } from "@/types/token";

/**
 * Can a sweep sell this holding?
 *
 * ONE RULE, BOTH SCREENS
 *
 * The read-only scan promises a number, and the sweeper then has to produce it.
 * Every time the two decide "sellable" differently, the promise is wrong — and
 * that is not hypothetical here: the read-only total excluded program-controlled
 * and staking holdings, while the sweeper's own list did not, so a recognised
 * staking token (mSOL, JitoSOL) could be priced, listed, selected and sold in a
 * dust sweep while the scan said a sweep would not touch it. The bug is silent
 * from both sides: the scan showed a smaller total, the sweeper showed a normal
 * row, and neither contradicted the other out loud.
 *
 * So the rule lives here, once, and both callers import it.
 *
 * WHAT IT EXCLUDES, AND WHY EACH ONE
 *
 *  - **A named staking token** (`staked`). Its value is a claim on staked SOL,
 *    and unwinding it is a deliberate move made in the protocol's own app. It
 *    must not be cashed in on the way past some dust. `staked` is checked first
 *    because it is the *named* answer and nearly always overlaps `poolLike`.
 *  - **A program-controlled mint** (`poolLike`). There is no market to sell a
 *    pool share in; a swap would fail to find a route rather than return value.
 *  - **Frozen** and **transfer-hooked** holdings, which cannot be moved at all,
 *    or cannot be moved without running code whose effects we cannot see.
 *
 * Everything else is sellable, and rent is a separate question — see
 * `summariseRecoverable`, which uses this same answer.
 */
export function isSweepableToken(
  token: Pick<
    DustToken,
    "staked" | "poolLike" | "frozen" | "hasTransferHook"
  >,
): boolean {
  if (token.staked !== null) return false;
  if (token.poolLike) return false;
  if (token.frozen) return false;
  if (token.hasTransferHook) return false;
  return true;
}
