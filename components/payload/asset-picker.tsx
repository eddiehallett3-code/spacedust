"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TokenLogo } from "@/components/scanner/token-logo";
import { unsendableAssetReason } from "@/lib/payload/plan-send";
import { formatAmount, truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { DustToken, NonFungibleAsset } from "@/types/token";

/**
 * What goes in the batch.
 *
 * Three tabs rather than one merged list, for the reason The Void learned the
 * hard way: an uncompressed NFT arrives from the index looking exactly like a
 * token — balance 1, decimals 0, its own account — so a single list is one
 * mis-click away from sending something irreplaceable as if it were dust.
 *
 * cNFTs get their own tab for a second reason: they are not accounts. Sending one
 * moves a leaf in a merkle tree, so there is no rent to reclaim and nothing to
 * close — facts the NFT rows state and the cNFT rows must not.
 *
 * Assets the send path cannot handle yet are listed with their reason rather than
 * hidden, so nothing appears to have gone missing from the wallet.
 */
export function AssetPicker({
  tokens,
  sendable,
  refused,
  isScanning,
  onRescan,
  selectedTokens,
  selectedAssets,
  amounts,
  onAmountChange,
  onToggleToken,
  onToggleAsset,
  onSelectAllTokens,
  onSelectAllAssets,
}: {
  tokens: DustToken[];
  sendable: NonFungibleAsset[];
  refused: NonFungibleAsset[];
  isScanning: boolean;
  onRescan: () => void;
  selectedTokens: Set<string>;
  selectedAssets: Set<string>;
  /** What the user typed per mint, in whole units. Empty means all of it. */
  amounts: Record<string, string>;
  onAmountChange: (mint: string, value: string) => void;
  onToggleToken: (mint: string) => void;
  onToggleAsset: (id: string) => void;
  onSelectAllTokens: (all: boolean) => void;
  /**
   * Select or deselect every sendable asset of one kind.
   *
   * `compressed` says which list: NFTs and cNFTs share one selection set but are
   * two tabs, and "select all" must only touch the tab it is on.
   */
  onSelectAllAssets: (all: boolean, compressed: boolean) => void;
}) {
  const [tab, setTab] = useState<"tokens" | "nfts" | "cnfts">("tokens");

  // Two kinds of collectible, two tabs. They are not the same thing to send: an
  // NFT is an account that is emptied and closed, so its rent comes back; a cNFT
  // is a leaf in a merkle tree with no account, no close and no rent at all.
  // Sharing one list would make the rent column a lie for whichever half the
  // reader was looking at.
  const sendableNfts = sendable.filter((asset) => !asset.compressed);
  const sendableCnfts = sendable.filter((asset) => asset.compressed);
  const refusedNfts = refused.filter((asset) => !asset.compressed);
  const refusedCnfts = refused.filter((asset) => asset.compressed);

  const activeAssets =
    tab === "tokens" ? [] : tab === "nfts" ? sendableNfts : sendableCnfts;
  const activeRefused =
    tab === "tokens" ? [] : tab === "nfts" ? refusedNfts : refusedCnfts;
  const activeSelected = activeAssets.filter((asset) =>
    selectedAssets.has(asset.id),
  ).length;
  const allActiveSelected =
    activeAssets.length > 0 && activeSelected === activeAssets.length;

  const allTokensSelected =
    tokens.length > 0 && selectedTokens.size === tokens.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>What is being sent</CardTitle>
          <Button variant="ghost" size="sm" disabled={isScanning} onClick={onRescan}>
            <RefreshCw
              className={cn("mr-1.5 size-3.5", isScanning && "animate-spin")}
              aria-hidden
            />
            {isScanning ? "Scanning…" : "Rescan"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={tab === "tokens" ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab("tokens")}
          >
            Tokens
            {selectedTokens.size > 0 ? (
              <Badge variant="accent" size="sm" className="ml-2">
                {selectedTokens.size}
              </Badge>
            ) : null}
          </Button>
          <Button
            variant={tab === "nfts" ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab("nfts")}
          >
            NFTs
            {sendableNfts.filter((asset) => selectedAssets.has(asset.id))
              .length > 0 ? (
              <Badge variant="accent" size="sm" className="ml-2">
                {
                  sendableNfts.filter((asset) => selectedAssets.has(asset.id))
                    .length
                }
              </Badge>
            ) : null}
          </Button>
          <Button
            variant={tab === "cnfts" ? "primary" : "outline"}
            size="sm"
            onClick={() => setTab("cnfts")}
          >
            cNFTs
            {sendableCnfts.filter((asset) => selectedAssets.has(asset.id))
              .length > 0 ? (
              <Badge variant="accent" size="sm" className="ml-2">
                {
                  sendableCnfts.filter((asset) => selectedAssets.has(asset.id))
                    .length
                }
              </Badge>
            ) : null}
          </Button>
        </div>

        {tab === "tokens" ? (
          <label className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 pb-2 text-xs text-muted">
            <Checkbox
              checked={allTokensSelected}
              onCheckedChange={(checked) => onSelectAllTokens(checked === true)}
            />
            Select all {tokens.length} tokens
          </label>
        ) : (
          <label className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 pb-2 text-xs text-muted">
            <Checkbox
              checked={allActiveSelected}
              onCheckedChange={(checked) =>
                // Only this tab's assets: selecting every cNFT must not quietly
                // add the NFTs the reader is not looking at.
                onSelectAllAssets(checked === true, tab === "cnfts")
              }
            />
            Select all {activeAssets.length} sendable{" "}
            {tab === "cnfts" ? "cNFTs" : "NFTs"}
          </label>
        )}

        <div className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
          {tab === "tokens"
            ? tokens.map((token) => {
                const selected = selectedTokens.has(token.mint);
                const typed = amounts[token.mint]?.trim() ?? "";
                return (
                  <div
                    key={token.mint}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4",
                      selected && "bg-white/3",
                    )}
                  >
                    {/* The label wraps only the toggle area, so an amount typed
                        on the right cannot also toggle the row. */}
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => onToggleToken(token.mint)}
                      />
                      <TokenLogo
                        src={token.logoUri}
                        symbol={token.symbol}
                        size={28}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {token.symbol || truncateAddress(token.mint)}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {formatAmount(token.balance)} {token.symbol}
                        </span>
                      </span>
                      {token.frozen ? (
                        <Badge variant="warning" size="sm">
                          Frozen
                        </Badge>
                      ) : null}
                      {token.hasTransferFee ? (
                        <Badge variant="muted" size="sm">
                          Transfer fee
                        </Badge>
                      ) : null}
                    </label>

                    {selected ? (
                      <span className="flex w-32 shrink-0 items-center gap-1">
                        <Input
                          value={amounts[token.mint] ?? ""}
                          onChange={(event) =>
                            onAmountChange(token.mint, event.target.value)
                          }
                          placeholder={formatAmount(token.balance)}
                          inputMode="decimal"
                          aria-label={`Amount of ${token.symbol || "this token"} to send`}
                          className="h-8 px-2 text-xs"
                        />
                        {typed.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => onAmountChange(token.mint, "")}
                            className="shrink-0 text-[11px] text-violet-glow transition-colors hover:text-violet-core"
                          >
                            Max
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })
            : null}

          {tab !== "tokens"
            ? activeAssets.map((asset) => (
                <label
                  key={asset.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/4"
                >
                  <Checkbox
                    checked={selectedAssets.has(asset.id)}
                    onCheckedChange={() => onToggleAsset(asset.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {asset.name || truncateAddress(asset.id)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {asset.collection?.name ?? asset.interface}
                    </span>
                  </span>
                </label>
              ))
            : null}

          {/* Refused, not hidden: their reason is on the row. */}
          {tab !== "tokens"
            ? activeRefused.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-start gap-3 rounded-xl px-2 py-2 opacity-70"
                >
                  <span className="mt-0.5 size-[18px] shrink-0 rounded-[6px] border border-border-strong" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {asset.name || truncateAddress(asset.id)}
                    </span>
                    <span className="block text-xs leading-relaxed text-warning">
                      {unsendableAssetReason(asset)}
                    </span>
                  </span>
                </div>
              ))
            : null}

          {tab === "tokens" && tokens.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              {isScanning ? "Scanning…" : "No tokens in this wallet."}
            </p>
          ) : null}

          {tab !== "tokens" &&
          activeAssets.length === 0 &&
          activeRefused.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              {isScanning
                ? "Scanning…"
                : tab === "cnfts"
                  ? "No compressed NFTs in this wallet."
                  : "No NFTs in this wallet."}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
