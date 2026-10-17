import {
  LOGO_EXACT_HOSTS,
  LOGO_HOST_SUFFIXES,
} from "@/lib/utils/logo-hosts";

/**
 * The Content-Security-Policy, built from what this app actually loads.
 *
 * WHY A WALLET APP NEEDS ONE: the page origin is where the wallet connection
 * lives, so injected script does not need a private key — it only needs to render
 * a convincing "Confirm" and let the user sign. A policy is the one browser
 * control that stops a script from running at all, and it also closes the
 * exfiltration half (a beacon carrying the connected address or balances).
 *
 * The allow-list is unusually small because the browser never talks to a provider
 * directly: RPC goes through `/api/rpc` and Jupiter through `/api/*`, so
 * `connect-src` is `'self'` plus WalletConnect's relay. Token logos are the wide
 * part, and their hosts already have a single source of truth — the same list the
 * image optimizer's allow-list is built from, so the two cannot drift.
 */

/**
 * Hosts the installed Reown/AppKit stack reaches for.
 *
 * Derived from the packages, not from memory: grep the build for
 * `https://…walletconnect…` and `https://…web3modal…` and this is the set. The
 * relay is a socket (signing requests travel over it); the rest serve the wallet
 * list, its icons, the domain-verification iframe and the secure-wallet frames.
 */
const WALLET_ORIGINS = [
  "https://rpc.walletconnect.org",
  "https://api.web3modal.org",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://echo.walletconnect.com",
  "https://pulse.walletconnect.org",
  "https://secure.walletconnect.org",
  "https://secure-mobile.walletconnect.org",
] as const;

const WALLET_SOCKETS = ["wss://relay.walletconnect.org"] as const;

/** Origins AppKit embeds: the domain-verification notice and secure wallets. */
const WALLET_FRAMES = [
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://secure.walletconnect.org",
  "https://secure-mobile.walletconnect.org",
] as const;

/**
 * Token-logo hosts, expressed the way CSP wants them.
 *
 * `https://*.suffix` matches any subdomain but not the bare domain, which is why
 * the exact hosts are listed separately — exactly how `LOGO_REMOTE_PATTERNS`
 * spells it for the optimizer.
 */
export function logoOrigins(): string[] {
  return [
    ...LOGO_EXACT_HOSTS.map((host) => `https://${host}`),
    ...LOGO_HOST_SUFFIXES.map((host) => `https://*.${host}`),
  ];
}

/**
 * Report-only unless enforcement is explicitly switched on.
 *
 * A wrong policy does not present as a policy problem: the wallet modal opens and
 * signing fails, or logos vanish, and nothing in the UI says "blocked by CSP". It
 * is the same shape as the `camera=()` bug in `next.config.ts`. So the default is a
 * policy that enforces nothing and reports what *would* have been blocked; set
 * `CSP_ENFORCE=1` once a report-only pass is quiet.
 */
export function cspHeaderName(): string {
  const flag = process.env.CSP_ENFORCE?.trim().toLowerCase();
  return flag === "1" || flag === "true"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

/**
 * The policy for one request.
 *
 * `strict-dynamic` is what makes a nonce workable with a bundler: the nonced
 * bootstrap Next renders may load the chunks it needs, without naming every build
 * asset. `'self'` stays in front of it for browsers that do not understand
 * `strict-dynamic` — those fall back to the origin allow-list instead of running
 * nothing.
 *
 * `style-src` keeps `'unsafe-inline'`: React and framer-motion style elements
 * directly, and the App Router server-renders `style` attributes. Style injection
 * is a nuisance; script injection is the threat this policy exists for, and
 * `script-src-attr 'none'` closes the inline-handler route on its own.
 */
export function buildCsp(nonce: string): string {
  // Development only: Next's dev bundle and HMR need eval and a same-origin
  // socket. Production gets neither, and the tests pin that.
  const development = process.env.NODE_ENV === "development";

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        ...(development ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["script-src-attr", ["'none'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    [
      "img-src",
      ["'self'", "data:", "blob:", ...logoOrigins(), ...WALLET_ORIGINS],
    ],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      [
        "'self'",
        ...(development ? ["ws:"] : []),
        ...WALLET_ORIGINS,
        ...WALLET_SOCKETS,
      ],
    ],
    ["frame-src", ["'self'", ...WALLET_FRAMES]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}
