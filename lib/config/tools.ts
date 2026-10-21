import type { ToolKey } from "@/components/layout/tool-emblem";
import {
  DEFAULT_SLIPPAGE_BPS,
  PAYLOAD_FEE_BPS,
  RECLAIM_FEE_BPS,
  VOID_FEE_BPS,
} from "@/lib/utils/constants";

/**
 * The six tools, in the order they appear in the nav.
 *
 * One list rather than three, because three places need the same facts: the
 * landing page shows each as a box, the how-it-works page uses them as an index
 * into its deep dives, and the nav links to them. The routes live here too, so a
 * tool that moves is a one-line change instead of a search across the app —
 * which is exactly what happened when Slingshot moved off the root.
 *
 * The rates are derived from the constants the flows themselves charge from, so
 * a percentage quoted in prose cannot drift away from the percentage taken.
 */

/** The Void's fee on reclaimed rent, as prose. */
export const VOID_RATE = `${(VOID_FEE_BPS / 100).toFixed(1)}%`;
/** Payload's fee on reclaimed rent, as prose. */
export const PAYLOAD_RATE = `${(PAYLOAD_FEE_BPS / 100).toFixed(1)}%`;
/** The fee on rent freed by closing empty accounts, as prose. */
export const RECLAIM_RATE = `${(RECLAIM_FEE_BPS / 100).toFixed(1)}%`;
/**
 * The default slippage, as prose.
 *
 * Here rather than typed into the sentence that quotes it, for the same reason as
 * the rates above: the tools page tells the reader what a swap will tolerate, and
 * a number in prose that no longer matches the number in the code is a promise
 * the app does not keep.
 */
export const SLIPPAGE_RATE = `${(DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)}%`;

export interface Tool {
  key: ToolKey;
  name: string;
  href: string;
  /** One line. All a landing page box has room for, and all it needs. */
  tagline: string;
  /** The call to action at the foot of the tool's box. */
  cta: string;
}

/**
 * The one line each tool gets on the landing page.
 *
 * Short, plain, and about what the tool *does*. No batching mechanics, no "one
 * signature", no fee rates: a first-time visitor is deciding whether to click,
 * and each tool has a whole page of its own for the detail. A line that has to be
 * read twice has already failed — the batching is still the point, it just is not
 * the sentence.
 *
 * Every tool names the *things* it acts on. The Void used to say "everything with
 * no market at all", which describes its tokens tab and nothing else — a visitor
 * holding an unwanted NFT would not have learned from the landing page that this
 * is where it goes.
 *
 * No fee rate appears on any of these: a rate in a box this size has no room to
 * say what it is charged on, and a number without its base reads as a charge on
 * the dust being recovered. Each flow states its fee against the real number it
 * is taken from, which is also the only place a reader can judge it.
 */
export const TOOLS: Tool[] = [
  {
    key: "slingshot",
    name: "Slingshot",
    href: "/slingshot",
    tagline:
      "Swap your leftover tokens into SOL, USDC or JUP, packed into as few transactions as possible.",
    cta: "Open Slingshot",
  },
  {
    key: "void",
    name: "The Void",
    href: "/void",
    tagline:
      "Send the tokens, NFTs and cNFTs you don't want into The Void, and get the rent back.",
    cta: "Enter The Void",
  },
  {
    key: "payload",
    name: "Payload",
    href: "/payload",
    tagline:
      "Send SOL, tokens, NFTs and cNFTs to one address, with the destination checked first.",
    cta: "Open Payload",
  },
  {
    key: "salvage",
    name: "Salvage",
    href: "/salvage",
    tagline:
      "Reclaim rent from empty token accounts. Pro adds wSOL unwrapping and .sns name deletion.",
    cta: "Open Salvage",
  },
  {
    key: "approvals",
    name: "Approvals",
    href: "/approvals",
    tagline: "See who else can move your tokens, and revoke them.",
    cta: "Check approvals",
  },
  {
    key: "scan",
    name: "Wallet Scan",
    href: "/scan",
    tagline:
      "Look up any wallet without connecting — see what a sweep would recover.",
    cta: "Look up a wallet",
  },
];

/**
 * One tool by key.
 *
 * For the places that need a single tool rather than the list — the per-route
 * preview cards, and anything that labels one route by name. Throwing on an
 * unknown key is deliberate: the alternative is a heading or a card that silently
 * renders "undefined", and a typo is exactly the kind of mistake a build should
 * refuse rather than ship.
 */
export function getTool(key: ToolKey): Tool {
  const found = TOOLS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Unknown tool: ${key}`);
  return found;
}
