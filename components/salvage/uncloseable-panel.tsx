"use client";

import { LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, SectionTitle } from "@/components/ui/card";
import {
  EMPTY_ACCOUNT_SKIP_TEXT,
  planEmptyAccountCloses,
} from "@/lib/sweep/empty-accounts";
import { formatSol, truncateAddress } from "@/lib/utils/format";
import type { EmptyTokenAccount } from "@/types/token";

/**
 * Empty accounts the wallet cannot close, and the reason for each.
 *
 * These used to exist only as warnings after a preview, which meant the one
 * group of accounts a user could see in a scan but never act on was also the
 * group with no explanation until they tried. The two reasons are structural,
 * not transient: a foreign close authority means only that key can close the
 * account, and withheld Token-2022 fees need the mint's authority to harvest.
 * Neither is something this app can sign around, so this panel diagnoses rather
 * than offers a button.
 */
export function UncloseableAccountsPanel({
  accounts,
  owner,
  scanError,
}: {
  accounts: EmptyTokenAccount[];
  owner: string;
  scanError: string | null;
}) {
  const plan = planEmptyAccountCloses(accounts, owner);

  if (scanError || plan.skipped.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <SectionTitle
          icon={<LockKeyhole className="size-4" aria-hidden />}
          title="Accounts we cannot close"
          description="Still visible in the scan, but the token program will not let this wallet close them."
          action={
            <Badge variant="warning" size="sm">
              {plan.skipped.length}
            </Badge>
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[20rem] space-y-1 overflow-y-auto pr-1">
          {plan.skipped.map(({ account, reason }) => (
            <div
              key={account.address}
              className="flex items-start gap-3 rounded-xl px-2 py-2 opacity-80"
            >
              <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[6px] border border-border-strong">
                <LockKeyhole className="size-2.5 text-warning" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">
                    {truncateAddress(account.address, 4, 4)}
                  </span>
                  <Badge variant="muted" size="sm">
                    {formatSol(account.lamports)}
                  </Badge>
                  {account.program === "token2022" ? (
                    <Badge variant="token2022" size="sm">
                      Token-2022
                    </Badge>
                  ) : null}
                </span>
                <span className="block text-xs leading-relaxed text-warning">
                  {EMPTY_ACCOUNT_SKIP_TEXT[reason]}.
                </span>
                {reason === "foreign-close-authority" && account.closeAuthority ? (
                  <span className="mt-0.5 block font-mono text-[10px] text-subtle">
                    close authority {truncateAddress(account.closeAuthority, 6, 6)}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-subtle">
          A close authority can only be changed by that authority, and withheld
          transfer fees can only be harvested by the mint. Spacedust does not
          attempt either: no instruction this app can sign would succeed.
        </p>
      </CardContent>
    </Card>
  );
}
