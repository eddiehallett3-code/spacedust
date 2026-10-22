"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, Menu, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BrandLogo } from "@/components/layout/brand-logo";
import { ProModeSwitch } from "@/components/layout/pro-mode-switch";
import { ToolEmblem } from "@/components/layout/tool-emblem";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Container } from "@/components/layout/container";
import { TOOLS } from "@/lib/config/tools";
import { cn } from "@/lib/utils/cn";

/**
 * The two pages that explain the product. The tools themselves live in the
 * dropdown; keeping the top-level nav to one menu plus two links leaves room
 * for the brand and wallet action, and makes the hierarchy obvious.
 */
const LEARN_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/security", label: "Security" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLLIElement>(null);

  // Close on navigation. The links close it themselves, but this also covers
  // the back/forward buttons and any programmatic route change.
  useEffect(() => {
    setMenuOpen(false);
    setToolsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!toolsOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!toolsRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setToolsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolsOpen]);

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const toolsActive = TOOLS.some((tool) => isActive(tool.href));

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-space-950/70 backdrop-blur-xl">
      <Container>
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Brand */}
          <Link
            href="/"
            className="group flex shrink-0 items-center rounded-lg"
            aria-label="Spacedust home"
          >
            <BrandLogo className="origin-left transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.02]" />
          </Link>

          {/* Desktop nav. Tools collapse into one menu; the two explainer pages
              stay visible. That leaves the brand and wallet action room to
              breathe instead of squeezing eight labels into the header. */}
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              <li ref={toolsRef} className="relative">
                <button
                  type="button"
                  aria-expanded={toolsOpen}
                  aria-haspopup="true"
                  aria-controls={toolsOpen ? "tools-menu" : undefined}
                  onClick={() => setToolsOpen((open) => !open)}
                  className={cn(
                    "relative flex items-center gap-1 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors duration-200",
                    toolsActive
                      ? "text-foreground"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  Tools
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform duration-200",
                      toolsOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                  {toolsActive ? (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 -z-10 rounded-lg bg-white/7 ring-1 ring-inset ring-border"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  ) : null}
                </button>

                {toolsOpen ? (
                  <div
                    id="tools-menu"
                    className="glass absolute left-0 top-full z-50 mt-3 w-[34rem] max-w-[calc(100vw-2rem)] rounded-2xl border-border/80 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/10"
                  >
                    <div className="grid grid-cols-2 gap-1">
                      {TOOLS.map((tool) => (
                        <Link
                          key={tool.key}
                          href={tool.href}
                          onClick={() => setToolsOpen(false)}
                          className="group flex gap-2.5 rounded-xl p-2.5 transition-colors hover:bg-white/6"
                        >
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-core/12 ring-1 ring-inset ring-violet-core/20">
                            <ToolEmblem
                              tool={tool.key}
                              className="size-4 text-violet-glow"
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground">
                              {tool.name}
                            </span>
                            <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted">
                              {tool.tagline}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>

                    <div className="mt-1 flex items-center justify-between border-t border-border/60 px-2.5 pt-2">
                      <Link
                        href="/how-it-works"
                        onClick={() => setToolsOpen(false)}
                        className="group inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
                      >
                        How each tool works
                        <ArrowRight
                          className="size-3 transition-transform group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </Link>
                      <Link
                        href="/security"
                        onClick={() => setToolsOpen(false)}
                        className="text-xs text-muted transition-colors hover:text-foreground"
                      >
                        Security
                      </Link>
                    </div>
                  </div>
                ) : null}
              </li>

              {LEARN_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cn(
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


          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              href="/security"
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground lg:flex"
            >
              <ShieldCheck className="size-3.5 text-violet-glow" aria-hidden />
              Non-custodial
            </Link>
            <ProModeSwitch />
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
                className="top-[4.5rem] w-[calc(100vw-1.5rem)] max-w-sm translate-y-0 rounded-2xl p-4"
              >
                <DialogHeader className="mb-2">
                  <DialogTitle className="text-sm font-medium text-muted">
                    Menu
                  </DialogTitle>
                </DialogHeader>

                <nav aria-label="Main">
                  <p className="px-3 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-subtle">
                    Tools
                  </p>
                  <ul className="flex flex-col">
                    {TOOLS.map((tool) => (
                      <li key={tool.key}>
                        <Link
                          href={tool.href}
                          onClick={() => setMenuOpen(false)}
                          aria-current={isActive(tool.href) ? "page" : undefined}
                          className={cn(
                            "flex items-center justify-between rounded-xl px-3 py-3 text-sm transition-colors",
                            isActive(tool.href)
                              ? "bg-white/7 text-foreground ring-1 ring-inset ring-border"
                              : "text-muted hover:bg-white/5 hover:text-foreground",
                          )}
                        >
                          <span className="flex items-center gap-2.5">
                            <ToolEmblem
                              tool={tool.key}
                              className="size-4 text-violet-glow"
                            />
                            {tool.name}
                          </span>
                          <ArrowRight className="size-4" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-subtle">
                    Learn
                  </p>
                  <ul className="flex flex-col">
                    {LEARN_LINKS.map((link) => (
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
                    className="size-3.5 shrink-0 text-violet-glow"
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