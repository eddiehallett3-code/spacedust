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
  /** A little colour variation keeps the field from looking like dust. */
  color: string;
}

interface Meteor {
  startX: number;
  startY: number;
  startTime: number;
  duration: number;
  angle: number;
  length: number;
}

const STAR_TINTS = ["#e2e8ff", "#bae6fd", "#ddd6fe", "#ffffff"] as const;
const TAU = Math.PI * 2;

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
    let compact = true;
    let animationFrame = 0;
    let resizeFrame = 0;
    let running = true;
    let lastFrame = -1000;
    let meteor: Meteor | null = null;
    let nextMeteorAt = 5000 + Math.random() * 4000;

    // Density scales with area, but the phone budget is deliberately much
    // smaller. A 390×844 screen gets roughly 55 stars at 30fps instead of 160
    // at 60fps; that is the difference between a living background and a
    // battery-draining one.
    const buildStars = (): void => {
      const area = width * height;
      const count = Math.round(
        Math.min(
          compact ? 80 : 190,
          Math.max(compact ? 32 : 45, area / (compact ? 6000 : 9000)),
        ),
      );

      stars = Array.from({ length: count }, () => {
        const depth = Math.random();
        const color =
          STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)] ?? "#e2e8ff";

        return {
          x: Math.random() * width,
          y: Math.random() * height,
          radius: 0.4 + depth * 1.1,
          alpha: 0.12 + depth * 0.38,
          phase: Math.random() * TAU,
          depth,
          color,
        };
      });
    };

    const resize = (): void => {
      const previousWidth = width;
      const previousHeight = height;
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;

      if (!nextWidth || !nextHeight) return;
      if (nextWidth === width && nextHeight === height) return;

      compact = nextWidth < 768;
      width = nextWidth;
      height = nextHeight;

      // Cap the backing store on phones. A DPR-3 phone would otherwise paint
      // roughly 3.8 million canvas pixels every frame for a decorative layer.
      const dpr = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The URL bar can change only the height on mobile. If the width is
      // unchanged, keep the existing stars and scale their y positions rather
      // than scattering a brand-new field mid-scroll.
      if (!stars.length || previousWidth !== width) {
        buildStars();
      } else if (previousHeight > 0 && previousHeight !== height) {
        const ratio = height / previousHeight;
        for (const star of stars) star.y *= ratio;
      }

      meteor = null;

      if (prefersReducedMotion) draw(0);
    };

    const scheduleResize = (): void => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
    };


    const spawnMeteor = (time: number): Meteor => {
      // A shallow, down-left streak from the upper right. It crosses in under a
      // second, so it reads as a detail rather than a second animation system.
      const angle = Math.PI * (0.78 + Math.random() * 0.08);

      return {
        startX: width * (0.62 + Math.random() * 0.3),
        startY: height * (0.04 + Math.random() * 0.24),
        startTime: time,
        duration: 700 + Math.random() * 450,
        angle,
        length: compact ? 90 : 150,
      };
    };

    const drawMeteor = (time: number): void => {
      if (!meteor && time >= nextMeteorAt) {
        meteor = spawnMeteor(time);
        nextMeteorAt =
          time + (compact ? 14000 : 9000) + Math.random() * 5000;
      }

      if (!meteor) return;

      const progress = (time - meteor.startTime) / meteor.duration;
      if (progress >= 1) {
        meteor = null;
        return;
      }

      const travel = progress * (compact ? 220 : 360);
      const headX = meteor.startX + Math.cos(meteor.angle) * travel;
      const headY = meteor.startY + Math.sin(meteor.angle) * travel;
      const tailX = headX - Math.cos(meteor.angle) * meteor.length;
      const tailY = headY - Math.sin(meteor.angle) * meteor.length;
      const fade = Math.sin(progress * Math.PI);

      const gradient = context.createLinearGradient(tailX, tailY, headX, headY);
      gradient.addColorStop(0, "rgba(103, 232, 249, 0)");
      gradient.addColorStop(
        0.55,
        `rgba(103, 232, 249, ${(0.18 * fade).toFixed(3)})`,
      );
      gradient.addColorStop(1, `rgba(255, 255, 255, ${(0.9 * fade).toFixed(3)})`);

      context.strokeStyle = gradient;
      context.lineWidth = compact ? 1.2 : 1.6;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(headX, headY);
      context.stroke();

      context.globalAlpha = fade;
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.arc(headX, headY, compact ? 1.3 : 1.8, 0, TAU);
      context.fill();
      context.globalAlpha = 1;
    };

    const draw = (time: number): void => {
      // Frame cap: stars do not need 120fps, and on a phone 30fps is both
      // visually sufficient and materially cheaper. The meteor rides the same
      // clock, so nothing looks detached from the star field.
      if (running && !prefersReducedMotion) {
        const frameMs = compact ? 1000 / 30 : 1000 / 60;
        if (time - lastFrame < frameMs) {
          animationFrame = requestAnimationFrame(draw);
          return;
        }
        lastFrame = time;
      }

      context.clearRect(0, 0, width, height);
      const motion = !prefersReducedMotion;

      for (const star of stars) {
        const twinkle = motion
          ? 0.55 + 0.45 * Math.sin(time / 3200 + star.phase)
          : 1;
        const alpha = star.alpha * twinkle;

        // Near stars drift a little more than far ones. The mobile amplitudes
        // are smaller because a larger movement at 30fps reads as stepping.
        const driftX = motion
          ? Math.sin(time / 12000 + star.phase) *
            star.depth *
            (compact ? 2 : 6)
          : 0;
        const driftY = motion
          ? Math.cos(time / 15000 + star.phase) *
            star.depth *
            (compact ? 1.5 : 5)
          : 0;

        const x = star.x + driftX;
        const y = star.y + driftY;

        context.globalAlpha = alpha;
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(x, y, star.radius, 0, TAU);
        context.fill();

        // The brightest few get a faint coloured halo for depth.
        if (star.depth > 0.84) {
          context.globalAlpha = alpha * 0.12;
          context.beginPath();
          context.arc(x, y, star.radius * 4, 0, TAU);
          context.fill();
        }
      }

      context.globalAlpha = 1;

      if (motion) {
        drawMeteor(time);
      }

      if (running && motion) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const start = (): void => {
      running = true;
      lastFrame = -1000;

      if (!prefersReducedMotion) {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const stop = (): void => {
      running = false;
      cancelAnimationFrame(animationFrame);
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) stop();
      else start();
    };

    resize();
    if (!prefersReducedMotion) {
      start();
    }

    window.addEventListener("resize", scheduleResize);
    window.addEventListener("orientationchange", scheduleResize);
    // Pausing when hidden saves a meaningful amount of battery on mobile.
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    // 100lvh is the large viewport: it does not resize when the mobile
    // address bar collapses, so the canvas is not rebuilt mid-scroll.
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-0 h-screen overflow-hidden"
      style={{ height: "100lvh" }}
    >
      <canvas ref={canvasRef} className="size-full" />
      {/* Nebula wash: one, not three.
          There used to be a violet orb top-left, a cyan one right and an indigo one
          bottom-left, all drifting on different delays. Against frosted cards that
          read as three differently-tinted surfaces and, on a page with one accent
          colour, as decoration for its own sake. One slow violet behind the copy
          lights the hero and leaves the rest of the page dark, which is what makes
          the saucer and the cards the bright things on screen.

          Radial gradients rather than large blurred circles: the gradient is smooth
          already, and it avoids a full-screen filter repaint every frame. */}
      <div className="absolute -left-[25%] top-[-20%] size-[85vw] rounded-full bg-[radial-gradient(circle,rgba(109,40,217,0.20),rgba(109,40,217,0.06)_45%,transparent_70%)] animate-drift will-change-transform" />
      {/* Vignette keeps focus on the centre of the page. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(4,5,12,0.65)_100%)]" />
    </div>
  );
}