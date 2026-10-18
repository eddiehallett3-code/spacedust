"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Menu, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils/cn";

/**
 * Order is deliberate: the tools that act on a wallet come first — Slingshot
 * sells what has a market, The Void burns what has none, Payload sends what you
 * are keeping, and Salvage tidies up what is left — followed by the security job
 * and the read-only lookup. The two pages that explain the app come last.
 */
const NAV_LINKS = [
  { href: "/slingshot", label: "Slingshot" },
  { href: "/void", label: "The Void" },
  { href: "/payload", label: "Payload" },
  { href: "/salvage", label: "Salvage" },
  { href: "/approvals", label: "Approvals" },
  { href: "/scan", label: "Wallet Scan" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close on navigation. The links close it themselves, but this also covers
  // the back/forward buttons and any programmatic route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-space-950/70 backdrop-blur-xl">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Brand */}
          <Link
            href="/"
            className="group flex shrink-0 items-center gap-2.5 rounded-lg"
            aria-label="Spacedust home"
          >
            {/* The mark is a transparent-background SVG, so it sits cleanly on
                the dark chrome. The glow ring is our own CSS, not part of the
                artwork, which keeps the logo itself untouched. */}
            <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl ring-1 ring-inset ring-white/10 transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-105">
              <Image
                src="/logo.svg"
                alt=""
                width={36}
                height={36}
                priority
                className="size-9"
                aria-hidden
              />
              <span className="pointer-events-none absolute inset-0 bg-violet-core/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20 animate-pulse-ring" />
            </span>
            <span className="text-[1.05rem] font-semibold tracking-tight">
              Spacedust
            </span>
          </Link>

          {/* Desktop nav. Held back to `lg` rather than `md`: seven items plus the
              brand and the wallet button do not fit at 768px, and squeezing them
              there is what wrapped "The Void" onto two lines. */}
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cn(
                      // `whitespace-nowrap`: a two-word tool name is a label, not
                      // a paragraph, so it must never break mid-name.
                      "relative block rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors duration-200",
                      isActive(link.href)
                        ? "text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    {link.label}
                    {isActive(link.href) ? (
                      <motion.span
                        layoutId="nav-active-pill"
                        className="absolute inset-0 -z-10 rounded-lg bg-white/7 ring-1 ring-inset ring-border"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/security"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground lg:flex"
            >
              <ShieldCheck className="size-3.5 text-success" aria-hidden />
              Non-custodial
            </Link>
            <WalletButton />

            {/* Mobile nav trigger. Before this existed the links simply vanished
                below `md`, leaving the footer as the only way to reach them. */}
            <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              </DialogTrigger>

              <DialogContent
                // A menu, not a popup: silent by design.
                sound={false}
                // No `id` here on purpose: Radix wires the trigger's
                // aria-controls to an id it generates, so overriding it would
                // point that attribute at nothing.
                //
                // `cn` runs through tailwind-merge, so these replace the
                // dialog's default centring: a sheet pinned below the header.
                className="top-20 w-[calc(100vw-1.5rem)] max-w-sm translate-y-0 rounded-2xl p-4"
              >
                <DialogHeader className="mb-2">
                  <DialogTitle className="text-sm font-medium text-muted">
                    Menu
                  </DialogTitle>
                </DialogHeader>

                <nav aria-label="Main">
                  <ul className="flex flex-col">
                    {NAV_LINKS.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          onClick={() => setMenuOpen(false)}
                          aria-current={isActive(link.href) ? "page" : undefined}
                          className={cn(
                            "flex items-center justify-between rounded-xl px-3 py-3 text-sm transition-colors",
                            isActive(link.href)
                              ? "bg-white/7 text-foreground ring-1 ring-inset ring-border"
                              : "text-muted hover:bg-white/5 hover:text-foreground",
                          )}
                        >
                          {link.label}
                          <ArrowRight className="size-4" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>

                <p className="mt-3 flex items-center gap-1.5 border-t border-border/60 px-3 pt-3 text-[11px] text-subtle">
                  <ShieldCheck
                    className="size-3.5 shrink-0 text-success"
                    aria-hidden
                  />
                  Non-custodial. You sign every transaction.
                </p>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Container>
    </header>
  );
}