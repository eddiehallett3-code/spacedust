import { cn } from "@/lib/utils/cn";

/** Shared typography for long-form content pages. */
export function Prose({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-none space-y-4 text-sm leading-relaxed text-muted",
        "[&_a]:text-violet-glow [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-violet-core",
        "[&_code]:rounded-md [&_code]:border [&_code]:border-border [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8em] [&_code]:text-cyan-glow",
        "[&_em]:text-foreground [&_em]:not-italic",
        "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground",
        "[&_h2:first-child]:mt-0",
        // One step down: the numbered steps of a per-tool deep dive, which sit
        // under the tool's own heading.
        "[&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-foreground",
        "[&_h3:first-child]:mt-0",
        "[&_li]:pl-1 [&_li]:before:mr-2 [&_li]:before:text-violet-glow [&_li]:before:content-['—']",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_ul]:space-y-2 [&_ul]:pl-1",
        className,
      )}
    >
      {children}
    </div>
  );
}