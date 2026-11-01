"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@/components/wallet/wallet-modal";
import { Check, Copy, LogOut, Turtle, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { useHolderWaiver } from "@/hooks/use-holder-waiver";

/**
 * Wallet connect / account button.
 *
 * Built on `@solana/wallet-adapter-react-ui`'s modal rather than the default
 * `WalletMultiButton`, because the default styling cannot match the design
 * system and ships its own CSS.
 */
export function WalletButton({ className }: { className?: string }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { open } = useWalletModal();
  const { entitled: isHolder } = useHolderWaiver();
  const [copied, setCopied] = useState(false);

  if (!connected || !publicKey) {
    return (
      <Button
        variant="outline"
        className={className}
        onClick={open}
        loading={connecting}
        loadingText="Connecting…"
        aria-label="Connect a Solana wallet"
      >
        <Wallet aria-hidden />
        <span className="hidden sm:inline">Connect</span>
      </Button>
    );
  }

  const address = publicKey.toBase58();

  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("Address copied", {
        description: truncateAddress(address, 6, 6),
      });
    } catch {
      // Clipboard access can be blocked by permissions policy or an insecure
      // context. Showing the address in a toast is a usable fallback.
      toast("Copy failed", { description: address });
    }
  };

  return (
    <div className={cn("flex items-center", className)}>
      <div className="glass flex items-center gap-0.5 rounded-lg p-0.5 pr-1">
        <span
          aria-hidden
          className="ml-1 size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px] shadow-success/60"
        />
        <span
          className="px-0.5 font-mono text-2xs font-medium tracking-tight sm:text-xs"
          title={address}
        >
          {truncateAddress(address, 4, 4)}
        </span>

        {/* The holder mark: the only thing a Turtles holder has to see to know the
            fee is off, and it appears the moment they connect rather than when
            they build a plan. A tooltip and an `sr-only` line carry the meaning —
            a turtle on its own is decoration, and this one is a statement about
            money. */}
        {isHolder ? (
          <Tooltip content="Turtles holder — 0% fee">
            <span
              tabIndex={0}
              className="ml-0.5 flex shrink-0 items-center rounded-full p-0.5 text-violet-glow outline-none focus-visible:ring-2 focus-visible:ring-violet-core/60"
            >
              <Turtle className="size-3.5" aria-hidden />
              <span className="sr-only">
                Turtles holder: the reclaim fee is waived.
              </span>
            </span>
          </Tooltip>
        ) : null}

        <Tooltip content="Copy full address">
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden size-7 sm:inline-flex sm:size-8"
            onClick={copyAddress}
            aria-label="Copy wallet address"
          >
            {copied ? (
              <Check className="text-success" aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
          </Button>
        </Tooltip>

        <Tooltip content={`Disconnect ${wallet?.adapter.name ?? "wallet"}`}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden size-7 sm:inline-flex sm:size-8"
            onClick={() => void disconnect()}
            aria-label="Disconnect wallet"
          >
            <LogOut aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * Full-width connect prompt used on the main page.
 *
 * Separated from `WalletButton` so the hero can have its own larger treatment
 * while both share the exact same connect behaviour.
 */
export function ConnectWalletCta({
  className,
  size = "lg",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  const { open } = useWalletModal();
  const { connected } = useWallet();

  if (connected) return null;

  return (
    <Button
      size={size}
      className={className}
      onClick={open}
      aria-label="Connect a Solana wallet"
    >
      <Wallet aria-hidden />
      Connect Wallet
    </Button>
  );
}