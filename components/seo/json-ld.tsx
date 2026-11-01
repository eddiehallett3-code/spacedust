import { headers } from "next/headers";

/**
 * A JSON-LD block, nonced like every other `<script>` on the page.
 *
 * The CSP in `middleware.ts` is nonce-based and strict, so an unnonced inline
 * script is dropped by the browser without an error — the page renders, the
 * markup is simply not there, and nothing in the console says why. Reading the
 * nonce here means a page cannot forget it.
 *
 * `<` is escaped because JSON-LD is injected as raw HTML: a `</script>` sequence
 * inside any string would close the tag early. Nothing built by
 * `lib/seo/structured-data.ts` contains user input today, but the escape is what
 * keeps that a property of the data rather than a requirement on future callers.
 */
export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
