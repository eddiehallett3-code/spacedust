"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * The refund sentence that sits next to a fee, not only in the footer.
 *
 * A fee is easiest to misunderstand at the moment it is shown. The wording is
 * deliberately narrower than a guarantee: on-chain transactions are final,
 * network fees are non-refundable, and Spacedust's rent fee is only taken when
 * an action completes and rent is reclaimed.
 */
export function RefundNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-subtle", className)}>
      On-chain transactions are irreversible and network fees are
      non-refundable. Spacedust&apos;s fee is taken only when an action completes
      and rent is reclaimed. If a fee was charged in error, contact us.{" "}
      <Link
        href="/refund-policy"
        className="text-violet-glow underline underline-offset-2"
      >
        Refund policy
      </Link>
      .
    </p>
  );
}
