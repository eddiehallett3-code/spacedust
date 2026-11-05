/**
 * The cleanup score: one number for how much of a wallet is lying idle.
 *
 * WHY THIS EXISTS. The scan answers "what is in here" with a dozen cards, and a
 * dozen cards do not add up to a verdict. A single number does, and it is the one
 * thing a person can repeat to a friend or compare month to month.
 *
 * WHAT IT IS NOT. It is not a safety rating, a credit score or a judgement of the
 * person holding the wallet. It counts only what this app can fix, every point is
 * attributed to a named factor in the UI, and a wallet that scores badly is one
 * with work available — not a bad wallet.
 *
 * The scoring is a pure function of facts the scan already fetched, so it costs no
 * extra request and cannot drift from what the page says.
 *
 * HOW THE WEIGHTS WERE CHOSEN. Not from data: there is no cohort to fit yet. They
 * encode a plain argument about what matters, in this order — money you cannot see
 * (rent), things that cannot be sold (dead weight), things that can be taken from
 * you (danger hazards), and door keys left in the lock (approvals). The caps are
 * 30/25/25/20, summing to 100: no single factor can own the score, and a wallet has
 * to be failing on every axis at once to reach zero.
 */

/** A holding, reduced to the facts the score needs. */
export interface ScoreToken {
  valueUsd: number;
  /** True when the price API had nothing reliable for this mint. */
  hasNoPrice: boolean;
  /** True when a program controls the mint — a pool share or a receipt. */
  poolLike: boolean;
  /** True when it is a recognised staking token. */
  staked?: boolean;
  /** True when the issuer has frozen this holding. */
  frozen?: boolean;
  /** Mint hazards, as read from the mint account. */
  hazards?: { severity: "danger" | "warning" }[];
}

export interface CleanupScoreInput {
  tokens: ScoreToken[];
  /** Rent sitting in accounts that are already empty, and reachable today. */
  emptyRentLamports: number;
  /** Spare lamports above rent-exempt in Token-2022 accounts, reachable today. */
  excessRentLamports?: number;
  /** Standing approvals, or null when they were not read. */
  approvalsCount?: number | null;
  /** SOL price, for converting idle rent into a comparable figure. */
  solPriceUsd?: number | null;
}

export type CleanupFactorKey = "idle-rent" | "dead-weight" | "at-risk" | "approvals";

export interface CleanupFactor {
  key: CleanupFactorKey;
  /** What the factor is, in the words a person would use. */
  label: string;
  /** Points this factor removed from 100. */
  points: number;
  /** Its ceiling, so the UI can show the weight honestly. */
  max: number;
  /** One line saying what was counted. */
  detail: string;
  /** The tool that clears it. */
  fix: string;
}

export interface CleanupScore {
  /** 0–100, where 100 is nothing to do. */
  score: number;
  band: { label: string; tone: "success" | "warning" | "danger" };
  factors: CleanupFactor[];
}


const MAX_IDLE_RENT = 30;
const MAX_DEAD_WEIGHT = 25;
const MAX_AT_RISK = 25;
const MAX_APPROVALS = 20;

/** Points per item, before the caps. */
const POINTS_PER_UNSELLABLE = 2;
const POINTS_PER_DANGER = 5;
const POINTS_PER_APPROVAL = 4;

/**
 * Idle rent, scored on value rather than lamports.
 *
 * $50 recoverable is where the deduction maxes out: below that it is pocket change
 * and the score should not shout, above it somebody is leaving real money in
 * accounts they have forgotten. With no SOL price the lamport figure is used at
 * 0.25 SOL for the full deduction — the same order of magnitude, so a missing price
 * degrades the input instead of switching the factor off.
 */
function idleRentPoints(lamports: number, solPriceUsd: number | null): number {
  if (lamports <= 0) return 0;
  if (solPriceUsd && solPriceUsd > 0) {
    const usd = (lamports / 1e9) * solPriceUsd;
    return Math.min(MAX_IDLE_RENT, Math.round((usd / 50) * MAX_IDLE_RENT));
  }
  return Math.min(MAX_IDLE_RENT, Math.round((lamports / 2.5e8) * MAX_IDLE_RENT));
}

function bandFor(score: number): CleanupScore["band"] {
  if (score >= 90) return { label: "Tidy", tone: "success" };
  if (score >= 70) return { label: "Light cleanup", tone: "success" };
  if (score >= 40) return { label: "Cluttered", tone: "warning" };
  return { label: "Mostly stuck", tone: "danger" };
}

/**
 * Dead weight: holdings with no price and no market.
 *
 * Pool shares and staking positions are excluded on purpose. Both are unpriced,
 * neither is dust, and both are already working for their owner — scoring them as
 * mess would tell people off for using the ecosystem properly.
 */
function isDeadWeight(token: ScoreToken): boolean {
  if (token.poolLike || token.staked) return false;
  if (token.frozen) return false;
  return token.hasNoPrice || token.valueUsd <= 0;
}

const trim = (lamports: number): string =>
  (lamports / 1e9).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

export function scoreWallet(input: CleanupScoreInput): CleanupScore {
  const solPriceUsd = input.solPriceUsd ?? null;

  const idleLamports =
    Math.max(0, input.emptyRentLamports) + Math.max(0, input.excessRentLamports ?? 0);
  const idlePoints = idleRentPoints(idleLamports, solPriceUsd);

  const deadWeight = input.tokens.filter(isDeadWeight).length;
  const deadWeightPoints = Math.min(MAX_DEAD_WEIGHT, deadWeight * POINTS_PER_UNSELLABLE);

  const atRisk = input.tokens.filter(
    (token) =>
      (token.hazards ?? []).some((hazard) => hazard.severity === "danger") &&
      token.valueUsd >= 1,
  ).length;
  const atRiskPoints = Math.min(MAX_AT_RISK, atRisk * POINTS_PER_DANGER);

  // Null means "not read", which is not the same as zero and must not be scored as
  // though it were. A scan that skipped approvals simply does not judge them.
  const approvals =
    typeof input.approvalsCount === "number" ? Math.max(0, input.approvalsCount) : null;
  const approvalPoints =
    approvals === null ? 0 : Math.min(MAX_APPROVALS, approvals * POINTS_PER_APPROVAL);

  const factors: CleanupFactor[] = [
    {
      key: "idle-rent",
      label: "Rent left in empty accounts",
      points: idlePoints,
      max: MAX_IDLE_RENT,
      detail:
        idleLamports > 0
          ? `${trim(idleLamports)} SOL sitting in accounts you can close.`
          : "Nothing sitting idle.",
      fix: "Salvage",
    },
    {
      key: "dead-weight",
      label: "Holdings with no market",
      points: deadWeightPoints,
      max: MAX_DEAD_WEIGHT,
      detail:
        deadWeight > 0
          ? `${deadWeight} holding${deadWeight === 1 ? "" : "s"} no swapper will price.`
          : "Everything here has a market.",
      fix: "The Void",
    },
    {
      key: "at-risk",
      label: "Value a mint can still move",
      points: atRiskPoints,
      max: MAX_AT_RISK,
      detail:
        atRisk > 0
          ? `${atRisk} holding${atRisk === 1 ? "" : "s"} whose mint keeps a freeze or delegate power.`
          : "No issuing powers over what you hold.",
      fix: "Burn or sell",
    },
    {
      key: "approvals",
      label: "Standing approvals",
      points: approvalPoints,
      max: MAX_APPROVALS,
      detail:
        approvals === null
          ? "Not checked on this scan."
          : approvals > 0
            ? `${approvals} account${approvals === 1 ? "" : "s"} somebody else can move.`
            : "Nothing can move your tokens but you.",
      fix: "Approvals",
    },
  ];

  const deducted = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.max(0, 100 - deducted);

  return { score, band: bandFor(score), factors };
}
