"use client";

import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { TokenLogo } from "./token-logo";
import {
  percentOfBalance,
  rawToDecimalString,
  resolveAmount,
} from "@/lib/sweep/amounts";
import {
  baseAmountToNumber,
  parseBaseAmount,
  toBaseAmount,
} from "@/lib/utils/sanitize";
import { formatAmount, formatPercent, formatUsd } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DustToken } from "@/types/token";

/**
 * One row in the dust list.
 *
 * Memoised because the list can hold 100+ rows and the selection state changes
 * on every click — without this, selecting one token would re-render all of
 * them.
 */
export const TokenRow = memo(function TokenRow({
  token,
  selected,
  disabled,
  disabledReason,
  onToggle,
  amountRaw,
  onAmountChange,
}: {
  token: DustToken;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  onToggle: (mint: string, next: boolean) => void;
  /** Base units to swap. Equals the balance when the user has not chosen less. */
  amountRaw: string;
  onAmountChange: (mint: string, raw: string) => void;
}) {
  // The row itself is the checkbox.
  //
  // An 18px Radix box is a poor thumb target on a phone, so the whole row
  // toggles instead, carries the ARIA state, and takes focus — and the visual
  // checkbox becomes decoration. That leaves exactly one focus stop per row,
  // rather than two controls doing the same thing.
  const toggle = (): void => {
    if (disabled) return;
    onToggle(token.mint, !selected);
  };

  /**
   * The amount field is local *text*, not a formatted view of `amountRaw`.
   *
   * Deriving it from the parsed value on every keystroke would reformat under
   * the cursor — typing "0.50" would become "0.5" mid-word. So the draft is
   * pushed up only once it parses, and pulled back down only when the amount
   * changed from somewhere else (a percentage button, or a rescan clearing it),
   * which the early return detects by round-tripping the draft.
   */
  const [draft, setDraft] = useState(() =>
    rawToDecimalString(amountRaw, token.decimals),
  );
  useEffect(() => {
    if (toBaseAmount(draft, token.decimals)?.toString() === amountRaw) return;
    setDraft(rawToDecimalString(amountRaw, token.decimals));
  }, [amountRaw, draft, token.decimals]);

  const balance = parseBaseAmount(token.rawAmount) ?? 0n;
  const resolved = resolveAmount(token.rawAmount, amountRaw);
  // Only meaningful once a *partial* amount is chosen; at 100% the account still
  // empties and the rent still comes back.
  const partial = resolved.ok && !resolved.emptiesAccount;
  const chosen = resolved.ok
    ? (baseAmountToNumber(BigInt(resolved.raw), token.decimals) ?? 0)
    : 0;

  const applyPercent = (percent: number): void => {
    const raw = percentOfBalance(token.rawAmount, percent);
    // Push the amount and the formatted text together, so the field reads the
    // percentage back immediately rather than waiting for an effect.
    setDraft(rawToDecimalString(raw, token.decimals));
    onAmountChange(token.mint, raw);
  };

  const onDraftChange = (next: string): void => {
    setDraft(next);
    const parsed = toBaseAmount(next, token.decimals);
    // An unparseable or over-balance draft stays as text and is not pushed: the
    // user is mid-edit, and refusing the whole field would fight them. Nothing
    // is submitted from a draft — the parent's parsed amount is what gets signed.
    if (parsed == null || parsed <= 0n || parsed > balance) return;
    onAmountChange(token.mint, parsed.toString());
  };

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="group relative border-b border-border/50 last:border-b-0"
    >
      {/* Left accent bar, animated on selection. */}
      <motion.span
        aria-hidden
        className="absolute inset-y-0 left-0 w-0.5 bg-linear-to-b from-violet-core to-cyan-core"
        animate={{ opacity: selected ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      />

      <div
        role="checkbox"
        aria-checked={selected}
        aria-disabled={disabled || undefined}
        aria-label={`Select ${token.symbol} worth ${formatUsd(token.valueUsd)}`}
        tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          // Space would otherwise scroll the page.
          event.preventDefault();
          toggle();
        }}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 transition-colors sm:px-4",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet-glow",
          selected ? "bg-violet-core/8" : "hover:bg-white/3",
          disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
        )}
      >
        {/* Decorative: the row above owns the state, the focus and the click. */}
        <Checkbox
          checked={selected}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none"
        />

        <TokenLogo src={token.logoUri} symbol={token.symbol} size={34} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{token.symbol}</span>
          {token.program === "token2022" ? (
            <Tooltip content="Token-2022 mint. Spacedust supports these, but some have transfer fees or hooks that can block a swap.">
              <Badge variant="token2022" size="sm">
                2022
              </Badge>
            </Tooltip>
          ) : null}
          {token.hasTransferHook ? (
            <Tooltip content="This mint has a transfer hook that can run custom code on every transfer. Spacedust will not sweep it.">
              <Badge variant="warning" size="sm">
                <Lock className="size-2.5" aria-hidden />
                Hook
              </Badge>
            </Tooltip>
          ) : null}
          {token.hasNoPrice ? (
            <Tooltip content="Jupiter has no reliable price for this token, which usually means no liquidity. The Smart Filter hides these.">
              <Badge variant="warning" size="sm">
                <AlertTriangle className="size-2.5" aria-hidden />
                No price
              </Badge>
            </Tooltip>
          ) : null}
        </div>
        <p className="truncate text-xs text-subtle" title={token.name}>
          {token.name}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={cn(
            "font-mono text-sm tabular-nums",
            token.valueUsd > 0 ? "text-foreground" : "text-subtle",
          )}
        >
          {formatUsd(token.valueUsd)}
        </p>
        <p className="text-xs text-subtle" title={token.rawAmount}>
          {formatAmount(token.balance, 4)}
          {token.priceChange24h != null && Math.abs(token.priceChange24h) > 0.01 ? (
            <span
              className={cn(
                "ml-1.5",
                token.priceChange24h > 0 ? "text-success" : "text-danger",
              )}
            >
              {token.priceChange24h > 0 ? "+" : ""}
              {formatPercent(token.priceChange24h / 100, 1)}
            </span>
          ) : null}
        </p>
      </div>

        {disabled && disabledReason ? (
          <Tooltip content={disabledReason}>
            <Sparkles
              className="size-3.5 shrink-0 text-subtle"
              aria-label={disabledReason}
            />
          </Tooltip>
        ) : null}
      </div>

      {/* The amount editor. A *sibling* of the row, not a child of it: the row
          is a checkbox that toggles on any click, so an input inside it would
          flip the selection every time somebody clicked in to edit. Shown only
          once a token is selected — there is no amount to choose for one that is
          not going anywhere. */}
      {selected ? (
        <div className="px-3 pb-3 sm:px-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor={`amount-${token.mint}`}
              className="shrink-0 text-[11px] text-muted"
            >
              Amount
            </label>
            <div className="relative min-w-0 flex-1">
              <Input
                id={`amount-${token.mint}`}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                aria-label={`Amount of ${token.symbol} to swap, of a balance of ${formatAmount(token.balance, 4)}`}
                className="h-8 pr-16 font-mono text-xs"
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[10px] text-subtle">
                {token.symbol}
              </span>
            </div>
          </div>
          {/* The shortcuts get their own row. An input plus four buttons does not
              fit a phone, and a control too cramped to hit is one people mistap —
              four equal-width buttons are easier to hit than four small ones. */}
          <div className="mt-2 flex items-center gap-1">
            {[25, 50, 75, 100].map((percent) => (
              <Button
                key={percent}
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 flex-1 px-1.5 text-[10px] tabular-nums"
                onClick={() => applyPercent(percent)}
                aria-label={`Swap ${percent}% of ${token.symbol}`}
              >
                {percent}%
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
            {partial
              ? `Swapping ${formatAmount(chosen, 4)} of ${formatAmount(token.balance, 4)} ${token.symbol}. The account keeps a balance, so its rent is not reclaimed this time.`
              : `Swapping the whole ${formatAmount(token.balance, 4)} ${token.symbol}. The emptied account is closed and its rent comes back.`}
          </p>
        </div>
      ) : null}
    </motion.li>
  );
});