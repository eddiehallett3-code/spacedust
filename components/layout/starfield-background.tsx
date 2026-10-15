"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle animated starfield.
 *
 * Design constraints:
 *  - It must never compete with the content. Opacity stays under ~0.5 and the
 *    star count is low.
 *  - It must not cost battery on a phone. We pause the RAF loop whenever the
 *    tab is hidden, and we stop entirely if the user prefers reduced motion.
 *  - It is purely decorative, so it is `aria-hidden` and `pointer-events-none`.
 */

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  /** Phase offset so stars do not all twinkle in unison. */
  phase: number;
  /** Parallax depth, 0 (far) → 1 (near). */
  depth: number;
}

export function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    // Respect the OS-level motion preference: render one static frame instead.
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let running = true;

    // Density scales with area so a 5K monitor does not look empty and a phone
    // is not drawing 600 stars.
    const buildStars = (): void => {
      const area = width * height;
      const count = Math.round(
        Math.min(190, Math.max(45, area / 9000)),
      );
      stars = Array.from({ length: count }, () => {
        const depth = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 0.4 + depth * 1.1,
          alpha: 0.12 + depth * 0.38,
          phase: Math.random() * Math.PI * 2,
          depth,
        };
      });
    };

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
    };

    const draw = (time: number): void => {
      context.clearRect(0, 0, width, height);

      for (const star of stars) {
        // Twinkle via a slow sine, offset per star.
        const twinkle = prefersReducedMotion
          ? 1
          : 0.65 + 0.35 * Math.sin(time / 1400 + star.phase);
        const alpha = star.alpha * twinkle;

        // Near stars drift very slightly; far stars stay put.
        const driftX = prefersReducedMotion ? 0 : Math.sin(time / 9000 + star.phase) * star.depth * 6;
        const driftY = prefersReducedMotion ? 0 : Math.cos(time / 11000 + star.phase) * star.depth * 5;

        context.beginPath();
        context.arc(star.x + driftX, star.y + driftY, star.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(226, 232, 255, ${alpha.toFixed(3)})`;
        context.fill();

        // The brightest few get a faint violet halo for depth.
        if (star.depth > 0.82) {
          context.beginPath();
          context.arc(star.x + driftX, star.y + driftY, star.radius * 4, 0, Math.PI * 2);
          context.fillStyle = `rgba(139, 92, 246, ${(alpha * 0.1).toFixed(3)})`;
          context.fill();
        }
      }

      if (running && !prefersReducedMotion) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const start = (): void => {
      running = true;
      if (!prefersReducedMotion) {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const stop = (): void => {
      running = false;
      cancelAnimationFrame(animationFrame);
    };

    resize();
    if (prefersReducedMotion) {
      draw(0);
    } else {
      start();
    }

    window.addEventListener("resize", resize);
    // Pausing when hidden saves a meaningful amount of battery on mobile.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    return () => {
      stop();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="size-full" />
      {/* Soft nebula washes, slowly drifting. */}
      <div className="absolute -left-[15%] top-[-10%] size-[55vw] rounded-full bg-violet-deep/12 blur-[110px] animate-drift" />
      <div className="absolute -right-[10%] top-[25%] size-[45vw] rounded-full bg-cyan-core/8 blur-[120px] animate-drift [animation-delay:-8s]" />
      {/* Vignette keeps focus on the centre of the page. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(4,5,12,0.65)_100%)]" />
    </div>
  );
}