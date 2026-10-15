"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ExternalLink, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSweepHistory } from "@/hooks/use-sweep-history";
import { solscanTxUrl } from "@/lib/solana/submit";
import { cn } from "@/lib/utils/cn";
import {
  formatAmount,
  formatRelativeTime,
  formatUsd,
  pluralize,
  truncateAddress,
} from "@/lib/utils/format";

/**
 * Past slingshots, from localStorage — and folded away by default.
 *
 * This is a convenience log, not an accounting record. Every entry is validated
 * on read, because localStorage can contain anything a previous version wrote
 * or a user hand-edited. Nothing here is ever used to move funds.
 *
 * It opens **closed** because it is the only thing in this column that describes
 * the past. Everything above it acts on the wallet as it is right now, and a log
 * of finished sweeps was sitting between those controls and the page bottom —
 * pushing the useful part down on a column that already had to be scrolled. The
 * header still carries the count, so nothing is hidden; only folded.
 */
export function SweepHistoryPanel({ onResweep }: { onResweep: () => void }) {
  const { entries, clearHistory, hydrated } = useSweepHistory();
  const [open, setOpen] = useState(false);

  if (!hydrated || entries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-white/3">
      <div className="flex items-center gap-1 py-2 pr-2 pl-1">
        {/* The whole header is the toggle. A heading that says how many sweeps
            are behind it is a better target than a chevron on its own, and it
            still tells you something while closed. */}
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-controls="past-slingshots"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-glow"
        >
          <History className="size-4 shrink-0 text-subtle" aria-hidden />
          Past slingshots
          <span className="truncate text-xs font-normal text-subtle">
            · {pluralize(entries.length, "sweep")}
          </span>
          <ChevronDown
            className={cn(
              "ml-auto size-4 shrink-0 text-subtle transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={clearHistory}
          aria-label="Clear slingshot history"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>

      {open ? (
        <motion.div
          id="past-slingshots"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="px-4 pb-4"
        >
          <ul className="space-y-2">
            {entries.slice(0, 5).map((entry, index) => (
              <motion.li
                key={entry.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                className="rounded-xl border border-border/60 bg-white/2 p-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-xs tabular-nums">
                    {formatAmount(entry.totalOutput, 6)}{" "}
                    <span className="text-muted">{entry.outputAsset}</span>
                  </p>
                  <p className="shrink-0 text-[10px] text-subtle">
                    {formatRelativeTime(entry.createdAt)}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-subtle">
                  {pluralize(entry.tokenCount, "token")} ·{" "}
                  {formatUsd(entry.totalValueUsd)} recovered
                  {entry.failedCount > 0 ? (
                    <span className="text-warning"> · {entry.failedCount} failed</span>
                  ) : null}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.signatures.slice(0, 3).map((signature) => (
                    <a
                      key={signature}
                      href={solscanTxUrl(signature)}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-subtle transition-colors hover:text-foreground"
                    >
                      {truncateAddress(signature, 3, 3)}
                      <ExternalLink className="size-2.5" aria-hidden />
                    </a>
                  ))}
                </div>
              </motion.li>
            ))}
          </ul>

          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={onResweep}
          >
            Start a new sweep
          </Button>
        </motion.div>
      ) : null}
    </div>
  );
}