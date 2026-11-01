# The holder fee waiver

Hold ten Turtles and the rent-recovery fee is 0% on every tool, while you hold
them. This file records what that is, why it is holding rather than burning, and
the one place the decision lives.

## The collection

| | |
|---|---|
| Collection | `EG1XZWddWV5H1HADtXiWNqNwuHBoBSeH4f21AnfdZx3x` ("Turtles") |
| Requirement | 10 |
| Interface | `ProgrammableNFT` — every item in the collection |
| `collection.verified` | **true**, read from the metadata account, not from the index |

The individual NFTs each have their own mint (`7md6rW8…` is #6241). The address
above is the *collection* mint, which is the one every item points at.

`verified: true` is what makes this safe to price a fee against. It is a flag the
collection authority signs, and an impostor collection can copy the key without
being able to copy the flag. Helius's `getAssetsByGroup` does not filter on it, so
the check uses `searchAssets` with `showUnverifiedCollections: false` — counted
before the assets are returned, rather than trusted after.

## Holding, not burning

The original idea was "send ten to The Void and get free fees forever". It is
buildable — `lib/solana/pnft-burn.ts` burns pNFTs through Token Metadata's
`burnV1`, and this collection is entirely pNFTs — but a burn leaves nothing
on-chain to read afterwards. Proving it later needs either a receipt minted at
burn time or an index of every burn:

- **Receipt (cNFT/Core pass):** works, costs ~0.0013 SOL per pass as a Core asset
  or ~0.000005 SOL as a cNFT leaf plus a ~0.12–0.16 SOL tree deposit (refundable).
  Needs a funded minting key and a claim/retry path, because a mint that fails
  after an irreversible burn cannot be undone.
- **Burn index:** backfill every burn of the collection, keep a set of wallets
  with ≥10. Needs a durable store and a job that must not miss a batch.

Holding needs neither. The trade, stated plainly because it is the model and not a
gap: **the perk stops when the tokens leave the wallet.** It is a membership, not
a purchase — and it cannot be sold, because it was never an asset.

## Where it is decided and applied

| Step | File |
|---|---|
| Rule: collection, count, status | `lib/fees/holder-membership.ts` (pure, tested) |
| Index read + 5-minute cache | `lib/fees/holder-membership.server.ts` |
| Route | `GET /api/membership?owner=` → `{ entitled, held, required, collection }` |
| Session flag | `lib/fees/holder-waiver.ts` |
| Applied | `feeFromRentLamports` in `lib/solana/rent.ts` — every rent fee passes through it |
| Client | `hooks/use-holder-waiver.tsx`, mounted once in `app/providers.tsx` |
| Shown | `components/fees/holder-waiver-note.tsx` |

The waiver is applied at **one** function because the fee is priced in thirteen
places — nine display, four transaction builders. A preview that says 1.5% next to
a transaction that charges 0 is worse than either number alone, and a boolean
threaded through thirteen call sites is a diff where one forgotten site shows up
as a fee charged to a holder in exactly one flow.

## What this is not

Enforcement. The fee is added by client-side builders; the server returns Jupiter
instructions and the user composes and signs. Anyone technical can strip the
transfer, exactly as they could before this existed. The waiver is an honest
mechanism and a soft one, which is why the cheap version was the right version.

## Failure behaviour

A wallet that cannot be checked — no index key, a 502, offline, aborted — is
`entitled: false` and is charged the normal fee. The failure mode is one the
product already has for everyone who is not a holder, rather than a fee silently
going missing.
