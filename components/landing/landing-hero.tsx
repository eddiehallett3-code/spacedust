import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { LandingProductPreview } from "./landing-product-preview";
import { UfoArtwork } from "./ufo-artwork";

/**
 * The landing hero.
 *
 * The root used to open with a 256px logo and an `sr-only` heading, which told a
 * first-time visitor almost nothing. This version leads with the job, a
 * read-only way in, and the three safety facts that matter before anyone
 * connects a wallet. The saucer itself is supplied by `LandingFlight` on
 * desktop; on phones it sits in the normal flow below the copy.
 */
export function LandingHero() {
  return (
    <section
      aria-labelledby="landing-heading"
      className="relative z-10 flex flex-col justify-center pb-10 pt-12 sm:pt-16 lg:min-h-[calc(100svh-4rem)] lg:pb-16 lg:pt-10"
    >
      <div className="mb-6 flex flex-col items-end gap-1.5">
        <ModeToggle />
        <p className="max-w-[16rem] text-right text-[11px] text-subtle">
          Basic keeps the common paths. Pro adds deep cNFTs and advanced
          controls.
        </p>
      </div>

      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-8">
        <div className="mx-auto min-w-0 max-w-2xl text-center lg:mx-0 lg:text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/8 px-3 py-1 text-xs text-emerald-300">
            <ShieldCheck className="size-3.5" aria-hidden />
            Non-custodial · your keys stay in your wallet
          </p>

          <h1
            id="landing-heading"
            className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight text-balance sm:text-5xl lg:text-6xl"
          >
            Clean up your{" "}
            <span className="text-gradient">Solana wallet.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
            Swap the dust, send what matters, burn what doesn&apos;t, reclaim the
            rent, revoke approvals — and scan any wallet without connecting.
          </p>

          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center lg:justify-start">
            <Button asChild size="lg" className="group">
              <Link href="/scan">
                Scan a wallet free
                <ArrowRight
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="#tools">
                Explore the tools
                <ArrowDown aria-hidden />
              </Link>
            </Button>
          </div>

          <ul className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted lg:justify-start">
            {[
              { icon: ShieldCheck, text: "Non-custodial" },
              { icon: CheckCircle2, text: "Simulated before signing" },
              { icon: Wallet, text: "You sign everything" },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-1.5">
                <item.icon className="size-3.5 shrink-0 text-success" aria-hidden />
                {item.text}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-xs leading-relaxed text-subtle">
            No wallet connection needed for the scan. Every flow shows the exact
            transaction before you approve it.
          </p>
        </div>

        {/* The orbit rings are the stage. On desktop the fixed saucer from
            LandingFlight sits over them; on phones this is the real artwork. */}
        <div className="relative min-w-0 max-w-full flex min-h-[17rem] items-center justify-center lg:min-h-[38rem] lg:justify-end">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="absolute size-[min(80vw,30rem)] rounded-[50%] border border-white/[0.06] [transform:rotate(-18deg)_scaleY(0.42)]" />
            <div className="absolute size-[min(64vw,24rem)] rounded-[50%] border border-violet-core/15 [transform:rotate(-18deg)_scaleY(0.42)]" />
            <div className="absolute size-40 rounded-full bg-violet-core/10 blur-3xl" />
          </div>

          <div className="relative w-full max-w-[20rem] lg:hidden">
            <UfoArtwork idPrefix="mobile" className="animate-ufo-float" />
          </div>

          <div className="reduced-ufo relative w-full max-w-[min(38vw,520px)]">
            <UfoArtwork idPrefix="reduced" className="animate-ufo-float" />
          </div>
        </div>
      </div>

      <LandingProductPreview />

      <div className="mt-8 flex justify-center lg:mt-10">
        <a
          href="#tools"
          className="group inline-flex flex-col items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-subtle transition-colors hover:text-muted"
        >
          Scroll to the toolkit
          <ArrowDown
            className="size-3.5 transition-transform group-hover:translate-y-0.5"
            aria-hidden
          />
        </a>
      </div>
    </section>
  );
}
