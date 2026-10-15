"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, KeyRound, Layers, Unplug, Zap } from "lucide-react";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { TOKEN_ACCOUNT_RENT_LAMPORTS } from "@/lib/utils/constants";

/**
 * Hero.
 *
 * Leads with the things that matter to someone deciding whether to connect a
 * wallet to an unfamiliar site: it is non-custodial, it batches everything into
 * as few signatures as possible, and it shows its work.
 *
 * Fees are deliberately not headlined here. A rate quoted in a hero is a claim
 * with nothing behind it; the flow states the fee against the real number it is
 * taken from, which is also the only place a user can actually judge it.
 */
export function Hero() {
  return (
    <section className="pb-10 pt-14 sm:pt-18 lg:pt-20">
      <div className="mx-auto max-w-3xl text-center">
        {/* The same header every tool gets: the mark centred above the title, at
            the same size, in the same font. Slingshot used to be the other
            outlier — a wordmark at `text-4xl`–`7xl` with a trajectory bending
            around its O — so this hero and the tool pages set their titles
            differently and neither matched.

            The wordmark and its backdrop are kept in the repo, unused, so this is
            one line to undo. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 flex justify-center"
        >
          <ToolEmblem tool="slingshot" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl"
        >
          Slingshot
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg"
        >
          Clean out your Solana dust. Slingshot swaps leftover tokens into SOL,
          USDC or JUP in as few transactions as possible — reclaiming the locked
          rent from every emptied account along the way.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 flex justify-center"
        >
          <Link
            href="/security"
            className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/8 px-3 py-1 text-xs text-emerald-300 transition-colors hover:bg-success/14"
          >
            <KeyRound className="size-3" aria-hidden />
            Non-custodial · you sign everything
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.34, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 flex flex-col items-center gap-3"
        >
          <ConnectWalletCta size="lg" />
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-5">
            {/* The read-only scan exists so a cautious user never has to connect
                to find out whether this is worth their time. */}
            <Link
              href="/scan"
              className="group inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
            >
              Or run a Wallet Scan first
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
            <Link
              href="/how-it-works"
              className="group inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
            >
              How it works
              <ArrowRight
                className="size-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Value props */}
      <motion.ul
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-14 grid max-w-4xl gap-3 sm:grid-cols-3"
      >
        {[
          {
            icon: <Layers className="size-4" aria-hidden />,
            title: "Fewest signatures",
            body: "Swaps are packed into as few transactions as the 1232-byte limit allows.",
          },
          {
            icon: <Unplug className="size-4" aria-hidden />,
            title: "Rent reclaimed",
            // Derived, not hand-typed. This used to say "~0.002 SOL", which was
            // the old rent-exempt minimum — the same stale figure that once
            // overstated every rent label and inflated The Void's fee by 37%.
            body: `Emptied token accounts are closed in the same flow, returning ~${(
              TOKEN_ACCOUNT_RENT_LAMPORTS / 1e9
            ).toFixed(4)} SOL each.`,
          },
          {
            icon: <Zap className="size-4" aria-hidden />,
            title: "Simulated first",
            body: "Every transaction is dry-run before you are asked to approve anything.",
          },
        ].map((item) => (
          <li
            key={item.title}
            className="glass rounded-2xl p-4 text-left transition-colors hover:border-border-strong"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-core/12 text-violet-glow ring-1 ring-inset ring-violet-core/20">
              {item.icon}
            </span>
            <p className="mt-3 text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </motion.ul>
    </section>
  );
}