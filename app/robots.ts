import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/config/site";

/**
 * robots.txt.
 *
 * Missing in both forms until launch: `/sitemap.xml` was being served and the
 * layout was deliberately set to `index: true`, but `/robots.txt` answered 404,
 * so nothing declared the sitemap in the place crawlers look for it. A 404 there
 * is survivable — search engines still discover the sitemap on their own — but
 * this is one line, it is the conventional declaration, and its absence reads as
 * an unfinished site to anyone who checks.
 *
 * `/api/` is disallowed because those routes answer JSON rather than pages. The
 * health endpoint in particular responds to a plain GET, so without this its
 * output is a crawlable document.
 *
 * The origin comes from `getSiteUrl()`, the same source as `metadataBase` and the
 * sitemap itself, so a deployment cannot point crawlers at one host while the
 * sitemap it names lives on another.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
