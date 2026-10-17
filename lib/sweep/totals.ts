/**
 * Totalling per-account lamports.
 *
 * The flows that close accounts read each account's **own** deposit, because
 * deposits differ: an account funded before the network's rent change holds more
 * than a fresh one, and a Token-2022 account with extensions is larger than a
 * 165-byte legacy account. Every total built from those reads is a sum.
 *
 * This exists as one function because the alternative — one per-account figure
 * multiplied by a count — is what made the panel and the success screen disagree
 * with the chain. It looked identical while every deposit happened to be equal,
 * which is exactly the kind of assumption that rots quietly.
 */
export function sumForMints(
  byMint: ReadonlyMap<string, number>,
  mints: ReadonlySet<string>,
): number {
  let total = 0;
  for (const mint of mints) total += byMint.get(mint) ?? 0;
  return total;
}
