import { HandCoins } from "lucide-react";
import { formatSol } from "@/lib/utils/format";

/**
 * "Spacedust paid the network fee, and took it back out of your rent."
 *
 * Shown only when a plan was sponsored. Two numbers, because they are different
 * things and the user is entitled to both: what the fee cost, and what left
 * their rent to cover it (the fee plus the sponsor's margin).
 *
 * The wording never says "free". The advance is real money moving, just not from
 * the wallet that could not pay — and the deduction is already inside the figure
 * beside it, which is why the last sentence exists.
 */
export function SponsorAdvanceNote({
  feeLamports,
  repaymentLamports,
}: {
  /** The network fee this run would have paid, in lamports. */
  feeLamports: number;
  /** What the same run repays the sponsor, in lamports. 0 means not sponsored. */
  repaymentLamports: number;
}) {
  if (repaymentLamports <= 0) return null;

  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-violet-core/25 bg-violet-core/6 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
      <HandCoins
        className="mt-px size-3.5 shrink-0 text-violet-glow"
        aria-hidden
      />
      <span>
        This wallet cannot cover the {formatSol(feeLamports)} network fee, so
        Spacedust advances it. The same transaction pays back{" "}
        {formatSol(repaymentLamports)} out of the rent it just released — the fee
        plus a small margin — and that repayment is already deducted from{" "}
        <span className="text-foreground">what you receive</span>.
      </span>
    </p>
  );
}
