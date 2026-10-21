"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Wand2, Coins } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/input";
import { TokenRow } from "./token-row";
import { pluralize } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DustToken } from "@/types/token";

/**
 * The dust list.
 *
 * Mobile-first: on small screens the value column stays visible and the token
 * name truncates, so the price is never the thing you have to scroll to find.
 */
export function TokenList({
  tokens,
  selectedMints,
  onToggle,
  onSelectAll,
  onDeselectAll,
  isLoading,
  hiddenCount,
  hiddenLabel,
  className,
  amounts,
  onAmountChange,
  showAmounts,
  onShowAmountsChange,
  showAmountControl = true,
}: {
  tokens: DustToken[];
  selectedMints: Set<string>;
  onToggle: (mint: string, next: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isLoading: boolean;
  hiddenCount: number;
  hiddenLabel?: string;
  className?: string;
  /** mint → chosen base-unit amount. A mint with no entry swaps in full. */
  amounts: ReadonlyMap<string, string>;
  onAmountChange: (mint: string, raw: string) => void;
  /**
   * Whether the per-row amount editor is shown at all.
   *
   * Off by default. A sweep means "everything I selected", so an input under
   * every ticked row is a wall of fields for a decision most people never make.
   * On, a row can sell a fraction — and a partial sale leaves a balance behind,
   * which is why that account's rent is no longer reclaimed.
   */
  showAmounts: boolean;
  onShowAmountsChange: (next: boolean) => void;
  /**
   * Whether the Custom switch is offered at all. Basic mode hides it because a
   * partial sale is the less common, more error-prone path; the row still states
   * that the default swaps 100%.
   */
  showAmountControl?: boolean;
}) {
  const selectableTokens = tokens.filter((token) => !token.hasTransferHook);
  const selectedVisible = selectableTokens.filter((token) =>
    selectedMints.has(token.mint),
  ).length;
  const allSelected =
    selectableTokens.length > 0 && selectedVisible === selectableTokens.length;
  const someSelected = selectedVisible > 0 && !allSelected;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header row */}
      <div className="flex items-center gap-3 border-b border-border/70 px-3 py-2.5 sm:px-4">
        <Checkbox
          checked={allSelected}
          // Radix has no indeterminate state, but a dash reads correctly and we
          // pair it with aria-label so the meaning is not visual-only.
          indeterminate={someSelected}
          onCheckedChange={(checked) => (checked ? onSelectAll() : onDeselectAll())}
          aria-label={allSelected ? "Deselect all tokens" : "Select all tokens"}
        />
        <span className="flex-1 text-xs font-medium text-muted">
          {isLoading
            ? "Scanning…"
            : `${pluralize(selectableTokens.length, "token")} found`}
          {hiddenCount > 0 ? (
            <span className="ml-1.5 text-subtle">
              · {hiddenCount} hidden
            </span>
          ) : null}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          disabled={selectableTokens.length === 0}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>

      {/* Amounts are all-or-nothing until somebody asks otherwise.
          The header states what the default does in words, so "100%" is a fact
          the user can read rather than an assumption. Turning the switch on
          costs something real — a partial sale leaves a balance behind, and that
          account can no longer be closed for its rent — so it says so before the
          editors appear rather than after. */}
      {selectedVisible > 0 ? (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-white/2 px-3 py-1.5 sm:px-4">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-subtle">
            <Coins className="size-3 shrink-0" aria-hidden />
            <span className="truncate">
              {showAmounts
                ? "Selling less than the whole balance keeps its rent locked"
                : "Swapping 100% of each selected token"}
            </span>
          </span>
          {showAmountControl ? (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px] text-muted">
              Custom
              <Switch
                checked={showAmounts}
                onCheckedChange={onShowAmountsChange}
                aria-label="Choose a custom amount for each token instead of swapping everything"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {hiddenLabel ? (
        <p className="flex items-center gap-1.5 border-b border-border/50 bg-white/2 px-3 py-1.5 text-[11px] text-subtle sm:px-4">
          <Wand2 className="size-3 shrink-0" aria-hidden />
          {hiddenLabel}
        </p>
      ) : null}

      {/* Rows */}
      {isLoading ? (
        <TokenListSkeleton />
      ) : tokens.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto" role="list">
          <AnimatePresence initial={false} mode="popLayout">
            {tokens.map((token) => (
              <TokenRow
                key={token.mint}
                token={token}
                selected={selectedMints.has(token.mint)}
                disabled={token.hasTransferHook}
                disabledReason="This mint has a transfer hook and cannot be swept safely."
                onToggle={onToggle}
                amountRaw={amounts.get(token.mint) ?? token.rawAmount}
                onAmountChange={onAmountChange}
                showAmountEditor={showAmounts}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function TokenListSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-border/40">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Skeleton className="size-[18px] rounded-[6px]" />
          <Skeleton className="size-[34px] rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-2.5 w-36" />
          </div>
          <div className="space-y-1.5 text-right">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="ml-auto h-2.5 w-12" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <motion.span
        animate={{ rotate: [0, -8, 8, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 2 }}
        className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-violet-core/20 to-cyan-core/15 ring-1 ring-inset ring-white/10"
      >
        <Sparkles className="size-6 text-violet-glow" aria-hidden />
      </motion.span>
      <div>
        <p className="text-sm font-medium">No dust under this threshold</p>
        <p className="mt-1 max-w-xs text-xs text-muted">
          Nothing to sweep. Raise the threshold to include more tokens, or turn
          off the smart filter to include tokens without a reliable price.
        </p>
      </div>
    </motion.div>
  );
}