import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { StarfieldBackground } from "@/components/layout/starfield-background";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import {
  DAPP_ICON_180_PATH,
  DAPP_ICON_192_PATH,
  DAPP_ICON_PATH,
  DAPP_FAVICON_32_PATH,
  getAppName,
  getSiteUrl,
} from "@/lib/config/site";
import { getTwitterHandle } from "@/lib/config/social";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationSchema, websiteSchema } from "@/lib/seo/structured-data";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Display face for page titles only.
 *
 * Geist stays the UI and body face; this is the one type choice that gives the
 * large headings a shape of their own without turning every card title into a
 * brand statement. Bricolage is a grotesque with slightly irregular curves, so
 * it reads as drawn rather than generated next to Geist.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

const APP_NAME = getAppName();
const SITE_URL = getSiteUrl();
// The rent-reclaim rates are three separate constants so any of them can be
// repriced alone. This summary states one number because today they are equal —
// if that ever stops being true, this line has to say so rather than pick one.
const APP_DESCRIPTION = `Six non-custodial Solana wallet tools: batch-swap dust, send or burn what has no market, reclaim rent, revoke approvals, scan any wallet read-only.`;

const APP_TITLE = `${APP_NAME} — batch tools for a Solana wallet`;

export const metadata: Metadata = {
  // Absolute URLs for the OG card and any canonical link. Without this, Next
  // warns at build time and a relative `og:image` never resolves in a crawler —
  // so the generated card in `app/opengraph-image.tsx` would exist and never be
  // seen.
  metadataBase: new URL(SITE_URL),
  title: {
    default: APP_TITLE,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // Absolute, not root-relative. A dApp browser can read these from outside the
  // document, where `/dapp-icon-v3-512.png` would resolve against the wallet's
  // own origin and render a blank tile. The same reason drives the manifest icons.
  manifest: `${SITE_URL}/manifest.webmanifest`,
  keywords: [
    "Solana",
    "dust sweeper",
    "SOL",
    "USDC",
    "JUP",
    "Jupiter",
    "token cleanup",
    "non-custodial",
    "crypto wallet cleanup",
  ],
  authors: [{ name: APP_NAME }],
  icons: {
    // PNG first. Several in-wallet browsers render `<link rel="icon">` with an
    // image loader that cannot display SVG, and `/favicon.ico` alone leaves them
    // with a 16px bitmap. Every size below is the flat-black tile, matching
    // `/favicon.ico` and `/favicon-32.png`: a document's icons are drawn on a
    // light tab strip, a white directory page or a home screen, where the navy
    // tile that suits a wallet sheet turns into a smudge. See
    // `lib/config/site.ts`, and note that the wallet handshake still uses v6.
    icon: [
      {
        url: `${SITE_URL}${DAPP_FAVICON_32_PATH}`,
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: `${SITE_URL}${DAPP_ICON_192_PATH}`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: `${SITE_URL}${DAPP_ICON_PATH}`,
        sizes: "512x512",
        type: "image/png",
      },
      {
        url: `${SITE_URL}/favicon.ico`,
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
    ],
    apple: [
      {
        url: `${SITE_URL}${DAPP_ICON_180_PATH}`,
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: `${SITE_URL}/favicon.ico`,
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    /**
     * No `title` or `description` here, deliberately.
     *
     * A layout's Open Graph values are inherited by every page, so setting them
     * meant `/void` and the rest shipped the landing page's headline on their
     * cards — each tool's own picture under words describing a different page.
     * Next fills a missing `openGraph.title` from the page's resolved title, so
     * leaving these out is what lets each page describe itself.
     *
     * The front door opts back in with `CARD_TITLE`, which is written for a feed
     * rather than a search result. See `lib/seo/card-copy.ts`.
     */
    siteName: APP_NAME,
  },
  twitter: {
    card: "summary_large_image",
    // Same reasoning as `openGraph` above: inherited values, so omitted here.
    // Attribution, so a card posted anywhere carries the account rather than
    // looking like it came from no one. Read from the same config as the footer
    // link and the security page's anti-phishing line, so all three name the same
    // account. Coalesced to `undefined` rather than passed as `null`: the metadata
    // type accepts `string | undefined` here, and `undefined` is what makes Next
    // omit the tag instead of emitting an empty one.
    site: getTwitterHandle() ?? undefined,
    creator: getTwitterHandle() ?? undefined,
  },
  robots: {
    // Indexable, deliberately — and this comment used to say the opposite. It
    // read "keep it out of broad indexing until the operator has reviewed it"
    // while the values beside it said `index: true`, which is a contradiction
    // that survives every build. A public tool that cannot be found is not much
    // of a public tool, so the values are the intent and the comment now says so.
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#04050c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Not user-scalable=no: that breaks zoom for low-vision users, which is an
  // accessibility failure. Users are free to pinch-zoom.
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /**
   * Reading the request headers is what opts every page into dynamic rendering —
   * and that is required, not incidental.
   *
   * A nonce is new for every response. A page prerendered at build time ships the
   * scripts Next rendered *then*, with no nonce on them, so a strict `script-src`
   * would block the whole framework bootstrap and the page would arrive looking
   * complete and never hydrate: no wallet, no buttons. Per-request rendering is
   * the documented price of a nonce-based policy, and the only correct one.
   *
   * The nonce itself is read where it is needed (`app/page.tsx`, for the JSON-LD
   * block, which is a `<script>` like any other). Next applies it to its own
   * scripts on its own, from the policy header the middleware sets.
   */
  await headers();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans antialiased">
        {/* Organisation and site, once for the whole origin. Pages add their own
            blocks on top; these are the two every page can be read against. */}
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        <Providers>
          {/* Decorative only: aria-hidden, and never intercepts pointer events. */}
          <StarfieldBackground />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-violet-core focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
          >
            Skip to main content
          </a>
          <Navbar />
          {/* Bottom padding clears the storage notice on a phone: at `bottom-3`
              it sat over this area, and "Done" on a finished swap was underneath
              it and unclickable. */}
          <main
            id="main"
            className="relative z-10 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-8"
          >
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}