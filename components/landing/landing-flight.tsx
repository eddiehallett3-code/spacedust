"use client";

import { useEffect, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { UfoArtwork } from "./ufo-artwork";

/**
 * The scroll stage for the landing page.
 *
 * The saucer is fixed to the viewport and driven by vertical scroll. It banks,
 * drops, moves toward the right edge, shrinks and is gone by roughly the time
 * the tool cards arrive. A pixel-based path is used rather than the section's
 * progress: the tools section is tall, and progress-based motion kept the beam
 * glowing through the Wallet Scan card long after the hero had left.
 *
 * The scroll source is a passive window listener feeding a motion value. Framer
 * Motion's `useScroll` was tried first, but its value stayed at zero in this
 * document even while `window.scrollY` changed; an explicit listener is both
 * easier to verify and one less moving part.
 *
 * Nothing hijacks the scroll and the object is `pointer-events-none`, so every
 * link and wallet control stays reachable. `motion-reduce:hidden` removes it
 * for visitors who ask for reduced motion; the hero renders a static saucer in
 * that case. On phones the fixed object is hidden entirely and the hero's
 * in-flow saucer is used.
 */
export function LandingFlight({ children }: { children: ReactNode }) {
  const scrollY = useMotionValue(0);

  useEffect(() => {
    const update = (): void => {
      scrollY.set(window.scrollY);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scrollY]);

  const x = useSpring(useTransform(scrollY, [0, 320, 640, 880], [0, 40, 220, 360]), {
    stiffness: 80,
    damping: 24,
    mass: 0.5,
  });
  const y = useSpring(useTransform(scrollY, [0, 320, 640, 880], [0, 20, 100, 180]), {
    stiffness: 80,
    damping: 24,
    mass: 0.5,
  });
  const rotateX = useSpring(useTransform(scrollY, [0, 500], [22, 14]), {
    stiffness: 70,
    damping: 22,
    mass: 0.5,
  });
  const rotateY = useSpring(useTransform(scrollY, [0, 300, 700], [-6, 0, 10]), {
    stiffness: 70,
    damping: 22,
    mass: 0.5,
  });
  const rotateZ = useSpring(useTransform(scrollY, [0, 400, 800], [-6, -9, 14]), {
    stiffness: 70,
    damping: 22,
    mass: 0.5,
  });
  const scale = useSpring(
    useTransform(scrollY, [0, 320, 640, 880], [1, 0.94, 0.72, 0.45]),
    { stiffness: 80, damping: 24, mass: 0.5 },
  );
  const opacity = useTransform(scrollY, [0, 300, 480, 620], [1, 1, 0.35, 0]);

  return (
    <div className="relative">
      {children}

      <motion.div
        aria-hidden
        className="pointer-events-none fixed right-[1vw] top-[17vh] z-[1] landing-ufo-motion w-[min(40vw,560px)] will-change-transform"
        style={{
          x,
          y,
          rotateX,
          rotateY,
          rotateZ,
          scale,
          opacity,
          transformPerspective: 1400,
          transformStyle: "preserve-3d",
        }}
      >
        <UfoArtwork idPrefix="flight" className="animate-ufo-float" />
      </motion.div>
    </div>
  );
}

