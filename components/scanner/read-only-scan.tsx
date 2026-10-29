"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  AtSign,
  Check,
  Coins,
  Copy,
  Eye,
  KeyRound,
  Landmark,
  QrCode,
  ScanLine,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Skeleton } from "@/components/ui/input";
import { TokenLogo } from "@/components/scanner/token-logo";
import { WalletInsights } from "@/components/scanner/wallet-insights";
import { QrScanner } from "@/components/payload/qr-scanner";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { summariseRecoverable, totalLimitations } from "@/lib/sweep/recoverable";
import { POOL_POSITION_NOTE } from "@/lib/sweep/pool-positions";
import { STAKED_POSITION_NOTE } from "@/lib/staking/staked-tokens";
import type {
  RecoverableBreakdown,
  RecoverableLimitations,
} from "@/lib/sweep/recoverable";
import { apiFetch } from "@/lib/utils/api";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { toFriendlyError, type FriendlyError } from "@/lib/utils/errors";
import {
  formatAmount,
  formatSol,
  formatUsd,
  pluralize,
  truncateAddress,
} from "@/lib/utils/format";
import { isValidSolanaAddress } from "@/lib/utils/sanitize";
import type {
  DustToken,
  EmptyTokenAccount,
  NonFungibleAsset,
  StakedAccount,
  WalletScan,
} from "@/types/token";
import type { TokenApproval } from "@/lib/solana/approvals";
import type { SalvageDomain, WrappedSolAccount } from "@/types/salvage";

/**
 * Read-only wallet scan.
 *
 * Looks up any address and reports what a sweep *would* recover, without ever
 * asking for a wallet, a signature, or an approval. Two reasons this exists
 * rather than being a mode of the main app:
 *
 *  - **Trust.** "Show me before I connect anything" is the first thing a careful
 *    user wants, and the answer has to be the same number the real sweep will
 *    produce. It is computed from the same scan and the same rent figure, so it
 *    is checkable rather than a marketing estimate.
 *  - **Sharing.** The address lives in the URL, so a result is a link. "Here is
 *    what is stuck in my old wallet" is a conversation people actually have.
 *
 * The address is only ever read. No wallet is connected, nothing is signed, and
 * nothing here can move a lamport.
 */

export function ReadOnlyScan({ initialOwner }: { initialOwner: string | null }) {
  const validInitial =
    initialOwner && isValidSolanaAddress(initialOwner) ? initialOwner : null;

  const [value, setValue] = useState(validInitial ?? "");
  const [owner, setOwner] = useState<string | null>(validInitial);
  const [scan, setScan] = useState<WalletScan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const lookUp = useCallback(async (address: string): Promise<void> => {
    if (!isValidSolanaAddress(address)) {
      setScan(null);
      setOwner(null);
      setError({
        title: "Not a Solana address",
        message: "That address is not on Solana.",
        hint: "Addresses are 32–44 base58 characters, with no spaces or newlines.",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Recorded before the fetch, so the shareable link is correct even while
    // the result is still loading.
    setOwner(address);
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiFetch<WalletScan>(
        `/api/tokens?owner=${encodeURIComponent(address)}&approvals=1&extras=1&excess=1`,
        {
          signal: controller.signal,
          // The server is capped at 60s; the full scan adds wSOL, SNS, excess
          // rent and approvals, so let the server be the one that gives up. A
          // 45s client timeout used to abort a large scan that was about to
          // finish.
          timeoutMs: 90_000,
          // A shared link gets opened more than once, and a scan is far and away
          // the most expensive call in the app.
          cacheMs: 30_000,
        },
      );
      if (controller.signal.aborted) return;
      setScan(result);
      // Keep the address bar in step, so the current result is the current URL.
      // `replaceState` rather than a router push: this is a query change, not a
      // navigation, and it must not scroll or re-render the page.
      window.history.replaceState(
        null,
        "",
        `/scan?owner=${encodeURIComponent(address)}`,
      );
    } catch (caught) {
      if (controller.signal.aborted) return;
      setScan(null);
      setError(toFriendlyError(caught));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  // A shared link scans itself on load.
  useEffect(() => {
    if (validInitial) void lookUp(validInitial);
    return () => abortRef.current?.abort();
  }, [validInitial, lookUp]);

  const recoverable = useMemo(
    () =>
      scan ? summariseRecoverable(scan) : null,
    [scan],
  );

  const copyLink = useCallback(async (): Promise<void> => {
    if (!owner) return;
    const url = `${window.location.origin}/scan?owner=${encodeURIComponent(owner)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Could not copy the link.");
    }
  }, [owner]);

  return (
    <div className="flex flex-col gap-6">
      <ScanForm
        value={value}
        onChange={setValue}
        isLoading={isLoading}
        onSubmit={() => void lookUp(value.trim())}
        onScan={(address) => {
          // Fill the field *and* run the lookup: on this page the result is the
          // whole point, so a scan should land on it rather than stopping at a
          // filled box the user then has to submit.
          setValue(address);
          void lookUp(address);
        }}
      />

      <ScanResult
        scan={scan}
        recoverable={recoverable}
        error={error}
        isLoading={isLoading}
        owner={owner}
        copied={copied}
        onCopyLink={() => void copyLink()}
      />
    </div>
  );
}

/** The address form. Deliberately the first thing on the page. */
function ScanForm({
  value,
  onChange,
  isLoading,
  onSubmit,
  onScan,
}: {
  value: string;
  onChange: (next: string) => void;
  isLoading: boolean;
  onSubmit: () => void;
  onScan: (address: string) => void;
}) {
  const empty = value.trim().length === 0;
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="scan-owner"
              className="text-xs font-medium text-muted"
            >
              Wallet address
            </label>
            {/* The field and the camera in one row. An address on a phone is a QR
                far more often than it is typed, and this page never asks for a
                wallet — so the scanner has to work with nothing connected. */}
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="scan-owner"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="Any Solana address"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="scan-owner-hint"
                className="min-w-0 flex-1 font-mono text-[0.8rem]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setScannerOpen(true)}
                aria-label="Scan a QR code for a wallet address"
              >
                <QrCode className="size-4" aria-hidden />
                <span className="ml-1.5 hidden sm:inline">Scan</span>
              </Button>
            </div>
          </div>
          <Button type="submit" disabled={isLoading || empty}>
            <Search aria-hidden />
            {isLoading ? "Checking…" : "Check"}
          </Button>
        </form>

        <QrScanner
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          description="Point the camera at a wallet's receive code, a Solana Pay request, or an explorer link. Scanning fills the field and looks the address up — nothing is connected and nothing is signed."
          onScan={(address) => {
            // The scanner returns an address it has already validated, so this
            // goes straight into the lookup the page exists for, rather than
            // making the user press Check on something they just photographed.
            onScan(address);
            setScannerOpen(false);
          }}
        />

        <p
          id="scan-owner-hint"
          className="mt-2.5 flex items-center gap-1.5 text-xs text-subtle"
        >
          <Eye className="size-3.5 shrink-0" aria-hidden />
          Read-only. No wallet is connected, nothing is signed, and no approval is
          requested.
        </p>
      </CardContent>
    </Card>
  );
}

/** One figure with its own label and an accessible explanation. */
function Metric({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-white/[0.02] p-2.5">
      <dt className="text-[10px] leading-tight text-subtle">{label}</dt>
      <dd
        title={hint}
        className={
          accent
            ? "mt-1 truncate text-base font-semibold tracking-tight text-success sm:text-lg"
            : "mt-1 truncate text-base font-semibold tracking-tight sm:text-lg"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A full-width scan window rather than a compact metric.
 *
 * Rent refunds and wrapped SOL both have a meaningful zero state — "we checked,
 * there is none" — so they need room for the value, the account count and the
 * next action, not a disappearing callout.
 */
function ScanWindow({
  icon,
  title,
  value,
  hint,
  action = null,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
          {icon}
          {title}
        </p>
        {action}
      </div>
      <p className="mt-2 font-mono text-lg font-semibold tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-subtle">{hint}</p>
    </div>
  );
}


/**
 * The headline, deliberately shaped like the example on the landing page: one
 * address card, three figures, and the rent breakdown beside them. The detailed
 * charts and rows stay below; this is the at-a-glance answer.
 */
function ScanSummary({
  scan,
  recoverable,
  owner,
  copied,
  onCopyLink,
}: {
  scan: WalletScan;
  recoverable: RecoverableBreakdown;
  owner: string | null;
  copied: boolean;
  onCopyLink: () => void;
}) {
  const tokenAccounts = scan.tokens.length + scan.emptyAccounts.length;
  const approvals = scan.approvalsCount;
  const approvalsValue =
    scan.approvalsError !== null && scan.approvalsError !== undefined
      ? "—"
      : approvals == null
        ? "—"
        : String(approvals);
  const wrappedSol = scan.wrappedSol;
  const wrappedSolAmountLamports =
    wrappedSol === undefined
      ? null
      : wrappedSol.reduce((sum, account) => sum + account.amountLamports, 0);
  const wrappedSolRentLamports =
    wrappedSol?.reduce((sum, account) => sum + account.rentLamports, 0) ?? 0;
  const wrappedSolDisplay =
    wrappedSol === undefined || scan.wrappedSolError
      ? "—"
      : formatSol(wrappedSolAmountLamports ?? 0);
  const wrappedSolHint =
    wrappedSol === undefined
      ? "Not checked."
      : scan.wrappedSolError
        ? `Could not check wrapped SOL: ${scan.wrappedSolError}`
        : wrappedSol.length === 0
          ? "No wrapped SOL."
          : `${pluralize(wrappedSol.length, "account")} · ${formatSol(wrappedSolRentLamports)} rent`;
  const snsCount = scan.snsError ? null : (scan.snsDomains?.length ?? null);
  const emptyRent = formatSol(recoverable.emptyRentLamports);
  const emptyRentValue = emptyRent.endsWith(" SOL")
    ? emptyRent.slice(0, -4)
    : emptyRent;
  const totalRent = formatSol(recoverable.rentLamports);
  const excessAccounts = scan.excessRentAccounts ?? [];
  const excessDisplay =
    scan.excessRentError || scan.excessRentAccounts === undefined
      ? "—"
      : formatSol(recoverable.excessRentLamports);
  const excessHint = scan.excessRentError
    ? `Could not check rent refunds: ${scan.excessRentError}`
    : scan.excessRentAccounts === undefined
      ? "Rent refunds were not checked."
      : excessAccounts.length === 0
        ? "No Token-2022 account is holding spare rent."
        : `${pluralize(excessAccounts.length, "account")} · refund the surplus without closing anything.`;
  const rentUsd = recoverable.rentUsd;
  const totalUsd = recoverable.totalUsd;
  const rentShare =
    rentUsd !== null && totalUsd !== null && totalUsd > 0
      ? Math.min(1, Math.max(0, rentUsd / totalUsd))
      : null;
  const source =
    scan.source === "helius-das" ? "Helius's DAS index" : "the free core RPC";

  return (
    <Card sheen className="overflow-hidden rounded-2xl border-border/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-violet-core/12 text-violet-glow ring-1 ring-inset ring-violet-core/20">
            <ScanLine className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium">Wallet Scan</p>
            <p className="text-[11px] text-subtle">
              Read-only · no wallet connection
            </p>
          </div>
        </div>
        <Badge variant="success" size="sm">
          Read-only
        </Badge>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-[1.15fr_0.85fr] sm:p-5">
        <div>
          <div className="rounded-xl border border-border/60 bg-black/20 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
              Wallet address
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm text-foreground">
                {owner ? truncateAddress(owner, 4, 4) : "—"}
              </span>
              <span className="rounded-full border border-success/20 bg-success/8 px-2 py-0.5 text-[10px] text-emerald-300">
                Read-only
              </span>
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric
              label="Token accounts"
              value={String(tokenAccounts)}
              hint={`${pluralize(scan.tokens.length, "dust position")} plus ${pluralize(scan.emptyAccounts.length, "empty account")}.`}
            />
            <Metric
              label="Empty rent"
              value={emptyRentValue}
              accent
              hint="Rent sitting in accounts that are already empty."
            />
            <Metric
              label="Approvals"
              value={approvalsValue}
              hint={
                scan.approvalsError
                  ? `Could not check approvals: ${scan.approvalsError}`
                  : approvals == null
                    ? "Approvals were not checked."
                    : approvals === 0
                      ? "No open approvals."
                      : pluralize(approvals, "open approval")
              }
            />
          </dl>

          <p className="mt-2 px-0.5 text-[10px] leading-snug text-subtle">
            Native {scan.native.sol.toFixed(4)} SOL
            {scan.wrappedSol && scan.wrappedSol.length > 0
              ? ` · Wrapped ${formatSol(wrappedSolAmountLamports ?? 0)}`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-white/[0.02] p-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
              Wallet total
            </p>
            <p className="font-mono text-sm font-semibold">
              {formatUsd(recoverable.walletValueUsd)}
            </p>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-subtle">
              Potential reclaim
            </p>
            <p className="text-sm font-semibold text-success">+{totalRent}</p>
          </div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6"
            role="img"
            aria-label={
              rentShare === null
                ? "Rent share unavailable"
                : `${Math.round(rentShare * 100)}% of recoverable value is rent`
            }
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-violet-core to-cyan-core"
              style={{ width: `${(rentShare ?? 0) * 100}%` }}
            />
          </div>
          <ul className="mt-3 space-y-1.5 text-[11px] text-muted">
            <li className="flex justify-between gap-2">
              <span>Dust positions</span>
              <span className="text-foreground">{scan.tokens.length}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Empty token accounts</span>
              <span className="text-foreground">{scan.emptyAccounts.length}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Rent-refund accounts</span>
              <span className="text-foreground">
                {scan.excessRentError || scan.excessRentAccounts === undefined
                  ? "—"
                  : scan.excessRentAccounts.length}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Open approvals</span>
              <span className="text-foreground">{approvalsValue}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>SNS names</span>
              <span className="text-foreground">{snsCount ?? "—"}</span>
            </li>
          </ul>
          <p className="mt-3 text-[10px] leading-snug text-subtle">
            {scan.approvalsError
              ? "Approvals could not be read. That is not a clean bill of health."
              : "Read-only result. Nothing is signed."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border/60 p-4 sm:grid-cols-2 sm:p-5">
        <ScanWindow
          icon={<Coins className="size-4 text-violet-glow" aria-hidden />}
          title="Rent refund"
          value={excessDisplay}
          hint={excessHint}
          action={
            recoverable.excessRentLamports > 0 ? (
              <Link
                href="/salvage"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-glow transition-colors hover:text-violet-core"
              >
                Withdraw
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null
          }
        />
        <ScanWindow
          icon={
            <ArrowDownToLine className="size-4 text-cyan-glow" aria-hidden />
          }
          title="Wrapped SOL"
          value={wrappedSolDisplay}
          hint={wrappedSolHint}
          action={
            wrappedSolAmountLamports != null &&
            wrappedSolAmountLamports > 0 &&
            !scan.wrappedSolError ? (
              <Link
                href="/salvage"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-glow transition-colors hover:text-violet-core"
              >
                Unwrap
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null
          }
        />
      </div>


      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
        <p className="text-[11px] text-subtle">
          Read {Math.round(scan.durationMs)}ms ago through {source}, across{" "}
          {pluralize(scan.pages, "page")}.
        </p>
        <Button variant="ghost" size="sm" onClick={onCopyLink}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * What a scan looks like while it runs.
 *
 * The client cannot see the server's phases — a scan is one request — so this
 * deliberately does not pretend to. A bar filling to 60% would be invented; the
 * elapsed clock is not, and saying how long is normal is the thing that keeps
 * someone from closing the tab. Measured: 3,033 holdings took 49.4 seconds, so a
 * minute is not a fault, and without a sentence saying so a minute of skeletons
 * reads as a hang.
 *
 * The clock is `aria-hidden`: a screen reader announcing every second would make
 * the wait worse than it already is. The line above it is `aria-live` and changes
 * twice, which is exactly the amount worth announcing.
 */
function ScanWaiting() {
  const seconds = useElapsedSeconds(true);

  const line =
    seconds < 6
      ? "Reading the chain…"
      : seconds < 20
        ? "Still reading — this wallet has a lot of accounts."
        : "Still working. Wallets with thousands of accounts take about a minute.";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {line}
          </p>
          <span
            aria-hidden
            className="shrink-0 font-mono text-[11px] tabular-nums text-subtle"
          >
            {seconds}s
          </span>
        </div>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  );
}

/** The result area, in its four states: error, loading, empty, or a wallet. */
function ScanResult({
  scan,
  recoverable,
  error,
  isLoading,
  owner,
  copied,
  onCopyLink,
}: {
  scan: WalletScan | null;
  recoverable: RecoverableBreakdown | null;
  error: FriendlyError | null;
  isLoading: boolean;
  owner: string | null;
  copied: boolean;
  onCopyLink: () => void;
}) {
  if (error) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-danger"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium">{error.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {error.message}
            </p>
            {error.hint ? (
              <p className="mt-1 text-xs leading-relaxed text-subtle">
                {error.hint}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading && (!scan || !recoverable)) {
    return <ScanWaiting />;
  }

  if (!scan || !recoverable) {
    return (
      <Card>
        <CardContent className="text-sm leading-relaxed text-muted">
          Paste an address to see what is recoverable from it. Nothing is
          requested from you, and nothing about the address leaves the server
          except the answer below.
        </CardContent>
      </Card>
    );
  }

  const limitations = totalLimitations(recoverable.limitations);
  const nfts = scan.nonFungibles.length;

  return (
    <div className="flex flex-col gap-4">
      <ScanSummary
        scan={scan}
        recoverable={recoverable}
        owner={owner}
        copied={copied}
        onCopyLink={onCopyLink}
      />

      {/* Tokens and NFTs first, because "what is in here" is the question the
          scan is opened to answer. The recoverable and security details follow. */}
      <TokenRows tokens={scan.tokens} />

      {nfts > 0 ? <CollectiblesCard assets={scan.nonFungibles} /> : null}

      <WalletInsights scan={scan} recoverable={recoverable} />

      <WrappedSolCard
        accounts={scan.wrappedSol}
        error={scan.wrappedSolError ?? null}
      />

      <EmptyAccountsCard
        accounts={scan.emptyAccounts}
        error={scan.emptyAccountsError}
        owner={scan.owner}
      />

      {limitations > 0 ? (
        <LimitationsCard limitations={recoverable.limitations} />
      ) : null}

      {/* Staking first: it is the more specific, more useful answer, and every
          recognised staking token would otherwise land in the pool card below
          under a label that does not describe it. */}
      <StakedPositionsCard
        positions={scan.tokens.filter((token) => token.staked !== null)}
        accounts={scan.stakedAccounts}
        accountsError={scan.stakedAccountsError}
      />

      <PoolPositionsCard
        positions={scan.tokens.filter(
          (token) => token.poolLike && token.staked === null,
        )}
        error={scan.poolLikeError}
      />

      <ApprovalsCard
        approvals={scan.approvals}
        error={scan.approvalsError ?? null}
        tokens={scan.tokens}
      />

      <SnsNamesCard
        domains={scan.snsDomains}
        error={scan.snsError ?? null}
        truncated={scan.snsTruncated ?? false}
      />

      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted">
            To collect any of this, connect a wallet you control. The figure above
            is the number the sweep itself will be held to.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectWalletCta size="md" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Empty token accounts, read-only.
 *
 * These are the ordinary Salvage rows: no balance, just the rent-exempt deposit.
 * The headline counts them; this card names them, because a count is hard to
 * check and an address is not. Accounts with a foreign close authority or
 * withheld Token-2022 fees stay visible but are marked as the close the token
 * program will refuse.
 */
function EmptyAccountsCard({
  accounts,
  error,
  owner,
}: {
  accounts: EmptyTokenAccount[];
  error: string | null;
  owner: string;
}) {
  if (accounts.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted">
          <Coins className="size-4 text-violet-glow" aria-hidden />
          Empty token accounts
        </CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          Already empty. Closing one returns the rent listed beside it; this is
          the Basic action in Salvage.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs leading-relaxed text-warning">
            Empty accounts could not be read: {error}
          </p>
        ) : null}

        {accounts.length > 0 ? (
          <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60">
            {accounts.map((account) => {
              const foreignAuthority =
                account.closeAuthority !== null &&
                account.closeAuthority !== owner;
              const blocked = foreignAuthority || account.withheldFees > 0;

              return (
                <li
                  key={account.address}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-xs">
                        {truncateAddress(account.mint, 5, 4)}
                      </span>
                      <Badge variant="muted" size="sm">
                        {account.program === "token2022" ? "Token-2022" : "SPL"}
                      </Badge>
                      {foreignAuthority ? (
                        <Badge variant="warning" size="sm">
                          Foreign authority
                        </Badge>
                      ) : null}
                      {account.withheldFees > 0 ? (
                        <Badge variant="warning" size="sm">
                          Withheld fees
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-subtle">
                      {truncateAddress(account.address, 4, 4)}
                    </p>
                  </div>
                  <p
                    className={
                      blocked
                        ? "shrink-0 text-right font-mono text-xs text-subtle line-through"
                        : "shrink-0 text-right font-mono text-xs text-muted"
                    }
                  >
                    {formatSol(account.lamports)}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}

        <Link
          href="/salvage"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
        >
          Reclaim in Salvage
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Wrapped SOL, read-only.
 *
 * The token scanners drop the native mint, so this balance is invisible in the
 * ordinary token list and in the empty-account list. It is not a reclaim: the
 * principal is already the wallet's SOL. The rent inside the account is the only
 * part that behaves like the other rent figures on this page.
 */
function WrappedSolCard({
  accounts,
  error,
}: {
  accounts?: WrappedSolAccount[];
  error: string | null;
}) {
  if (accounts === undefined) return null;
  if (accounts.length === 0 && !error) return null;

  const amountLamports = accounts.reduce(
    (sum, account) => sum + account.amountLamports,
    0,
  );
  const rentLamports = accounts.reduce(
    (sum, account) => sum + account.rentLamports,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted">
          <ArrowDownToLine className="size-4 text-violet-glow" aria-hidden />
          Wrapped SOL
        </CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          SOL held in wSOL accounts. Closing one unwraps the full balance and
          returns its rent; the principal is already yours.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs leading-relaxed text-warning">
            Wrapped SOL could not be read: {error}
          </p>
        ) : null}

        {accounts.length > 0 ? (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border/60 bg-white/[0.02] p-2.5">
                <dt className="text-[10px] leading-tight text-subtle">Wrapped</dt>
                <dd className="mt-1 font-mono text-sm tabular-nums">
                  {formatSol(amountLamports)}
                </dd>
              </div>
              <div className="rounded-xl border border-border/60 bg-white/[0.02] p-2.5">
                <dt className="text-[10px] leading-tight text-subtle">Rent</dt>
                <dd className="mt-1 font-mono text-sm tabular-nums">
                  {formatSol(rentLamports)}
                </dd>
              </div>
              <div className="rounded-xl border border-border/60 bg-white/[0.02] p-2.5">
                <dt className="text-[10px] leading-tight text-subtle">Accounts</dt>
                <dd className="mt-1 font-mono text-sm tabular-nums">
                  {accounts.length}
                </dd>
              </div>
            </dl>

            <ul className="max-h-64 divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60">
              {accounts.map((account) => (
                <li
                  key={account.address}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-white/4">
                    <ArrowDownToLine
                      className="size-3.5 text-violet-glow"
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-sm tabular-nums">
                        {formatSol(account.amountLamports)}
                      </span>
                      {account.closeAuthority ? (
                        <Badge variant="warning" size="sm">
                          Uncloseable
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-subtle">
                      {truncateAddress(account.address, 4, 4)} ·{" "}
                      {formatSol(account.rentLamports)} rent
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-mono text-xs text-muted">
                    returns {formatSol(account.lamports)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <Link
          href="/salvage"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
        >
          Unwrap in Salvage
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Standing approvals, read-only.
 *
 * The exact list is useful on a scan because it answers who can move what, not
 * just how many grants exist. It stays read-only: revoking is a signature, and
 * this page never asks for one.
 */
function ApprovalsCard({
  approvals,
  error,
  tokens,
}: {
  approvals?: TokenApproval[] | null;
  error: string | null;
  tokens: DustToken[];
}) {
  if (approvals === undefined) return null;
  if (!error && (approvals === null || approvals.length === 0)) return null;

  const symbolByMint = new Map(tokens.map((token) => [token.mint, token.symbol]));
  const rows = approvals ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted">
          <KeyRound className="size-4 text-violet-glow" aria-hidden />
          Approvals
        </CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          Third parties still allowed to move a balance. Read-only here; revoke
          them in Approvals.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs leading-relaxed text-warning">
            Approvals could not be read: {error}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60">
            {rows.map((approval) => {
              const symbol =
                symbolByMint.get(approval.mint) ?? truncateAddress(approval.mint);
              return (
                <li
                  key={`${approval.tokenAccount}:${approval.delegate}`}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{symbol}</span>
                      {approval.unlimited ? (
                        <Badge variant="danger" size="sm">
                          Unlimited
                        </Badge>
                      ) : null}
                      {approval.frozen ? (
                        <Badge variant="muted" size="sm">
                          Frozen
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-subtle">
                      delegate {truncateAddress(approval.delegate, 4, 4)}
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                    {approval.unlimited
                      ? "All of it"
                      : `${formatAmount(approval.delegatedAmount, 4)} ${symbol}`}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}

        <Link
          href="/approvals"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
        >
          Review approvals
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * `.sns` names, read-only.
 *
 * A name has no balance and no market. It is shown because the name itself is
 * information — and because deleting it is the one way to release the rent its
 * name account holds. The actual deletion stays in Salvage, behind Pro.
 */
function SnsNamesCard({
  domains,
  error,
  truncated,
}: {
  domains?: SalvageDomain[];
  error: string | null;
  truncated: boolean;
}) {
  if (domains === undefined) return null;
  if (domains.length === 0 && !error) return null;

  const rentLamports = domains.reduce((sum, domain) => sum + domain.lamports, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted">
          <AtSign className="size-4 text-violet-glow" aria-hidden />
          .sns names
        </CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          {domains.length > 0
            ? `${pluralize(domains.length, "name")} · ${formatSol(rentLamports)} rent across their name accounts.`
            : "Names owned by this wallet. Deleting one returns its name-account rent."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs leading-relaxed text-warning">
            SNS names could not be read: {error}
          </p>
        ) : null}

        {domains.length > 0 ? (
          <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-xl border border-border/60">
            {domains.map((domain) => (
              <li
                key={domain.address}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {domain.name}.sns
                    </span>
                    {domain.tokenized ? (
                      <Badge variant="warning" size="sm">
                        Tokenized
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-subtle">
                    {truncateAddress(domain.address, 4, 4)}
                  </p>
                </div>
                <p className="shrink-0 text-right font-mono text-xs text-muted">
                  {formatSol(domain.lamports)} rent
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        {truncated ? (
          <p className="text-[11px] leading-relaxed text-subtle">
            Showing the first 250 names. Open Salvage to see the full list.
          </p>
        ) : null}

        <Link
          href="/salvage"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-glow transition-colors hover:text-violet-core"
        >
          Manage names in Salvage
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * NFTs and cNFTs, in their own card and their own scroll.
 *
 * Separate from the dust list because they are a different kind of thing: a sweep
 * never sells one, and a cNFT is a leaf in a tree rather than an account, so
 * mixing them into the token rows invited the reader to compare prices that do
 * not exist. The list scrolls on its own so a wallet holding hundreds of them
 * cannot push the rest of the page out of reach.
 */
function CollectiblesCard({ assets }: { assets: NonFungibleAsset[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          NFTs and cNFTs
        </CardTitle>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          {pluralize(assets.length, "collectible")} — never swept as dust. Burning
          one is an explicit choice in The Void.
        </p>
      </CardHeader>
      <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
        <ul className="max-h-72 divide-y divide-border/50 overflow-y-auto border-t border-border/60">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex items-center gap-3 px-5 py-2.5 sm:px-6"
            >
              <TokenLogo src={asset.imageUri} symbol={asset.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {asset.name}
                  </span>
                  {asset.compressed ? (
                    <Badge variant="accent" size="sm">
                      cNFT
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-subtle">
                  {typeof asset.collection === "string"
                    ? asset.collection
                    : (asset.collection?.name ?? asset.interface)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * What the headline deliberately leaves out.
 *
 * A single "recoverable" number invites the question "recoverable *how*?", and
 * the honest answer is a list of the things a sweep would refuse. Each line is a
 * count of real holdings, so the user can check one against their wallet.
 */
function LimitationsCard({
  limitations,
}: {
  limitations: RecoverableLimitations;
}) {
  const rows: Array<{ label: string; count: number; why: string }> = [
    {
      label: "Staked in a protocol",
      count: limitations.staked,
      why: "Liquid staking tokens — mSOL, JitoSOL and the like. They are ordinary SPL tokens, but a sweep will not sell one: unwinding a staking position is a deliberate move for the protocol's own app, not something to happen on the way past some dust. The position is intact and still earning; it is simply not part of this total.",
    },
    {
      label: "Held in a liquidity pool",
      count: limitations.poolLike,
      why: "The mint is controlled by a program, so the balance is a share of something rather than a token with a market. There is nothing to sell it to and a funded account cannot be closed, so neither the value nor the rent can be brought back from here.",
    },
    {
      label: "Frozen accounts",
      count: limitations.frozen,
      why: "The issuer's freeze authority has locked these. Nothing can move them until it releases them, so neither the value nor the rent is recoverable.",
    },
    {
      label: "Transfer-hook mints",
      count: limitations.transferHook,
      why: "These run custom code on every transfer. Spacedust refuses them rather than sign an instruction whose effects it cannot see.",
    },
    {
      label: "Transfer-fee mints",
      count: limitations.transferFee,
      why: "The value still counts, but the account keeps a residue after the swap, so it cannot be closed and its rent cannot come back.",
    },
    {
      label: "Account not identified",
      count: limitations.unknownAccount,
      why: "We could not find the account holding this balance. Closing a guessed address instead would fail on chain, so it is left alone.",
    },
    {
      label: "Closed by another key",
      count: limitations.emptyAuthority,
      why: "These accounts are already empty, but another key is set as their close authority — and once one is set, the token program refuses the owner's signature. Only that key can close them.",
    },
    {
      label: "Withheld transfer fees",
      count: limitations.emptyWithheldFees,
      why: "These accounts are already empty but still hold withheld Token-2022 fees. The token program refuses to close an account until its mint harvests them, which needs the mint's authority, not the holder's.",
    },
  ].filter((row) => row.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          What that total leaves out
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.label} className="flex gap-2.5">
              <Badge variant="warning" size="sm" className="mt-0.5 shrink-0">
                {row.count}
              </Badge>
              <div className="min-w-0">
                <p className="text-xs font-medium">{row.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">
                  {row.why}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * The dust itself, read-only.
 *
 * No checkboxes and no selection: on this page nothing can be moved, and a
 * control that does nothing is worse than no control. The badges are the same
 * ones the sweeper uses, so a token that will be skipped there reads the same
 * way here.
 *
 * Every token is rendered. The list gets its own scroll container rather than a
 * row cap, because "and 180 more" is not a wallet scan.
 */
function TokenRows({ tokens }: { tokens: DustToken[] }) {
  if (tokens.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          Dust held
        </CardTitle>
        <p className="mt-1 text-xs text-subtle">
          All {pluralize(tokens.length, "fungible token")}, largest first.
        </p>
      </CardHeader>
      <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
        <ul className="max-h-[32rem] divide-y divide-border/50 overflow-y-auto border-t border-border/60">
          {tokens.map((token) => (
            <li
              key={token.mint}
              className="flex items-center gap-3 px-5 py-2.5 sm:px-6"
            >
              <TokenLogo src={token.logoUri} symbol={token.symbol} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {token.symbol}
                  </span>
                  {token.program === "token2022" ? (
                    <Badge variant="token2022" size="sm">
                      2022
                    </Badge>
                  ) : null}
                  {token.frozen ? (
                    <Badge variant="warning" size="sm">
                      Frozen
                    </Badge>
                  ) : null}
                  {token.hasTransferHook ? (
                    <Badge variant="warning" size="sm">
                      Hook
                    </Badge>
                  ) : null}
                  {token.hasTransferFee ? (
                    <Badge variant="warning" size="sm">
                      Fee
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-subtle" title={token.name}>
                  {token.name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums">
                  {formatUsd(token.valueUsd)}
                </p>
                <p className="text-xs text-subtle">
                  {formatAmount(token.balance, 4)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}


/**
 * Staking positions we can name, kept out of the dust list.
 *
 * These are ordinary SPL tokens — the wallet holds them exactly like dust — so
 * without this card they would be listed as anonymous program-controlled mints
 * (`poolLike`; nearly every LST is one) or swept into SOL on the way past. Naming
 * the protocol is the whole point: "staked with Marinade" is a different fact
 * from "held in a program", and it is the one that tells the holder what to do.
 *
 * Nothing here is moved, and nothing here is counted in the total above — a
 * staking position is unwound in the protocol's own app, not by a dust sweeper.
 * See `lib/staking/staked-tokens.ts`.
 */
function StakedPositionsCard({
  positions,
  accounts,
  accountsError,
}: {
  positions: DustToken[];
  accounts: StakedAccount[];
  accountsError: string | null;
}) {
  // Nothing to say, and no failed read to admit to. The section hides itself,
  // like every other one here.
  if (
    positions.length === 0 &&
    accounts.length === 0 &&
    accountsError === null
  ) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          Staked in other protocols
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
        <ul className="divide-y divide-border/50 border-t border-border/60">
          {positions.map((token) => (
            <li
              key={token.mint}
              className="flex items-center gap-3 px-5 py-2.5 sm:px-6"
            >
              <TokenLogo src={token.logoUri} symbol={token.symbol} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {token.symbol}
                  </span>
                  <Badge variant="accent" size="sm">
                    {token.staked?.protocol ?? "Staked"}
                  </Badge>
                </div>
                <p className="truncate text-xs text-subtle" title={token.name}>
                  Staked {token.staked?.underlying ?? "SOL"} · {token.name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {/* The amount and its value, because that is what the position is
                    worth — not what a sweep would return, which is nothing. */}
                <p className="font-mono text-sm tabular-nums">
                  {formatAmount(token.balance, 4)}
                </p>
                <p className="font-mono text-xs text-subtle">
                  {token.valueUsd > 0
                    ? formatUsd(token.valueUsd)
                    : truncateAddress(token.mint)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {accounts.length > 0 ? (
          <ul className="divide-y divide-border/50 border-t border-border/60">
            {accounts.map((account) => (
              <li
                key={account.address}
                className="flex items-center gap-3 px-5 py-2.5 sm:px-6"
              >
                <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-white/4">
                  <Landmark className="size-3.5 text-muted" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      Staked SOL
                    </span>
                    <Badge
                      variant={account.state === "active" ? "success" : "muted"}
                      size="sm"
                    >
                      {account.state}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-subtle">
                    {account.validator
                      ? `Validator ${truncateAddress(account.validator)}`
                      : "Not delegated to a validator"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular-nums">
                    {formatAmount(account.sol, 4)}
                  </p>
                  <p className="font-mono text-xs text-subtle">
                    {truncateAddress(account.address)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t border-border/60 px-5 py-3 text-xs leading-relaxed text-subtle sm:px-6">
          {accountsError === null
            ? STAKED_POSITION_NOTE
            : "We could not read this wallet's native stake accounts, so any it holds are missing from this list — missing here, not gone from the wallet."}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Holdings whose mint is controlled by a program: a pool share, or a receipt.
 *
 * Kept out of the dust list on purpose — they are not dust, and they are not
 * something this scan should ever imply a number for. There is no market to sell
 * one in and a funded account cannot be closed, so the whole point of showing
 * them is to answer "why is this not in the total?" before it is asked.
 *
 * The reading is a *signal*: the mint's authority sits off the ed25519 curve, so
 * the mint belongs to a program rather than a keypair. That is what a Raydium or
 * Orca position looks like, and it is also what a staking receipt or a vault
 * share looks like. The note says exactly that much and no more — see
 * `lib/sweep/pool-positions.ts`.
 */
function PoolPositionsCard({
  positions,
  error,
}: {
  positions: DustToken[];
  error: string | null;
}) {
  // Nothing to say, and no failed read to admit to. The section hides itself,
  // like every other one here.
  if (positions.length === 0 && error === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          In a liquidity pool
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
        {positions.length > 0 ? (
          <ul className="divide-y divide-border/50 border-t border-border/60">
            {positions.map((token) => (
              // No selection and no checkbox: on this page nothing can be moved.
              <li
                key={token.mint}
                className="flex items-center gap-3 px-5 py-2.5 sm:px-6"
              >
                <TokenLogo src={token.logoUri} symbol={token.symbol} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {token.symbol}
                    </span>
                    <Badge variant="warning" size="sm">
                      Pool
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-subtle" title={token.name}>
                    {token.name}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {/* The amount, deliberately not a price: valuing a share means
                      reading the pool, and this scan does not do that yet. An
                      invented number here would be the one figure nobody could
                      check. */}
                  <p className="font-mono text-sm tabular-nums">
                    {formatAmount(token.balance, 4)}
                  </p>
                  <p className="font-mono text-xs text-subtle">
                    {truncateAddress(token.mint)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="border-t border-border/60 px-5 py-3 text-xs leading-relaxed text-subtle sm:px-6">
          {error === null
            ? POOL_POSITION_NOTE
            : `We could not read this wallet's mint authorities (${error}), so any position it holds is missing from this list — missing here, not gone from the wallet.`}
        </p>
      </CardContent>
    </Card>
  );
}

