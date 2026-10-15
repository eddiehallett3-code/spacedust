import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { getSiteUrl } from "@/lib/config/site";

/**
 * The file that tells crawlers where the sitemap is.
 *
 * Tested because nothing else reads it. `next build` will happily ship a
 * `robots.ts` whose `sitemap` points at another host or at a path that does not
 * exist, and the failure is invisible until someone reads a search console weeks
 * later — the same class of silent config bug as the `Permissions-Policy` header
 * in `next.config.test.ts`, which shipped a value that disabled a feature while
 * every build stayed green.
 */

describe("robots.txt", () => {
  it("declares the sitemap on the same origin the sitemap itself uses", () => {
    // Both read `getSiteUrl()`, and this is the assertion that keeps it that
    // way: robots.txt naming one host while the sitemap lives on another is a
    // declaration no crawler can follow.
    const { sitemap } = robots();
    const url = Array.isArray(sitemap) ? sitemap[0] : sitemap;

    expect(url).toBe(`${getSiteUrl()}/sitemap.xml`);
  });

  it("allows the pages and disallows only the JSON routes", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;

    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toBe("/api/");
  });
});
