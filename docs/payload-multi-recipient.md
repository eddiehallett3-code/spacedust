# Payload multi-recipient — design notes

**Status:** not implemented. Saved 2026-10-18 for a later session. No code was
changed for this note.

## Goal

Let Payload send to **multiple recipient addresses** in one flow:

- paste a list of addresses, or upload a text/CSV file;
- optionally label each recipient;
- choose how much of each selected token goes to each address;
- keep the existing safety gates: preview, simulation, instruction audit,
  content-hash/re-check before signing, and per-item outcomes.

## Current code constraints

- `hooks/use-payload.ts` has one `recipient` in `PayloadRequest`.
- `lib/payload/plan-send.ts` derives **one destination ATA per mint** from that
  recipient, builds `create → transfer → close`, and audits one destination.
- `PackedTransaction.mints`, `SendOutcome.mint` and `PayloadOutcome.mint` are the
  primary keys. A mint can only appear once, so “10 USDC to A and 20 to B”
  collides today.
- One source close per mint is valid only when that mint’s **total** sent across
  all recipients equals the source balance.
- `lib/security/instruction-audit.ts` expects a single destination, a single ATA
  owner, and a single compressed-NFT destination.
- `useDestinationVerification` verifies one address with one 0.001 SOL test.
- Fee is `PAYLOAD_FEE_BPS = 150` (1.5%) of **rent reclaimed when a source account
  is closed**. Partial sends, SOL sends, and cNFTs pay no Payload fee.

## Proposed data model

```ts
interface Recipient {
  id: string;          // stable client id
  address: string;
  label?: string;      // display only
}

interface Allocation {
  id: string;          // stable line id
  recipientId: string;
  kind: "token" | "sol" | "nft" | "cnft";
  mint: string;        // "SOL" for native
  assetId?: string;    // NFTs/cNFTs
  amountRaw: string;   // base units; "1" for NFTs
}
```

`PayloadRequest` becomes recipients + allocations. The existing single-recipient
flow can be represented as one recipient plus allocations, so it should not need
a permanent second planner.

## Recipient paste/upload

New pure module (`lib/payload/recipients.ts`):

- Parse client-side only; never upload the file.
- v1 format: one address per line, optional `address,label`; ignore blank lines
  and `#` comments; support CRLF/tabs.
- Validate base58/32 bytes; reject the owner/self-send, duplicates and malformed
  lines with line numbers.
- File limits: ~100–256 KB, ~1,000 lines, then a hard recipient cap.
- Show valid/invalid/duplicate counts and full addresses before accepting.
- Put amounts in the UI for v1. A file containing amounts needs a stricter schema
  and symbol→mint resolution; defer it.

Suggested cap for v1: **20–50 recipients / 50–100 allocation lines**. Each
recipient × mint adds an ATA read, potentially an ATA create, transaction bytes
and rent.

## Allocation UI

Recommended v1:

- Recipient list at the top; selected fungible tokens + SOL below.
- Per token: a recipient-by-recipient amount table with:
  - total allocated and balance remaining;
  - “Split equally”;
  - “Send all to…” a chosen recipient;
  - explicit amounts only in multi-recipient mode (empty must not mean “send
    everything” across 20 addresses).
- NFTs/cNFTs: one recipient selector per asset, no amounts.
- Mobile: per-recipient cards; desktop: matrix.
- Validate in base units (no floating point): amount > 0, sum ≤ balance, exact
  full balance means close/reclaim, partial means no close/rent/fee.
- SOL: total + 0.001 SOL reserve + all recipient ATA rents ≤ balance.
- Reject duplicate recipient/mint lines; merge or reject.
- Show total recipient ATA cost before signing; a split across many new wallets
  can cost more in account rent than the assets are worth.

## Planner and packing

`planSend()` must move from one recipient to many:

- Read the source account **once per mint**.
- Read one destination ATA per **(mint, recipient)**; price each missing account.
- Build `create + transfer` per allocation.
- Build the source close **once per mint**, after all transfers for that mint.
- Attach the Payload fee to the close unit, as today.
- SOL: one System transfer per recipient; no close/rent/fee.
- NFTs/cNFTs: one destination per asset; cNFT proofs stay batched.

**Close ordering:** if transfers for one mint span transactions, the close must
be in the last transaction for that mint. A close before the last transfer fails
(non-empty account); a failed earlier transaction must not leave a close that
runs against a non-empty account. This ordering must be explicit in the plan.

**Outcome identity:** add a stable line id to `PackUnit`, `PackedTransaction`,
`SendOutcome` and `PayloadOutcome`. Keep `mint` for display, but use the line id
as the key. `PackedTransaction.mints` can contain duplicates once a mint goes to
several recipients.

**Failure isolation:** consider packing **per recipient** in v1, not across
recipients. One failed transfer in a packed transaction fails every recipient in
it; per-recipient transactions cost more network fees but are clearer and safer.
Packing across recipients can be a later option.

## Audit

`auditPlanBeforeSigning` needs:

- `expectedTransferDestinations` → a set of every recipient ATA in the packed
  units.
- `allowedAtaOwners` → every recipient, not one.
- `allowedSolDestinations` → every recipient with a SOL allocation.
- `expectedCompressedDestination` (single) → a set of recipients.
- `expectedCloses` → source accounts only, never recipient accounts.
- `expectedFeeLamports` unchanged while the fee stays rent-based.

It must still refuse a transfer to any address not in the imported list. Do not
make the audit so permissive that a crafted plan can add a destination.

## Verification

Current default is one 0.001 SOL test transfer per address. Multi-recipient
options:

1. **Full-list review + content hash (recommended v1).** Show every full address
   and allocation; hash the normalized list; `execute()` refuses if it changed
   after preview; require an explicit “I checked every address”.
2. **Batch test transfers.** One or more transactions of 0.001 SOL to every
   recipient, read back each destination. Costs 0.001 SOL × N (0.05 SOL for 50)
   plus fees; often more than the dust. Optional, capped or limited to new
   addresses.
3. Per-recipient verification one at a time: safest but unusable for large lists.

Recommendation: review + content hash in v1; optional batch verification for
small lists; verified-address book later. Do not silently weaken the existing
“verified address is locked” guarantee — lock the whole reviewed list instead.

## Preview and report

- Per-recipient totals: token amounts, ATA cost, rent, fee, network fee, net.
- Overall totals: recipients, allocations, transactions, ATA rent, net.
- Refused rows keep their reasons, grouped by recipient.
- After execution, group outcomes by recipient and show which transaction carried
  which allocations.
- A failed transaction names every allocation that rode in it.

## Limits

Cap recipients, allocation lines, file size and tokens per batch so a paste
cannot produce hundreds of RPC reads, ATA creates and transactions. Chunk account
reads and respect the 1232-byte transaction limit. Suggested: 20–50 recipients,
50–100 allocations, 10 fungible tokens, 100–256 KB file.

## Tests and a probe

Before UI work, extend `probes/tmp-payload-transfer-probe.mjs` (or add a new
probe) to simulate:

- one mint split across 2–3 recipients, full balance;
- the same split, partial balance (no close);
- a token + SOL + NFT mixed batch;
- close-after-all-transfers ordering;
- ATA create counts and rent;
- bytes/CU per recipient group.

Unit tests:

- recipient file/paste parsing, duplicates, invalid lines, owner self-send;
- allocation sums, decimals, over-balance, exact-full vs partial;
- request-key changes (any address/amount invalidates; reordering does not);
- planner: one source close per mint, per-recipient ATAs, fee only when
  closeable, SOL reserve with all ATA costs;
- audit: every destination is allowed, an injected extra destination is refused;
- outcome attribution when a transaction fails;
- dropped-unit refunds (rent/fee/ATA totals must come back out).

## Fee recommendation

Current Payload fee is **1.5% of rent reclaimed when a source token account is
closed**. Partial sends, SOL sends, and cNFTs pay no Payload fee. The sender
already pays recipient ATA rent (~0.0015–0.002 SOL per new recipient/mint, priced
from the chain) and network fees.

**Recommendation for v1: do not add a new fee. Keep the 1.5% reclaim fee.**

Why:

- It preserves the promise that Spacedust never takes a cut of the assets sent.
- Multi-recipient splitting is exactly where balances are small. A per-recipient
  fee makes a 50-address dust send cost more in fees than the assets.
- The user already pays ATA rent and network fees; a third cost is hard to
  justify for a convenience feature.
- A percentage of transferred value needs token pricing, SOL collection,
  fee-wallet funding and a new audit path — large complexity for questionable
  benefit.

If it must be monetized later, the least harmful model is a **flat SOL fee per
batch**, not per recipient and not a percentage of assets:

| Model | Verdict |
|---|---|
| 1.5% of reclaimed rent only (current) | **Recommended for v1.** Consistent, simple, no fee on partial/SOL sends. |
| Flat fee per batch (e.g. 0.001–0.002 SOL) | Reasonable later, above a free tier (e.g. >10 recipients); show it in preview and audit it. |
| Fee per recipient | **No.** 50 × 0.001 SOL = 0.05 SOL, likely more than the dust. |
| Percentage of assets sent | **No.** Pricing, collection, volatility, contradicts the promise. |
| Cut of recipient ATA rent | **No.** Charges for a cost the user already bears. |

If a flat batch fee is added: one System transfer, transparent in the preview,
waived for tiny batches, included in `allowedSolDestinations` with an exact
amount, and handled when the fee wallet is unfunded (waive, as the current path
does).

## Recommended v1 scope

- Fungible tokens + native SOL.
- Paste or upload a text/CSV list of addresses; labels optional.
- Exact per-recipient amount per token, with “split equally” helpers.
- 20-recipient / 50-allocation cap (adjust after a probe).
- Pack **per recipient** for failure isolation.
- Full-list review + content hash; optional batch verification for small lists.
- No NFTs/cNFTs in v1; add asset-to-recipient assignment later.
- No new fee; keep the 1.5% reclaim fee.

## Open decisions

1. Does “how much of each token” mean a full token × recipient matrix, or one
   amount per recipient / an equal split?
2. Must NFTs/cNFTs be assignable in v1?
3. Verification: list review + hash, optional batch test transfers, or an
   address book?
4. Pack per recipient or across recipients?
5. Recipient/allocation cap.

## Rough effort

For the recommended v1 (fungible + SOL, paste/upload, exact amounts, review +
hash, per-recipient packing):

- parser/validation + recipient UI: 1–2 days
- allocation UI + totals/validation: 2–3 days
- planner/packing/outcome/audit refactor: 4–6 days (highest risk)
- verification/review + preview/report: 1–2 days
- probe + tests + edge cases: 2–3 days

About **2 weeks of focused work**; longer with NFTs/cNFTs and batch verification.
The file upload is easy; the mint→many-recipients close/attribution/audit model is
the hard part.

## Logo follow-up (separate)

The app currently has two logo sources that do not match. No changes made. When
the matching master file is supplied, regenerate all derivatives from it:
`public/logo-512.png`, `public/logo-192.png`, `public/icon.png`,
`public/favicon.ico` (16/32/48), `public/apple-touch-icon.png`, and
`apple-touch-icon-precomposed.png`. Keep one master, not two.


