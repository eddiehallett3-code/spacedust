import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DISPLAY_FONT_STYLE } from "@/lib/ui/fonts";
import { LandingProductPreview } from "./landing-product-preview";
import { HeroSpace } from "./hero-space";
import { UfoModel } from "./ufo-model";

/**
 * The landing hero.
 *
 * The root used to open with a 256px logo and an `sr-only` heading, which told a
 * first-time visitor almost nothing. This version leads with the job, a
 * read-only way in, and the three safety facts that matter before anyone
 * connects a wallet. The saucer sits in the right-hand column on desktop and in
 * the normal flow below the copy on phones; it scrolls with the hero rather than
 * following the viewport, so it can never trail the reader over the tool cards.
 *
 * The scan card underneath is deliberately not visible on arrival: the grid takes
 * the first screen and the card's own margin starts it just below the fold. That
 * is what the grid's desktop min-height is for, and why the section no longer
 * carries one.
 */
export function LandingHero() {
  return (
    /* No `100svh` on the section any more. A section that claims the first screen
       does not move the card below it: the section is as tall as its content, and
       the card is content. The grid below claims the screen instead, which is the
       only way to say "the hero occupies this, and the card starts after it". */
    <section
      aria-labelledby="landing-heading"
      className="relative z-10 flex flex-col pb-8 pt-16 sm:pb-10 sm:pt-16 lg:pb-16 lg:pt-10"
    >
      {/* `content-start` is what makes the min-height free: rows pack to the top,
          so surplus height is empty space below the hero rather than space
          inserted between the hero and its copy. Content already taller than the
          minimum simply wins, so a short window is untouched.

          On desktop the minimum is the first screen minus the 3.5rem header, the
          section's `pt-10` and the 4rem that the scan card's own `mt-16` adds —
          i.e. `100svh - 8rem` — which leaves the card's top edge 32px below the
          fold at any height, and its 16px glow inset inside that. Measured before
          the change: the card began at 769px at every desktop width, so a 900px
          window showed 131px of it and a 1080px window showed 311px.

          CAPPED at 54rem, because "the first screen" is a different amount of
          space on every screen and only some of it holds anything. On a 1440x1900
          window the uncapped grid was 1,772px tall with 500px of content at the
          top — a full screen of nothing between the hero and the card, which reads
          as a page that failed to load rather than a page with room to breathe.
          The cap leaves laptop heights untouched (a 900px window still resolves to
          772px) and stops the tall ones stretching. */}
      <div className="grid min-h-[calc(100svh-3.5rem)] content-start items-center gap-2 sm:gap-8 lg:min-h-[min(calc(100svh-8rem),54rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="mx-auto min-w-0 max-w-2xl text-center lg:mx-0 lg:text-left">
          <h1
            id="landing-heading"
            style={DISPLAY_FONT_STYLE}
            className="text-4xl font-semibold leading-[1.04] tracking-tight text-balance sm:text-5xl lg:text-6xl"
          >
            Clean up your{" "}
            <span className="text-brand-glow">Solana wallet.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
            Swap the dust, send what matters, burn what doesn&apos;t, reclaim the
            rent, revoke approvals — and scan any wallet without connecting.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Button asChild size="lg" className="group">
              <Link href="/scan">
                Scan a wallet free
                <ArrowRight
                  className="transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </Button>
            <Link
              href="#tools"
              className="group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted transition-colors hover:text-foreground"
            >
              Explore the tools
              <ArrowDown
                className="size-4 transition-transform group-hover:translate-y-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted lg:justify-start">
            {[
              { icon: ShieldCheck, text: "Non-custodial" },
              { icon: CheckCircle2, text: "Simulated before signing" },
              { icon: Wallet, text: "You sign everything" },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-1.5">
                <item.icon
                  className="size-3.5 shrink-0 text-brand-glow"
                  aria-hidden
                />
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        {/* The stage and the scan card share the right-hand column.
            The card used to sit below the hero at full width, which put the
            site's only real action — paste an address — below the fold on every
            desktop, under a button that promised it. The hero's own comment used
            to describe that as deliberate ("the card's top edge 32px below the
            fold"); it is hard to defend: the visitor reads a call to action and
            then cannot see the thing it points at.

            Saucer above, card below it, both in this column on desktop. On a
            phone the column stacks the same way, so nothing moves for the
            layout that has the least room. */}
        <div className="relative flex min-w-0 max-w-full flex-col items-center justify-center">
          <div className="relative flex w-full items-center justify-center lg:min-h-[17rem] lg:justify-end">
          {/* The orbit rings are the stage. Both breakpoints render the same
              WebGL model here; the copy hidden by a breakpoint reports a zero size
              and never builds a scene. The saucer is in the document rather than
              fixed, so scrolling moves it away with the hero instead of dragging
              it over the sections below.

              On phones there is no minimum stage height: the stage is exactly the
              saucer's box, so it sits directly under the safety list. The model
              also shrinks with the viewport height (see `.landing-saucer-mobile`),
              which keeps it fully above the fold in short in-app wallets such as
              Jupiter's. */}
          {/* The depth field the saucer sits in: colour, parallax stars and
              drifting dust, all of which lean toward the pointer. First child
              on purpose — it paints under the rings and the model without a
              z-index, and it is scoped to this stage so none of it leaks under
              the copy on the left. */}
          <HeroSpace />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="absolute size-[min(80vw,30rem)] rounded-full border border-white/[0.06] [transform:rotate(-18deg)_scaleY(0.42)]" />
            <div className="absolute size-[min(64vw,24rem)] rounded-full border border-brand-core/15 [transform:rotate(-18deg)_scaleY(0.42)]" />
          </div>

          <div className="landing-saucer-mobile relative w-full sm:max-w-[20rem] lg:hidden">
            <UfoModel className="animate-ufo-float" />
          </div>

          <div className="relative hidden w-full max-w-[min(32vw,420px)] lg:block">
            <UfoModel className="animate-ufo-float" />
          </div>
          </div>

          <LandingProductPreview className="mt-14 sm:mt-16 lg:mt-2 lg:max-w-none" />
        </div>
      </div>
    </section>
  );
}
