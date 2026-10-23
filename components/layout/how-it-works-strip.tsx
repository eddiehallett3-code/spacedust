"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Ban, CheckCircle2, Coins, Radar, Unplug } from "lucide-react";

const STEPS = [
  {
    icon: Radar,
    title: "Scan",
    body: "Helius indexes every SPL and Token-2022 account in your wallet in one pass. Prices come from Jupiter.",
  },
  {
    icon: Coins,
    title: "Select",
    body: "Set a USD threshold and pick the tokens worth sweeping. A smart filter hides the ones with no liquidity.",
  },
  {
    icon: Unplug,
    title: "Build",
    body: "Each swap is built with closeAccount instructions, so emptied accounts return their rent in the same flow.",
  },
  {
    icon: Ban,
    title: "Simulate",
    body: "The packed transactions are dry-run against the cluster. You see real results before signing anything.",
  },
  {
    icon: CheckCircle2,
    title: "Sign",
    body: "Wallets that support batch signing show one approval for the whole batch. Spacedust never holds a key and cannot move funds itself.",
  },
];

/** Condensed "how it works" strip shown at the bottom of Slingshot's own page. */
export function HowItWorksStrip() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          How Slingshot works
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
          Five steps, and nothing irreversible happens until step five.
        </p>
      </div>

      <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, index) => (
          <motion.li
            key={step.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.35, delay: index * 0.06 }}
            className="glass relative rounded-2xl p-4"
          >
            {/* Connector between steps on desktop. */}
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden
                className="absolute left-[calc(50%+1.5rem)] top-9 hidden h-px w-[calc(100%-3rem)] bg-linear-to-r from-violet-core/40 to-transparent lg:block"
              />
            ) : null}

            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-violet-core/25 to-cyan-core/15 ring-1 ring-inset ring-white/10">
                <step.icon className="size-4 text-violet-glow" aria-hidden />
              </span>
              <span className="font-mono text-xs text-subtle">
                0{index + 1}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {step.body}
            </p>
          </motion.li>
        ))}
      </ol>

      <div className="mt-8 text-center">
        <Link
          href="/how-it-works"
          className="group inline-flex items-center gap-1.5 text-sm text-violet-glow transition-colors hover:text-violet-core"
        >
          Read the full explanation
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>
    </section>
  );
}