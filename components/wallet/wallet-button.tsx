"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@/components/wallet/wallet-modal";
import { Check, Copy, LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Tooltip } from "@/components/ui/tooltip";

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
  const [copied, setCopied] = useState(false);

  if (!connected || !publicKey) {
    return (
      <Button
        className={className}
        onClick={open}
        loading={connecting}
        loadingText="Connecting…"
        aria-label="Connect a Solana wallet"
      >
        <Wallet aria-hidden />
        Connect Wallet
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
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="glass flex items-center gap-1 rounded-xl p-1 pr-2.5">
        <span
          aria-hidden
          className="ml-1.5 size-2 shrink-0 rounded-full bg-success shadow-[0_0_8px] shadow-success/60"
        />
        <span
          className="font-mono text-[13px] font-medium tracking-tight"
          title={address}
        >
          {truncateAddress(address, 4, 4)}
        </span>

        <Tooltip content="Copy full address">
          <Button
            variant="ghost"
            size="icon-sm"
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