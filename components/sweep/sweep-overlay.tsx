"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Loader2,
  PenLine,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { SweepPhase } from "@/types/sweep";
import { pluralize } from "@/lib/utils/format";

/** Ordered phases, so the user can see where they are and what is next. */
const STEPS: Array<{
  phase: SweepPhase;
  label: string;
  detail: string;
  icon: typeof Sparkles;
}> = [
  {
    phase: "planning",
    label: "Building routes",
    detail: "Asking Jupiter for the best swap path for each token.",
    icon: Sparkles,
  },
  {
    phase: "simulating",
    label: "Simulating",
    detail: "Dry-running every transaction before you are asked to sign.",
    icon: ShieldCheck,
  },
  {
    phase: "awaiting-signature",
    label: "Waiting for you",
    detail:
      "Approve it in your wallet app, not on this page. Nothing is sent until you do — if your wallet has not come to the front, switch to it manually.",
    icon: PenLine,
  },
  {
    phase: "submitting",
    label: "Submitting",
    detail: "Broadcasting to the Solana network.",
    icon: Send,
  },
  {
    phase: "confirming",
    label: "Confirming",
    detail: "Waiting for the network to finalise.",
    icon: Check,
  },
];

const ORDER: SweepPhase[] = STEPS.map((step) => step.phase);

/**
 * Full-screen progress overlay.
 *
 * Shown only while something is in flight. It deliberately names the current
 * step *and* says what happens next, because "waiting for wallet approval"
 * feels like a hang unless you are told to go approve something.
 */
export function SweepOverlay({
  phase,
  progress,
}: {
  phase: SweepPhase;
  progress: { completed: number; total: number };
}) {
  const visible =
    phase !== "idle" && phase !== "success" && phase !== "error";
  const currentIndex = ORDER.indexOf(phase);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-60 flex items-center justify-center bg-space-950/80 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Slingshot in progress"
        >
          <motion.div
            initial={{ scale: 0.95, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="glass glass-sheen w-full max-w-sm rounded-2xl p-6"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-violet-core to-cyan-core shadow-[0_10px_36px_-10px_rgba(139,92,246,0.9)]"
              >
                <Loader2 className="size-6 text-white" aria-hidden />
              </motion.span>
              <div>
                <p className="text-sm font-semibold">
                  {STEPS[currentIndex]?.label ?? "Working"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {STEPS[currentIndex]?.detail}
                </p>
              </div>
            </div>

            <StepRail currentIndex={currentIndex} />

            {/* Transaction progress, once we know how many there are. */}
            {progress.total > 0 ? (
              <div className="mt-4 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>
                    {progress.completed} of {progress.total}{" "}
                    {pluralize(progress.total, "transaction")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.round((progress.completed / progress.total) * 100)}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.completed}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"
                >
                  <motion.div
                    className="h-full rounded-full bg-linear-to-r from-violet-core to-cyan-core"
                    animate={{
                      width: `${(progress.completed / progress.total) * 100}%`,
                    }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </div>
            ) : null}

            <p className="mt-4 text-center text-[11px] text-subtle">
              Do not close this tab — your wallet approval is required to
              continue.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
function StepRail({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="mt-5 space-y-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const StepIcon = step.icon;
        return (
          <li key={step.phase} className="flex items-center gap-2.5 text-xs">
            <span
              className={
                done
                  ? "flex size-5 items-center justify-center rounded-full bg-success/20 text-success"
                  : active
                    ? "flex size-5 items-center justify-center rounded-full bg-violet-core/25 text-violet-glow"
                    : "flex size-5 items-center justify-center rounded-full bg-white/6 text-subtle"
              }
            >
              {done ? (
                <Check className="size-3" aria-hidden />
              ) : (
                <StepIcon className="size-3" aria-hidden />
              )}
            </span>
            <span
              className={
                active
                  ? "font-medium text-foreground"
                  : done
                    ? "text-muted"
                    : "text-subtle"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}