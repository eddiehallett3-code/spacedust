import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Consistent header for static content pages.
 *
 * One type treatment for every tool, set here rather than per page. Every tool
 * used to introduce itself differently — The Void at `text-5xl`–`7xl` as a
 * wordmark, the tool pages at `text-3xl`–`4xl` — and the mark above the title
 * existed on none of them. A tool's identity now lives in its emblem, centred
 * above a title that is set the same everywhere and reads as the same product.
 *
 * There is deliberately no eyebrow. A label above a title that already names the
 * page says the same thing twice — Security carried "Security" directly above the
 * word "Security" — and the prop that rendered it was deleted rather than left
 * unused, so the label cannot be reintroduced by a page that thinks it wants one.
 * The emblem is the mark, the title is the name, and nothing precedes either.
 */
export function PageHeader({
  emblem,
  title,
  description,
  className,
  titleClassName,
}: {
  /** The tool's mark, rendered centred above the title. See `ToolEmblem`. */
  emblem?: ReactNode;
  title: ReactNode;
  description?: string;
  className?: string;
  /** Escape hatch, deliberately unused by the tool pages. */
  titleClassName?: string;
}) {
  return (
    <header className={cn("pb-8 pt-12 text-center sm:pt-16", className)}>
      {emblem ? <div className="mt-4 flex justify-center">{emblem}</div> : null}
      <h1
        className={cn(
          "mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl",
          titleClassName,
        )}
      >
        {title}
      </h1>
      {description ? (
        // Capped as well as centred: a full-width paragraph under a centred
        // heading is a wall of text, and the eye has nowhere to start.
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted">
          {description}
        </p>
      ) : null}
    </header>
  );
}