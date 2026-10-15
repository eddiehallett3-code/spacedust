"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lock,
  QrCode,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QrScanner } from "@/components/payload/qr-scanner";
import {
  TEST_TRANSFER_LAMPORTS,
  destinationDrift,
  validateDestination,
} from "@/lib/payload/destination";
import { solscanTxUrl } from "@/lib/solana/submit";
import { formatSol } from "@/lib/utils/format";
import type { useDestinationVerification } from "@/hooks/use-destination-verification";

/**
 * Where the batch is going, and how sure the user is about it.
 *
 * Three things, in the order they matter:
 *
 *  1. **The address itself**, shown in groups of four once it parses. The grouping
 *     is not decoration: the risk being guarded against is a clipboard swap, which
 *     changes the middle of an address, and a middle nobody can read is a middle
 *     nobody can check. This is the one check that catches it — no amount of
 *     automation replaces it.
 *  2. **A test transfer**, off by default, for anyone who wants the address proved
 *     before a hundred assets go to it.
 *  3. **A lock and an alarm.** Once verified, the address is what the plan is
 *     built against; if the field changes afterwards the verification is void and
 *     nothing will be prepared until the new address is verified in its own right.
 */
export function RecipientField({
  value,
  onChange,
  owner,
  requireVerify,
  onRequireVerifyChange,
  verification,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The connected wallet, so a self-send is refused before it is attempted. */
  owner: string | null;
  requireVerify: boolean;
  onRequireVerifyChange: (next: boolean) => void;
  verification: ReturnType<typeof useDestinationVerification>;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const check = validateDestination(value, owner);
  const drift = destinationDrift(verification.verification, value);
  const isVerified =
    verification.verification?.arrived === true &&
    verification.verification.address === value.trim();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Where is it going?</CardTitle>
          {isVerified ? (
            <Badge variant="success">
              <Lock className="size-3" aria-hidden />
              Verified
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Recipient wallet address"
            spellCheck={false}
            autoComplete="off"
            aria-label="Recipient wallet address"
            aria-invalid={value.trim() !== "" && !check.ok}
            className="min-w-0 flex-1"
          />
          {/* Mobile-first: typing base58 on a phone keyboard is the worst part of
              sending anything, and a wallet's receive code is already a QR. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setScannerOpen(true)}
            aria-label="Scan a QR code for the recipient address"
          >
            <QrCode className="size-4" aria-hidden />
            <span className="ml-1.5 hidden sm:inline">Scan</span>
          </Button>
        </div>

        <QrScanner
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onScan={(address) => {
            // Straight into the field the user can see, so the address is still
            // read back in groups and the verification rules still apply.
            onChange(address);
            setScannerOpen(false);
          }}
        />

        {/* The readable copy, for the comparison only a person can make. */}
        {check.ok && check.address ? (
          <p className="font-mono text-xs leading-relaxed break-all text-muted">
            {check.address.replace(/(.{4})/g, "$1 ").trim()}
          </p>
        ) : null}

        {value.trim() !== "" && !check.ok && check.message ? (
          <p className="flex items-start gap-1.5 text-xs text-danger">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {check.message}
          </p>
        ) : null}

        {drift.drifted && drift.message ? (
          <div className="rounded-xl border border-warning/25 bg-warning/6 p-3">
            <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              {drift.message}
            </p>
            <p className="mt-1.5 font-mono text-[11px] break-all text-muted">
              Verified: {drift.from}
            </p>
            <p className="font-mono text-[11px] break-all text-muted">
              Now: {drift.to}
            </p>
          </div>
        ) : null}

        <div className="flex items-start gap-2.5 rounded-xl border border-border/60 p-3">
          <Checkbox
            id="verify-destination"
            checked={requireVerify}
            onCheckedChange={(checked) => onRequireVerifyChange(checked === true)}
          />
          <div>
            <label
              htmlFor="verify-destination"
              className="cursor-pointer text-sm font-medium"
            >
              Prove this address first
            </label>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Sends {formatSol(TEST_TRANSFER_LAMPORTS)} of SOL as a test, and locks
              the address once you have confirmed it arrived. The batch will not be
              built — let alone signed — against any other address.
            </p>
          </div>
        </div>
        {requireVerify ? (
          <div className="space-y-2.5 rounded-xl border border-border/60 p-3">
            {verification.verification === null ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!check.ok || verification.isSending}
                onClick={() => {
                  if (check.address) void verification.sendTest(check.address);
                }}
              >
                <Send className="mr-1.5 size-3.5" aria-hidden />
                {verification.isSending
                  ? "Sending the test…"
                  : "Send the test transfer"}
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted">
                  Test sent to{" "}
                  <span className="font-mono">
                    {verification.verification.address}
                  </span>
                </p>

                {verification.verification.signature ? (
                  <a
                    href={solscanTxUrl(verification.verification.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-violet-glow hover:underline"
                  >
                    View the test transaction
                  </a>
                ) : null}

                {verification.verification.arrived ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                    Arrived. This address is locked in.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verification.isChecking}
                      onClick={() => void verification.checkArrival()}
                    >
                      {verification.isChecking ? "Checking…" : "Check it arrived"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={verification.confirmManually}
                    >
                      <Check className="mr-1.5 size-3.5" aria-hidden />
                      I checked the receiving wallet myself
                    </Button>
                  </div>
                )}
              </>
            )}

            {verification.error ? (
              <p className="flex items-start gap-1.5 text-xs text-danger">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                {verification.error}
              </p>
            ) : null}

            <p className="flex items-start gap-1.5 border-t border-border/60 pt-2.5 text-[11px] leading-relaxed text-subtle">
              <ShieldCheck
                className="mt-px size-3.5 shrink-0 text-success"
                aria-hidden
              />
              <span>
                This proves the address can receive. It cannot prove who owns it —
                a wrong address that happens to be a real wallet receives the test
                too. Compare the address above against your own copy, whichever
                wallet it belongs to.
              </span>
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
