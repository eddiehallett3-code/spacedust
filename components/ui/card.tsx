import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Frosted card. The default surface for every panel in the app. */
export function Card({
  className,
  sheen = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sheen?: boolean }) {
  return (
    <div
      className={cn("glass rounded-2xl", sheen && "glass-sheen", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 p-5 pb-0 sm:p-6 sm:pb-0", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-4 sm:p-6 sm:pt-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-border p-5 sm:p-6", className)}
      {...props}
    />
  );
}

/** Section heading used outside cards. */
export function SectionTitle({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-core/12 text-violet-glow ring-1 ring-inset ring-violet-core/20">
            {icon}
          </span>
        ) : null}
        <div>
          <h2 className="text-[0.95rem] font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}