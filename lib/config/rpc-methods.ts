/**
 * The RPC method allow-list for `app/api/rpc`.
 *
 * It lives here rather than in the route because Next only permits HTTP method
 * handlers and config fields to be exported from a route module — exporting this
 * from `route.ts` fails the build with *"ALLOWED_METHODS is not a valid Route
 * export field"*. It also has to be testable, and this is the single most
 * important constant in the app's browser-side security model: without it,
 * `/api/rpc` is an open relay anyone could point at your Helius account.
 *
 * The rule for adding a method: it must be read-only, or a call the signing flow
 * genuinely cannot work without. Every entry is reachable by anyone who can load
 * the app, so "useful" is not sufficient.
 *
 * An indirection worth naming: web3.js methods are not JSON-RPC methods. A
 * `*Parsed*` call just adds `encoding: "jsonParsed"` to the plain one, and
 * `sendRawTransaction` is `sendTransaction` upstream. So the name the client
 * writes is never necessarily the name that has to be allowed — which is exactly
 * how `getParsedTokenAccountsByOwner` was rejected with "Method not allowed:
 * getTokenAccountsByOwner". `app/api/rpc/route.test.ts` enforces that mapping.
 */
export const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "getBlockHeight",
  "getAccountInfo",
  "getMultipleAccounts",
  // One account's lamport balance. Asked only when a simulation has already
  // failed for fees: it is what turns "insufficient funds for fee" into the
  // exact amount of SOL to send and the address to send it to. Read-only, and
  // for a single public address the caller already knows — the wallet's own.
  "getBalance",
  // Parsed token accounts, so the client can read an account's `state` as the
  // word "frozen" rather than a byte at a hand-counted offset. Read-only.
  "getMultipleParsedAccounts",
  // Every token account one owner holds, parsed. `getParsedTokenAccountsByOwner`
  // is implemented on top of this, which is why it has to be listed even though
  // the caller never names it. This is how the approvals screen finds delegates,
  // and how a wallet with more accounts than one page can hold is read at all —
  // web3.js paginates internally. Read-only, scoped to an owner the caller knows.
  "getTokenAccountsByOwner",
  "getFeeForMessage",
  // Rent-exempt minimums. Read-only and leaks nothing, but it must be listed
  // explicitly: the client prices rent and The Void's fee from it, and a
  // rejected call would silently fall back to a constant that can go stale.
  "getMinimumBalanceForRentExemption",
  "getAddressLookupTable",
  // A recent slot is part of a lookup-table address, and the table's
  // `lastExtendedSlot` is only usable once the chain has moved past it. Read-only.
  "getSlot",
  // One transaction, by signature. Read-only, and the only way Payload can prove
  // a test transfer actually credited its destination: the recipient's balance
  // before and after are in the transaction that moved it, which is evidence a
  // balance lookup cannot produce. The same call is public on any RPC endpoint.
  "getTransaction",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
]);
