import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest, for the rules nothing else checks.
 *
 * `tsc` verifies types and `next build` verifies it compiles. Neither can tell
 * you that The Void's fee is 1.5% of real rent, or that an NFT is not dust —
 * and every bug that reached production in this app was of that kind: a green
 * build and a wrong number.
 *
 * So these tests target *invariants*, not coverage. Each file locks a rule that
 * has already been violated once.
 */
export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` alias, so tests import exactly what the app
    // imports and there is no second module graph to drift out of sync.
    //
    // Note this cannot capture `@solana/web3.js`: an alias only matches on an
    // exact hit or a `<alias>/` prefix, and that specifier has no slash after
    // the `@`.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` exists to make importing a server module from a Client
      // Component a *build* error. Under plain Node it resolves to the entry that
      // throws on import, which made every server route untestable — so this
      // points at the empty module the `react-server` condition resolves to,
      // which is exactly what Next itself uses when it compiles a route.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
