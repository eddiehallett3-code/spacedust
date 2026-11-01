import { getTool } from "@/lib/config/tools";
import type { ToolKey } from "@/components/layout/tool-emblem";
import { breadcrumbSchema, softwareApplicationSchema } from "@/lib/seo/structured-data";
import { JsonLd } from "./json-ld";

/**
 * A tool page's structured data: what it is, and where it sits.
 *
 * The breadcrumb is two levels because the site has two — every tool hangs off
 * the landing page, and there is no intermediate directory to invent. `Home` is
 * the name the nav uses for `/`.
 */
export function ToolJsonLd({ tool }: { tool: ToolKey }) {
  const { name, href } = getTool(tool);

  return (
    <JsonLd
      data={[
        softwareApplicationSchema(getTool(tool)),
        breadcrumbSchema([
          { name: "Home", path: "/" },
          { name, path: href },
        ]),
      ]}
    />
  );
}
