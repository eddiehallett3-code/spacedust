"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  Landmark,
  QrCode,
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
  NonFungibleAsset,
  StakedAccount,
  WalletScan,
} from "@/types/token";

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

/** How many rows to spell out before collapsing the tail. */
const VISIBLE_ROWS = 25;

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
        `/api/tokens?owner=${encodeURIComponent(address)}`,
        {
          signal: controller.signal,
          timeoutMs: 45_000,
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

/** One headline figure, with the caveat that belongs beside it. */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-white/2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-base tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-subtle">{hint}</p>
    </div>
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
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted">Reading the chain…</p>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
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
  const visible = scan.tokens.slice(0, VISIBLE_ROWS);
  const hidden = scan.tokens.length - visible.length;
  const nfts = scan.nonFungibles.length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-medium text-muted">
              Recoverable
            </CardTitle>
            <p className="mt-1 font-mono text-3xl tabular-nums">
              {recoverable.totalUsd == null
                ? "—"
                : formatUsd(recoverable.totalUsd)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-subtle">
              {recoverable.emptyAccounts > 0
                ? `${formatSol(recoverable.rentLamports)} of that is rent sitting in ${pluralize(
                    recoverable.emptyAccounts,
                    "account",
                  )} that ${recoverable.emptyAccounts === 1 ? "is" : "are"} already empty — close them and it is yours.`
                : `Nothing here is rent: ${pluralize(
                    recoverable.closableAccounts,
                    "account",
                  )} still ${recoverable.closableAccounts === 1 ? "holds" : "hold"} a balance, and rent only comes back once that balance is sold or burned.`}
              {recoverable.rentUsd == null
                ? " Valued in SOL above because there is no SOL price to convert at."
                : ""}
            </p>
          </div>
          {owner ? (
            <span className="shrink-0 rounded-full border border-border bg-white/3 px-2.5 py-1 font-mono text-[11px] text-muted">
              {truncateAddress(owner, 4, 4)}
            </span>
          ) : null}
        </CardHeader>

        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2">
          <Stat
            label="Dust value"
            value={formatUsd(recoverable.sweepableValueUsd)}
            hint={`Across ${pluralize(scan.tokens.length, "token")}, valued by Jupiter.`}
          />
          <Stat
            label="Rent in empty accounts"
            value={formatSol(recoverable.rentLamports)}
            hint={
              recoverable.emptyAccounts > 0
                ? `${pluralize(recoverable.emptyAccounts, "account")} ${recoverable.emptyAccounts === 1 ? "is" : "are"} already empty. Funded accounts are not counted — their rent only returns once the balance is sold or burned.`
                : "No account here is empty yet, so there is no rent to collect today."
            }
          />
          <Stat
            label="Native SOL"
            value={`${scan.native.sol.toFixed(4)} SOL`}
            hint="Not counted as recoverable: a sweep cannot spend the balance that pays for it."
          />
          <Stat
            label="Wallet total"
            value={
              recoverable.walletValueUsd == null
                ? "—"
                : formatUsd(recoverable.walletValueUsd)
            }
            hint={`Every token plus native SOL, across ${pluralize(scan.tokens.length, "token")}, valued by Jupiter. NFTs are not priced here.`}
          />
        </CardContent>
      </Card>

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

      {/* Everything else the scan knows, in charts. It sits between the headline
          and the long token list on purpose: the list is the detail, and this is
          the shape of the thing — which is what someone looking up a wallet they
          do not recognise actually wants first. */}
      <WalletInsights scan={scan} recoverable={recoverable} />

      <TokenRows tokens={visible} hiddenCount={hidden} />

      {nfts > 0 ? <CollectiblesCard assets={scan.nonFungibles} /> : null}

      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm leading-relaxed text-muted">
            To collect any of this, connect a wallet you control. The figure above
            is the number the sweep itself will be held to.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectWalletCta size="md" />
            <Button variant="secondary" size="md" onClick={onCopyLink}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
 */
function TokenRows({
  tokens,
  hiddenCount,
}: {
  tokens: DustToken[];
  hiddenCount: number;
}) {
  if (tokens.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted">
          Dust held
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-3 sm:p-0 sm:pt-3">
        <ul className="divide-y divide-border/50 border-t border-border/60">
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
        {hiddenCount > 0 ? (
          <p className="border-t border-border/60 px-5 py-2.5 text-xs text-subtle sm:px-6">
            and {pluralize(hiddenCount, "more token")} — the link above still
            counts every one of them.
          </p>
        ) : null}
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

