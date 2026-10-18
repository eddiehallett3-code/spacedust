"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card } from "@/components/ui/card";
import { ConnectWalletCta } from "@/components/wallet/wallet-button";
import { AssetPicker } from "@/components/payload/asset-picker";
import { RecipientField } from "@/components/payload/recipient-field";
import { SendPreview } from "@/components/payload/send-preview";
import { SweepError } from "@/components/sweep/controls-column";
import { usePayload } from "@/hooks/use-payload";
import { useDestinationVerification } from "@/hooks/use-destination-verification";
import { useWalletScan } from "@/hooks/use-wallet-scan";
import { unsendableAssetReason } from "@/lib/payload/plan-send";
import {
  destinationIsVerified,
  validateDestination,
} from "@/lib/payload/destination";
import { resolvePreparationGate, payloadRequestKey } from "@/lib/payload/preparation";
import { previewAction } from "@/lib/sweep/preview";
import { SOL_SEND_FEE_RESERVE_LAMPORTS } from "@/lib/utils/constants";
import { parseBaseAmount, toBaseAmount } from "@/lib/utils/sanitize";
import { truncateAddress } from "@/lib/utils/format";

/**
 * Payload — batch sending.
 *
 * Three decisions and a preview, in that order: where it is going, what is going,
 * and what it costs. The order is not decoration — a batch that lands at the wrong
 * address cannot be undone, so the destination is settled before anything is
 * selected, and the preview is the last chance to notice.
 *
 * The costs are the ones people do not expect. A send is not free: the recipient
 * may need an account for a mint they have never held, and the **sender** pays
 * that deposit. It can exceed the rent the send frees, which the preview says
 * outright rather than leaving to be discovered on Solscan.
 */
export function PayloadApp() {
  const { connected } = useWallet();
  const scan = useWalletScan();
  const verification = useDestinationVerification();
  const payload = usePayload();

  const [recipient, setRecipient] = useState("");
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  /**
   * How much of each token to send, as typed, in whole units.
   *
   * Absent or empty means all of it, which is the default and the common case —
   * a sweep-shaped send of everything. A partial amount is a real choice though:
   * plenty of people want to send half a balance and keep the rest, and the
   * alternative was editing the number by hand outside the app.
   *
   * A partial send cannot close the account, so its rent is not reclaimed and no
   * fee is charged on rent that was not freed — the planner decides all of that
   * from the amount, and the preview's figures follow.
   */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  /**
   * Native SOL, which is its own kind of item rather than a token: no mint, no
   * account to close, no rent. Selected separately because it cannot live in
   * `selectedTokens` — that set is keyed by mint.
   */
  const [solSelected, setSolSelected] = useState(false);
  /** SOL to send, as typed, in whole units. Empty means the maximum. */
  const [solAmount, setSolAmount] = useState("");
  /**
   * Verification defaults to on.
   *
   * The toggle exists for the case that prompted it — sending to somebody else's
   * wallet, where a test transfer still proves the address can receive but the
   * manual "I checked it" step belongs to them — but the safe default for a tool
   * whose entire job is not losing things is on.
   */
  const [requireVerify, setRequireVerify] = useState(true);

  // An NFT the send path cannot handle yet is still listed, with its reason, so
  // nothing looks like it silently went missing from the wallet.
  const sendable = useMemo(
    () => scan.nonFungibles.filter((asset) => unsendableAssetReason(asset) === null),
    [scan.nonFungibles],
  );
  const refused = useMemo(
    () => scan.nonFungibles.filter((asset) => unsendableAssetReason(asset) !== null),
    [scan.nonFungibles],
  );

  /**
   * What was typed per mint, resolved to base units.
   *
   * Anything unreadable, zero, or above the balance becomes a `problem` rather
   * than falling back to the full balance: silently sending everything because a
   * field was mistyped is the one outcome this must never produce.
   */
  const requestedAmounts = useMemo(() => {
    const resolved = new Map<
      string,
      { rawAmount: string } | { problem: string }
    >();

    for (const mint of selectedTokens) {
      const typed = amounts[mint]?.trim() ?? "";
      if (typed.length === 0) continue;

      const token = scan.tokens.find((candidate) => candidate.mint === mint);
      if (!token) continue;
      const label = token.symbol || truncateAddress(token.mint);

      const base = toBaseAmount(typed, token.decimals);
      if (base === null) {
        resolved.set(mint, {
          problem: `Enter the amount of ${label} as a plain number, with no more than ${token.decimals} decimal place${token.decimals === 1 ? "" : "s"}.`,
        });
        continue;
      }
      if (base <= 0n) {
        resolved.set(mint, {
          problem: `The amount of ${label} has to be more than zero — untick it to leave it out instead.`,
        });
        continue;
      }
      const balance = parseBaseAmount(token.rawAmount) ?? 0n;
      if (base > balance) {
        resolved.set(mint, {
          problem: `You asked to send more ${label} than the wallet holds.`,
        });
        continue;
      }
      resolved.set(mint, { rawAmount: base.toString() });
    }

    return resolved;
  }, [amounts, scan.tokens, selectedTokens]);

  /** The first amount problem, in the order the tokens are listed. */
  const amountProblem = useMemo(() => {
    for (const entry of requestedAmounts.values()) {
      if ("problem" in entry) return entry.problem;
    }
    return null;
  }, [requestedAmounts]);

  /**
   * The most SOL a send can move.
   *
   * The batch pays its network fees from this same wallet, so an amount that
   * leaves nothing behind is an amount that cannot be sent. The reserve is the
   * floor the UI calls "max" — it is not a fee, and Spacedust keeps none of it.
   */
  const solMaxLamports = Math.max(
    0,
    (scan.native?.lamports ?? 0) - SOL_SEND_FEE_RESERVE_LAMPORTS,
  );

  /** The SOL amount to send, or the reason it cannot be. */
  const solRequest = useMemo(() => {
    if (!solSelected) {
      return { lamports: null as string | null, problem: null as string | null };
    }

    const typed = solAmount.trim();
    if (typed.length === 0) {
      return solMaxLamports > 0
        ? { lamports: String(solMaxLamports), problem: null }
        : {
            lamports: null,
            problem:
              "There is no SOL to send once the network-fee reserve is kept.",
          };
    }

    const base = toBaseAmount(typed, 9);
    if (base === null) {
      return {
        lamports: null,
        problem:
          "Enter the SOL amount as a plain number, with no more than 9 decimal places.",
      };
    }
    if (base <= 0n) {
      return {
        lamports: null,
        problem:
          "The SOL amount has to be more than zero — untick it to leave it out instead.",
      };
    }
    if (base > BigInt(solMaxLamports)) {
      return {
        lamports: null,
        problem: `That would leave less than ${(SOL_SEND_FEE_RESERVE_LAMPORTS / 1e9).toFixed(3)} SOL behind, and the batch pays its network fee from this wallet.`,
      };
    }

    return { lamports: base.toString(), problem: null };
  }, [solAmount, solMaxLamports, solSelected]);

  const selectedTokenList = useMemo(
    () =>
      scan.tokens
        .filter((token) => selectedTokens.has(token.mint))
        .map((token) => {
          const requested = requestedAmounts.get(token.mint);
          // `rawAmount` is what the planner sends: overriding it here is the
          // whole mechanism, and it is why a partial send needs no planner change.
          return requested && "rawAmount" in requested
            ? { ...token, rawAmount: requested.rawAmount }
            : token;
        }),
    [requestedAmounts, scan.tokens, selectedTokens],
  );
  const selectedAssetList = useMemo(
    () => sendable.filter((asset) => selectedAssets.has(asset.id)),
    [selectedAssets, sendable],
  );

  const check = validateDestination(recipient, scan.owner);
  const itemCount =
    selectedTokenList.length + selectedAssetList.length + (solSelected ? 1 : 0);

  /**
   * Whether the two actions are available, and why not when they are not.
   *
   * The rules live in `lib/payload/preparation.ts` so they can be tested. A
   * silently disabled button is indistinguishable from a broken one, this flow
   * has already produced both, and neither was diagnosable from the screen — so
   * the conditions are asserted in `preparation.test.ts` instead of living only
   * here.
   */
  const gate = resolvePreparationGate({
    destinationOk: check.ok,
    destinationVerified: destinationIsVerified(
      verification.verification,
      recipient,
      requireVerify,
    ),
    verifyRequired: requireVerify,
    itemCount,
    amountProblem: amountProblem ?? solRequest.problem,
    preparedFor: payload.request?.recipient ?? null,
    recipient,
  });

  /**
   * A preview belongs to one request, not to the page.
   *
   * `execute()` signs the batch that was prepared. Every control that changes
   * what that batch would contain — a tickbox, a typed amount, the SOL switch —
   * therefore has to discard the preview the moment it moves, or the wallet is
   * asked to sign a batch the screen no longer describes. That is the same rule
   * the sweep and the two burn flows apply (`lib/sweep/preview.ts`); Payload was
   * the one flow that only re-checked the destination.
   *
   * The key is order-independent: a rescan that merely reorders the same
   * holdings is the same request, and must not throw away a preview being read.
   */
  const requestKey = useMemo(
    () =>
      payloadRequestKey({
        recipient,
        tokens: selectedTokenList,
        assets: selectedAssetList.map((asset) => asset.id),
        solLamports: solRequest.lamports,
        solSelected,
      }),
    [
      recipient,
      selectedTokenList,
      selectedAssetList,
      solRequest.lamports,
      solSelected,
    ],
  );
  const requestKeyRef = useRef(requestKey);
  useEffect(() => {
    const action = previewAction({
      previousKey: requestKeyRef.current,
      currentKey: requestKey,
      isBusy: payload.isBusy,
      hasSummary: payload.summary !== null,
      hasPreview: payload.packed.length > 0,
    });
    if (action === "none") return;
    requestKeyRef.current = requestKey;
    if (action === "discard") payload.reset();
  }, [requestKey, payload]);

  const toggle = (
    current: Set<string>,
    apply: (next: Set<string>) => void,
    key: string,
  ): void => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  if (!connected) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm font-medium">
          Connect the wallet you are sending from
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted">
          Payload builds and simulates the batch locally, then asks for one
          signature. It holds no keys and cannot move anything on its own.
        </p>
        <div className="mt-4 flex justify-center">
          <ConnectWalletCta />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RecipientField
        value={recipient}
        onChange={setRecipient}
        owner={scan.owner}
        requireVerify={requireVerify}
        onRequireVerifyChange={setRequireVerify}
        verification={verification}
      />

      <AssetPicker
        tokens={scan.tokens}
        sendable={sendable}
        refused={refused}
        isScanning={scan.isScanning}
        onRescan={() => void scan.rescan()}
        selectedTokens={selectedTokens}
        selectedAssets={selectedAssets}
        amounts={amounts}
        onAmountChange={(mint, value) =>
          setAmounts((current) => ({ ...current, [mint]: value }))
        }
        nativeLamports={scan.native?.lamports ?? 0}
        solSelected={solSelected}
        solAmount={solAmount}
        solProblem={solSelected ? solRequest.problem : null}
        solMaxLamports={solMaxLamports}
        onToggleSol={() => setSolSelected((current) => !current)}
        onSolAmountChange={setSolAmount}
        onToggleToken={(mint) => toggle(selectedTokens, setSelectedTokens, mint)}
        onToggleAsset={(id) => toggle(selectedAssets, setSelectedAssets, id)}
        onSelectAllTokens={(all) =>
          setSelectedTokens(
            all ? new Set(scan.tokens.map((token) => token.mint)) : new Set(),
          )
        }
        // NFTs and cNFTs share one selection set but are two tabs, so this
        // touches only the kind that was asked for: "select all cNFTs" must not
        // quietly add the NFTs the reader is not looking at.
        onSelectAllAssets={(all, compressed) => {
          const ids = sendable
            .filter((asset) => asset.compressed === compressed)
            .map((asset) => asset.id);
          setSelectedAssets((previous) => {
            const next = new Set(previous);
            for (const id of ids) {
              if (all) next.add(id);
              else next.delete(id);
            }
            return next;
          });
        }}
      />

      <SweepError error={payload.error} />

      <SendPreview
        payload={payload}
        itemCount={itemCount}
        canPrepare={gate.canPrepare}
        canSend={gate.canSend}
        blockedReason={gate.blockedReason}
        sendBlockedReason={gate.sendBlockedReason}
        onPrepare={() => {
          if (check.address) {
            void payload.prepare({
              recipient: check.address,
              tokens: selectedTokenList,
              assets: selectedAssetList,
              requireVerification: requireVerify,
              verifiedAddress: verification.verification?.arrived
                ? verification.verification.address
                : null,
              solLamports: solRequest.lamports,
              solBalanceLamports: scan.native?.lamports ?? null,
            });
          }
        }}
        onSend={() => void payload.execute(recipient)}
        onFinish={() => {
          payload.reset();
          // The wallet has changed — those assets were just sent — so returning to
          // the picker against the old scan showed tokens that were no longer
          // there, and the only way out was a manual refresh. Re-read the chain
          // here instead.

          // The typed amounts go too, and for the same reason: a partial send
          // leaves the token behind with a smaller balance, so an amount sized
          // against the old balance would now trip "more than the wallet holds"
          // right after a successful send. Empty means "all of it", which is the
          // right default for a fresh batch.
          setAmounts({});
          setSolSelected(false);
          setSolAmount("");
          void scan.rescan();
        }}
      />
    </div>
  );
}
