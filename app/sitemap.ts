import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/config/tools";
import { getSiteUrl } from "@/lib/config/site";

/**
 * Every page, so a search engine indexes six tools rather than one front door.
 *
 * Built from the shared tool list, so a tool that changes its route cannot leave
 * a stale URL here — the same reason the nav and the landing page read from that
 * list.
 *
 * No `lastModified`: the honest value per route is its real publication date,
 * which nothing here tracks, and stamping every entry with "now" on every
 * request claims every page changed just now. A missing field is a smaller lie
 * than a fabricated one, and crawlers handle it fine.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();

  return [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/how-it-works`, priority: 0.7 },
    { url: `${base}/compare`, priority: 0.7 },
    { url: `${base}/security`, priority: 0.6 },
    { url: `${base}/privacy`, priority: 0.3 },
    { url: `${base}/terms`, priority: 0.3 },
    ...TOOLS.map((tool) => ({
      url: `${base}${tool.href}`,
      priority: 0.8,
    })),
  ];
}
