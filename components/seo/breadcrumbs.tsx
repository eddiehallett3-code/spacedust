import { breadcrumbSchema } from "@/lib/seo/structured-data";
import { JsonLd } from "./json-ld";

/**
 * The breadcrumb trail for a page that sits one level under the landing page.
 *
 * Every page on this site is one level deep — there are no sections to nest — so
 * the shape is always Home plus the page itself, and a component that takes the
 * two things that vary is smaller than the markup it emits.
 *
 * Emitted as JSON-LD only. There is no visible trail, deliberately: a one-step
 * breadcrumb rendered on screen is a line of chrome that says "Home / Security"
 * above a title that already says Security.
 */
export function Breadcrumbs({ name, path }: { name: string; path: string }) {
  return (
    <JsonLd
      data={breadcrumbSchema([
        { name: "Home", path: "/" },
        { name, path },
      ])}
    />
  );
}
