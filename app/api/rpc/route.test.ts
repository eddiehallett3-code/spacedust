import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_METHODS } from "@/lib/config/rpc-methods";

/**
 * "Every RPC call the browser makes has to be on the allow-list."
 *
 * This is the one failure mode where a green build and correct types still ship a
 * broken screen, and it is not hypothetical: `getParsedTokenAccountsByOwner` is
 * *implemented on top of* `getTokenAccountsByOwner`, so the approvals screen asked
 * for one method and the proxy rejected another. Nothing in the source names
 * `getTokenAccountsByOwner` — it exists only inside web3.js — so no type, lint or
 * build could have caught it. The user saw:
 *
 *     Method not allowed: getTokenAccountsByOwner
 *
 * So this test reads the client-side sources, collects every `connection.<method>`
 * call, and maps each one to the JSON-RPC method web3.js actually sends. A method
 * with no entry in the map is a deliberate failure: the fix is to decide which RPC
 * call it becomes and add it to the allow-list, never to guess.
 */

/** Directories that make browser-side RPC calls. `app/api` is the server. */
const CLIENT_DIRS = ["hooks", "components", "lib"];

/** Skip tests and temp probes: they call fake connections. */
function isSourceFile(path: string): boolean {
  return (
    (path.endsWith(".ts") || path.endsWith(".tsx")) &&
    !path.includes(".test.") &&
    !path.includes(".server.")
  );
}

function collectSourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...collectSourceFiles(path));
    } else if (isSourceFile(path)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * web3.js client method → the JSON-RPC method it sends.
 *
 * The indirection is the whole point of this table. Two entries are easy to get
 * wrong in opposite directions: a `*Parsed*` method is not a JSON-RPC method at
 * all (it just sets `encoding: "jsonParsed"` on the plain call), and
 * `sendRawTransaction` is `sendTransaction` upstream.
 */
const RPC_METHOD_FOR: Record<string, string> = {
  getAccountInfo: "getAccountInfo",
  getAddressLookupTable: "getAddressLookupTable",
  // The fee-payer check reads one balance before it can say exactly how much
  // SOL is missing — `getBalance` is both the web3.js name and the RPC method.
  getBalance: "getBalance",
  getBlockHeight: "getBlockHeight",
  getLatestBlockhash: "getLatestBlockhash",
  getMinimumBalanceForRentExemption: "getMinimumBalanceForRentExemption",
  // Needed to derive a lookup-table address from a recent slot, and to wait
  // until a freshly extended table is usable. Read-only.
  getSlot: "getSlot",
  getMultipleAccountsInfo: "getMultipleAccounts",
  getMultipleParsedAccounts: "getMultipleAccounts",
  getParsedTokenAccountsByOwner: "getTokenAccountsByOwner",
  getSignatureStatuses: "getSignatureStatuses",
  // `confirmTransaction` in its blockhash form polls `getSignatureStatuses` and
  // `getBlockHeight`; both are already allowed, so the entry here records the
  // former as its upstream method rather than adding anything.
  confirmTransaction: "getSignatureStatuses",
  // Read directly by Payload to prove a test transfer reached its destination:
  // the recipient's balance before and after, from the transaction that moved it.
  getTransaction: "getTransaction",
  sendRawTransaction: "sendTransaction",
  simulateTransaction: "simulateTransaction",
};

/** Every `connection.<name>(` call in the client-side sources. */
function methodsCalledInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const directory of CLIENT_DIRS) {
    for (const path of collectSourceFiles(join(process.cwd(), directory))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/connection\.([a-zA-Z0-9_]+)\(/g)) {
        const method = match[1]!;
        const where = found.get(method) ?? [];
        where.push(path.replace(`${process.cwd()}/`, ""));
        found.set(method, where);
      }
    }
  }

  return found;
}

describe("the RPC proxy allow-list", () => {
  it("finds the methods the client actually calls", () => {
    // Guards the guard: a broken scan would make every assertion below vacuous.
    const called = methodsCalledInSource();

    expect(called.size).toBeGreaterThan(5);
    expect(called.has("getParsedTokenAccountsByOwner")).toBe(true);
    expect(called.has("sendRawTransaction")).toBe(true);
  });

  it("allows every RPC method the client reaches for", () => {
    const called = methodsCalledInSource();
    const missing: string[] = [];

    for (const [clientMethod, files] of called) {
      const rpcMethod = RPC_METHOD_FOR[clientMethod];
      if (rpcMethod === undefined) {
        // Fail closed: unmapped means we do not know what it becomes, so we
        // cannot know it is allowed.
        missing.push(
          `${clientMethod} (called in ${files[0]}) has no entry in RPC_METHOD_FOR`,
        );
        continue;
      }
      if (!ALLOWED_METHODS.has(rpcMethod)) {
        missing.push(
          `${clientMethod} → ${rpcMethod} is NOT in ALLOWED_METHODS (called in ${files.join(", ")})`,
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it("maps an indirect call onto its real RPC method", () => {
    // The rule behind the bug, stated directly.
    expect(RPC_METHOD_FOR.getParsedTokenAccountsByOwner).toBe(
      "getTokenAccountsByOwner",
    );
    expect(ALLOWED_METHODS.has("getTokenAccountsByOwner")).toBe(true);
    // A parsed call is never a JSON-RPC method of its own, so allowing the name
    // the client writes would protect nothing.
    expect(ALLOWED_METHODS.has("getParsedTokenAccountsByOwner")).toBe(false);
  });

  it("is actually enforced by the proxy route", () => {
    // Guards the guard from the other side. Moving the list into its own module
    // (so it could be tested at all) only helps if the route still consults it —
    // a route that stopped importing it would reintroduce the open relay this
    // list exists to prevent, and every test above would still pass.
    const route = readFileSync(
      join(process.cwd(), "app/api/rpc/route.ts"),
      "utf8",
    );

    expect(route).toContain('from "@/lib/config/rpc-methods"');
    expect(route).toContain("ALLOWED_METHODS.has(method)");
    // And refuses with the JSON-RPC "method not found" code, which is what the
    // user's error message came from.
    expect(route).toContain("-32601");
  });
});
