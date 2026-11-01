import { DAPP_ICON_PATH, getAppName, getSiteUrl } from "@/lib/config/site";
import { getTwitterProfileUrl } from "@/lib/config/social";
import type { Tool } from "@/lib/config/tools";

/**
 * Structured data, built from the same constants the pages render from.
 *
 * The rule followed throughout: mark up only what the page already says, and
 * derive every value so a renamed tool or a repriced flow cannot leave the markup
 * claiming something the app no longer does. That is also why there is no
 * `FAQPage` anywhere on this site — no page contains a question-and-answer
 * section, and marking up headings as Q&A to win a rich result is how a site
 * earns a manual action.
 *
 * `@id` values are absolute and stable. They let the blocks reference each other
 * (a tool declares `publisher` as the Organization) instead of repeating it, and
 * they survive being read by a crawler that collects the graph across pages.
 */

const CONTEXT = "https://schema.org";

/** `${base}/#organization` — referenced by the other blocks rather than repeated. */
const ORGANIZATION_ID = () => `${getSiteUrl()}/#organization`;

export function organizationSchema() {
  const base = getSiteUrl();
  const profile = getTwitterProfileUrl();

  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": ORGANIZATION_ID(),
    name: getAppName(),
    url: base,
    logo: {
      "@type": "ImageObject",
      // The same 512px opaque tile the dApp icon and the Open Graph card use, so
      // a search result cannot show a different mark from a wallet sheet.
      url: `${base}${DAPP_ICON_PATH}`,
      width: 512,
      height: 512,
    },
    // Omitted rather than faked when no account is configured: a `sameAs` to a
    // profile that is not ours is a claim about ownership, not a broken link.
    ...(profile ? { sameAs: [profile] } : {}),
  };
}

export function websiteSchema() {
  const base = getSiteUrl();

  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    "@id": `${base}/#website`,
    url: base,
    name: getAppName(),
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID() },
  };
}

/**
 * One tool, as an application.
 *
 * No `offers` block: the app costs nothing to install and takes a share of the
 * rent it recovers, which is a sentence rather than a price — a `price: "0"`
 * offer would read as "free of charge" to anything parsing it, and that is the
 * overstatement this site exists to avoid. The rate goes in the description.
 */
export function softwareApplicationSchema(tool?: Tool) {
  const base = getSiteUrl();

  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: tool ? getAppName() + " " + tool.name : getAppName(),
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: tool ? `${base}${tool.href}` : base,
    ...(tool ? { description: `${tool.tagline} Non-custodial; you sign every transaction.` } : {}),
    publisher: { "@id": ORGANIZATION_ID() },
  };
}

/**
 * A breadcrumb trail, root first.
 *
 * `path` is a route rather than a URL so no caller can build one on the wrong
 * host — the same single-origin rule the sitemap and canonicals follow.
 */
export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  const base = getSiteUrl();

  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${base}${crumb.path === "/" ? "/" : crumb.path}`,
    })),
  };
}
