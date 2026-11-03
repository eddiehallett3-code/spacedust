"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The coloured space behind the saucer.
 *
 * Four drifting washes of colour, three parallax layers of stars, and a slow
 * drift of dust. The pointer biases a parallax offset rather than triggering
 * anything, so the field looks alive with the mouse in a pocket and alive
 * without it.
 *
 * **Subtle, not dim.** The washes are deliberately low-alpha — a few percent —
 * but the hues are Solana's own at full saturation: `#9945FF`, `#14F195`,
 * `#00D1FF`, `#DC1FFF`. Desaturating those would make the layer grey rather
 * than quiet. What keeps it in the background is how little of it there is, not
 * how dull it is.
 *
 * **No square.** The canvas is a rectangle and its washes are brighter than the
 * body, so it carries a feather mask whose radii are exactly half the box: the
 * mask reaches zero alpha precisely at every edge, which leaves no boundary
 * anywhere and lets the colour bleed into the page.
 *
 * Performance: one canvas, no WebGL, DPR capped at 2, paused when the tab is
 * hidden or the stage has scrolled away, and a single static frame for
 * `prefers-reduced-motion`. The washes are baked into sprites and stretched
 * rather than re-created every frame.
 *
 * The star field is seeded, so the same cluster appears on every load.
 */

/** Everything tunable, in one place. */
const LOOK = {
  /** One star per this many square CSS pixels of stage. */
  starDensity: 5200,
  starMin: 60,
  starMax: 170,
  /**
   * Pointer offset for a star at depth 1, in CSS pixels. The far plane still
   * moves — a completely static background looks flat — but far less.
   */
  parallaxX: 26,
  parallaxY: 19,
  /**
   * How sharply movement falls off toward the far plane. Depth is raised to
   * this before it multiplies the offset, so the field separates rather than
   * sliding as one sheet: at 1.7 a `depth 0.4` star travels about a fifth of
   * what a `depth 0.9` one does, against roughly half at a linear 1.0.
   */
  parallaxCurve: 1.7,
  /**
   * A handful of foreground stars with depth above 1. Being outside the normal
   * range, they take the curve past its ceiling and sweep across the stage —
   * the near plane is what actually sells the depth, not more mid-field stars.
   */
  foreground: 12,
  /** How fast the field catches the pointer. Lower is heavier. */
  easing: 0.05,

  /**
   * The colour field. `x`/`y`/`radius` are fractions of the stage, `depth` is
   * how far the pointer moves that wash. Alpha stays low — the vibrancy comes
   * from the tint, not the weight.
   */
  washes: [
    { x: 0.22, y: 0.24, radius: 0.72, tint: [153, 69, 255], alpha: 0.085, drift: 0.0001, depth: 0.3 },
    { x: 0.8, y: 0.32, radius: 0.58, tint: [20, 241, 149], alpha: 0.05, drift: 0.00007, depth: 0.55 },
    { x: 0.68, y: 0.84, radius: 0.62, tint: [0, 209, 255], alpha: 0.045, drift: 0.00012, depth: 0.85 },
    { x: 0.34, y: 0.66, radius: 0.52, tint: [220, 31, 255], alpha: 0.035, drift: 0.00006, depth: 1 },
  ],
} as const;

/** Star tints, the same four the page-wide field uses. */
const TINTS = ["#e2e8ff", "#cddced", "#cfe4f5", "#ffffff"] as const;

const TAU = Math.PI * 2;

/** mulberry32 — small, seeded, and plenty for scattering points. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  /** 0 far, 1 near. Drives size, brightness and pointer offset together. */
  depth: number;
  phase: number;
  speed: number;
  tint: string;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  alpha: number;
  depth: number;
  rise: number;
  sway: number;
  phase: number;
}

export function HeroSpace({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // A tap has no hover, so a touch device gets the drift and no parallax.
    const coarsePointer = window.matchMedia("(hover: none)").matches;

    const random = seeded(0x5eed1e);

    // Washes are gradients, so they are baked once into sprites and stretched.
    const washSprites = LOOK.washes.map((wash) => makeWashSprite(wash.tint, 256));
    const moteSprite = makeMoteSprite(96);

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let motes: Mote[] = [];
    let raf = 0;
    let lastTime = 0;
    let onScreen = true;
    let targetX = 0;
    let targetY = 0;
    let easedX = 0;
    let easedY = 0;

    const build = (): void => {
      const area = width * height;
      const count = Math.round(
        Math.min(LOOK.starMax, Math.max(LOOK.starMin, area / LOOK.starDensity)),
      );

      stars = Array.from({ length: count }, () => {
        // Bias toward the far plane: a field where every star is equally bright
        // reads as confetti.
        const depth = Math.pow(random(), 0.75);
        return {
          x: random() * width,
          y: random() * height,
          r: 0.35 + depth * 1.2,
          depth,
          phase: random() * TAU,
          speed: 0.0004 + random() * 0.0012,
          tint: TINTS[Math.floor(random() * TINTS.length)] ?? TINTS[0],
        };
      });

      // Foreground layer. Depth runs past 1 so the parallax curve takes these
      // well beyond the near plane of the main field; they are drawn larger too,
      // which is the other half of the depth cue.
      const foreground = Array.from({ length: LOOK.foreground }, () => ({
        x: random() * width,
        y: random() * height,
        r: 1.8 + random() * 1.4,
        depth: 1.3 + random() * 0.55,
        phase: random() * TAU,
        speed: 0.0005 + random() * 0.0014,
        tint: TINTS[Math.floor(random() * TINTS.length)] ?? TINTS[0],
      }));
      stars = [...stars, ...foreground];

      const moteCount = Math.round(Math.min(22, Math.max(8, area / 28_000)));
      motes = Array.from({ length: moteCount }, () => ({
        x: random() * width,
        y: random() * height,
        r: 0.9 + random() * 1.6,
        alpha: 0.035 + random() * 0.07,
        depth: 0.4 + random() * 0.6,
        rise: 2 + random() * 4,
        sway: 5 + random() * 12,
        phase: random() * TAU,
      }));
    };

    const drawFrame = (time: number): void => {
      // Frame-rate independent easing: the same weight at 30fps and 120fps.
      const dt = lastTime === 0 ? 16.7 : Math.min(64, time - lastTime);
      lastTime = time;
      const catchUp = 1 - Math.pow(1 - LOOK.easing, dt / 16.7);
      easedX += (targetX - easedX) * catchUp;
      easedY += (targetY - easedY) * catchUp;

      ctx.clearRect(0, 0, width, height);

      // 1. Colour. Four washes at different depths, so the palette separates as
      // the pointer moves rather than the whole layer sliding as one.
      for (let index = 0; index < LOOK.washes.length; index += 1) {
        const wash = LOOK.washes[index];
        const sprite = washSprites[index];
        if (!wash || !sprite) continue;

        const driftX = Math.sin(time * wash.drift + index * 2.1) * width * 0.035;
        const driftY =
          Math.cos(time * wash.drift * 0.8 + index * 1.7) * height * 0.03;
        const cx = wash.x * width + driftX + easedX * wash.depth * 10;
        const cy = wash.y * height + driftY + easedY * wash.depth * 8;
        const radius = Math.max(width, height) * wash.radius;

        ctx.globalAlpha = wash.alpha;
        ctx.drawImage(sprite, cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.globalAlpha = 1;

      // 2. Stars. Depth is raised to `parallaxCurve` first, so the near plane
      // travels several times further than the far plane for the same pointer
      // movement — the separation is the depth, not the total distance.
      for (const star of stars) {
        const pull = Math.pow(star.depth, LOOK.parallaxCurve);
        const x =
          star.x +
          easedX * pull * LOOK.parallaxX +
          Math.sin(time * star.speed + star.phase) * (1.2 + pull * 7);
        const y =
          star.y +
          easedY * pull * LOOK.parallaxY +
          Math.cos(time * star.speed * 0.8 + star.phase * 1.3) *
            (0.8 + pull * 5.5);

        // Slow, unequal twinkle: one shared frequency would pulse in unison.
        const twinkle = 0.72 + 0.28 * Math.sin(time * 0.0011 + star.phase * 3.1);
        // Capped at depth 1 so the foreground layer is bigger, not brighter.
        const alpha = (0.1 + Math.min(star.depth, 1) * 0.4) * twinkle;
        // A near star grows a touch as the field leans, which reads as moving
        // toward it rather than past it.
        const radius = star.r * (1 + pull * 0.14);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = star.tint;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.fill();

        if (star.depth > 0.87) {
          ctx.globalAlpha = alpha * 0.1;
          ctx.beginPath();
          ctx.arc(x, y, radius * 3.6, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // 3. Dust in front, so the field has a near plane.
      for (const mote of motes) {
        mote.y -= (mote.rise * dt) / 1000;
        if (mote.y < -mote.r * 8) {
          mote.y = height + mote.r * 8;
          mote.x = random() * width;
        }

        const x =
          mote.x +
          Math.sin(time * 0.0003 + mote.phase) * mote.sway +
          easedX * mote.depth * 34;
        const y = mote.y + easedY * mote.depth * 26;
        const size = mote.r * 6;

        ctx.globalAlpha = mote.alpha;
        ctx.drawImage(moteSprite, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };


    const loop = (time: number): void => {
      drawFrame(time);
      raf = requestAnimationFrame(loop);
    };

    const start = (): void => {
      if (raf || reducedMotion) return;
      lastTime = 0;
      raf = requestAnimationFrame(loop);
    };

    const stop = (): void => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const resize = (): void => {
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (!nextWidth || !nextHeight) return;

      const changed = nextWidth !== width || nextHeight !== height;
      width = nextWidth;
      height = nextHeight;

      // Cap the backing store: a DPR-3 phone would otherwise paint four times
      // the pixels for a decorative layer.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (changed) build();
      lastTime = 0;
      if (reducedMotion) drawFrame(0);
    };

    const handlePointer = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Clamped, not wrapped: the pointer spends most of its life outside the
      // stage, and the field should lean at its limit rather than lurch.
      targetX = Math.max(
        -1,
        Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1),
      );
      targetY = Math.max(
        -1,
        Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
    };

    const resetPointer = (): void => {
      targetX = 0;
      targetY = 0;
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) stop();
      else if (onScreen) start();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Paused when the hero is scrolled away, so the rest of a long page does
    // not keep a canvas awake.
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen && !document.hidden) start();
        else stop();
      },
      { rootMargin: "160px" },
    );
    intersectionObserver.observe(canvas);

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!coarsePointer) {
      window.addEventListener("pointermove", handlePointer, { passive: true });
      window.addEventListener("blur", resetPointer);
    }

    resize();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("blur", resetPointer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      /**
       * Feather the layer into the page.
       *
       * The washes are brighter than the body behind them, so without this the
       * canvas's own rectangle reads as a lit square inside the hero. The mask's
       * radii are exactly half the box, so it reaches zero alpha precisely at
       * every edge and leaves no line anywhere.
       */
      style={{
        maskImage:
          "radial-gradient(ellipse 52% 52% at 50% 50%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 30%, rgba(0,0,0,0.6) 58%, rgba(0,0,0,0.2) 80%, rgba(0,0,0,0) 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 52% 52% at 50% 50%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 30%, rgba(0,0,0,0.6) 58%, rgba(0,0,0,0.2) 80%, rgba(0,0,0,0) 100%)",
      }}
    />
  );
}

/**
 * One colour wash, baked into a sprite.
 *
 * The gradient is the tint at full alpha and the caller applies the wash's
 * strength with `globalAlpha`, so one sprite serves any weight.
 */
function makeWashSprite(
  tint: readonly number[],
  size: number,
): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const [r = 255, g = 255, b = 255] = tint;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(0.5, `rgba(${r},${g},${b},0.34)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

/** A dust mote: a soft dot, dimmer at the edge than a plain circle. */
function makeMoteSprite(size: number): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.3, "rgba(226,232,255,0.3)");
  gradient.addColorStop(1, "rgba(226,232,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

