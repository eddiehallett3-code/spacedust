"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Check, Copy, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/utils/format";

/**
 * Wallet actions inside the mobile menu.
 *
 * The header keeps only the compact address while the menu is available; copy
 * and disconnect live here so the menu trigger never has to compete with three
 * controls for the last few pixels of a phone header.
 */
export function WalletMenuActions() {
  const { publicKey, connected, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  if (!connected || !publicKey) return null;

  const address = publicKey.toBase58();

  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
      toast.success("Address copied", {
        description: truncateAddress(address, 6, 6),
      });
    } catch {
      toast("Copy failed", { description: address });
    }
  };

  return (
    <div className="mt-3 border-t border-border/60 px-3 pt-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-subtle">
        Wallet
      </p>
      <p className="mt-1 font-mono text-sm" title={address}>
        {truncateAddress(address, 6, 6)}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => void copyAddress()}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy address"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => void disconnect()}
        >
          <LogOut aria-hidden />
          Disconnect
        </Button>
      </div>
    </div>
  );
}
