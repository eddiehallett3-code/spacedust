/**
 * Render the site's background to flat image files, for publicity use.
 *
 * Usage: node scripts/make-background.mjs
 *
 * Why a generator rather than a screenshot: the backdrop is four layers that
 * only exist at runtime — a body wash, a nebula orb, a canvas starfield drawn
 * frame by frame, and a vignette — so a screenshot of any one page catches
 * whatever the stars happened to be doing that second and bakes in the page
 * content on top. This rebuilds the same layers as static SVG, from the values
 * in `app/globals.css` and `components/layout/starfield-background.tsx`, then
 * rasterises them. The star field is seeded, so two runs are byte-identical and
 * a design reviewed today still matches the file regenerated next month.
 *
 * If those two sources change, change the constants below with them. Every
 * colour here is quoted from them, not invented:
 *
 *   body        background-color: --color-space-950 = #04050c
 *   body wash   ellipse 80% 50% at 50% -10%, violet-deep 22% → transparent 70%
 *               ellipse 60% 40% at 90% 10%,  cyan-core   10% → transparent 70%
 *   nebula      circle, 85vw at (-25%, -20%), violet 20% → 6% at 45% → 0 at 70%
 *   vignette    ellipse at center, transparent 35% → rgba(4,5,12,0.65) 100%
 *   stars       0.4 + depth*1.1 radius, alpha 0.12 + depth*0.38, four tints
 *   meteor      down-left streak, cyan #67e8f9 tail → white head
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "press");

/** The viewport the layer sizes were tuned against, in CSS pixels. */
const DESIGN_WIDTH = 1440;

/** Star tints, in the order the component picks from them. */
const STAR_TINTS = ["#e2e8ff", "#bae6fd", "#ddd6fe", "#ffffff"];

/**
 * The look the site itself uses, as one object.
 *
 * Everything tunable lives here so a publicity variant can lift the hue without
 * touching the faithful defaults. The two that matter:
 *
 *  - `vignetteMax` crushes the corners. On the page that is right — it keeps
 *    focus on the saucer — but it is also what makes a bare backdrop read as
 *    near-black, so a variant eases it.
 *  - `density` multiplies the component's own star count. Spaced for a live
 *    window, it looks sparse in a still nobody is scrolling.
 */
const SITE_LOOK = {
  violet: 0.22,
  cyan: 0.1,
  nebula: 0.2,
  nebulaMid: 0.06,
  vignetteStart: 0.35,
  vignetteMax: 0.65,
  density: 1,
  starAlpha: 0.38,
};

/** The brief: stars and a faint hue of space, readable without the page content. */
const SPACE_LOOK = {
  ...SITE_LOOK,
  violet: 0.28,
  cyan: 0.14,
  nebula: 0.26,
  nebulaMid: 0.08,
  vignetteStart: 0.55,
  vignetteMax: 0.38,
  density: 1.8,
  starAlpha: 0.44,
};

/** A little more of everything, for when the faint one is too quiet. */
const SPACE_RICH_LOOK = {
  ...SPACE_LOOK,
  violet: 0.34,
  cyan: 0.18,
  nebula: 0.32,
  nebulaMid: 0.1,
  vignetteStart: 0.65,
  vignetteMax: 0.28,
  density: 2.6,
  starAlpha: 0.5,
};


/** mulberry32: small, seeded, and good enough for scattering points. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex, alpha) => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/**
 * An elliptical radial gradient, expressed the way CSS does but drawn the way
 * SVG can: a circle of radius `rx` squashed to `ry` about its own centre.
 */
function ellipseGradient({ id, cx, cy, rx, ry, stops }) {
  const squash = ry / rx;
  const transform = `translate(${cx} ${cy}) scale(1 ${squash}) translate(${-cx} ${-cy})`;
  const stopTags = stops
    .map(([offset, colour]) => `<stop offset="${offset}" stop-color="${colour}"/>`)
    .join("");
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${rx}" gradientTransform="${transform}">${stopTags}</radialGradient>`;
}

/**
 * Build the SVG for one size.
 *
 * `stars` draws the seeded field and its meteor; the "clean" variant leaves
 * both off so the file is a quiet wash to lay type over.
 */
function buildSvg({ width, height, stars, seed, look = SITE_LOOK }) {
  const scale = width / DESIGN_WIDTH;
  const designHeight = height / scale;
  const designArea = DESIGN_WIDTH * designHeight;

  // The component's own density rule, times the variant's multiplier so a still
  // image reads as a starfield rather than as scattered dots.
  const baseCount = Math.min(190, Math.max(45, designArea / 9000));
  const count = Math.round(baseCount * look.density);

  const defs = [];
  const layers = [];

  // 1. Body: flat base plus its two washes.
  layers.push(`<rect width="${width}" height="${height}" fill="#04050c"/>`);

  defs.push(
    ellipseGradient({
      id: "washViolet",
      cx: width * 0.5,
      cy: height * -0.1,
      rx: width * 0.8,
      ry: height * 0.5,
      stops: [
        [0, rgba("#6d28d9", look.violet)],
        [0.7, rgba("#6d28d9", 0)],
        [1, rgba("#6d28d9", 0)],
      ],
    }),
  );
  layers.push(`<rect width="${width}" height="${height}" fill="url(#washViolet)"/>`);

  defs.push(
    ellipseGradient({
      id: "washCyan",
      cx: width * 0.9,
      cy: height * 0.1,
      rx: width * 0.6,
      ry: height * 0.4,
      stops: [
        [0, rgba("#22d3ee", look.cyan)],
        [0.7, rgba("#22d3ee", 0)],
        [1, rgba("#22d3ee", 0)],
      ],
    }),
  );
  layers.push(`<rect width="${width}" height="${height}" fill="url(#washCyan)"/>`);

  // 2. The single nebula orb: a circle 85vw across, its top-left at (-25%,-20%).
  const orbRadius = (width * 0.85) / 2;
  const orbCx = -width * 0.25 + orbRadius;
  const orbCy = -height * 0.2 + orbRadius;
  defs.push(
    `<radialGradient id="nebula" gradientUnits="userSpaceOnUse" cx="${orbCx}" cy="${orbCy}" r="${orbRadius}">` +
      `<stop offset="0" stop-color="${rgba("#6d28d9", look.nebula)}"/>` +
      `<stop offset="0.45" stop-color="${rgba("#6d28d9", look.nebulaMid)}"/>` +
      `<stop offset="0.7" stop-color="${rgba("#6d28d9", 0)}"/>` +
      `<stop offset="1" stop-color="${rgba("#6d28d9", 0)}"/>` +
      `</radialGradient>`,
  );
  layers.push(
    `<circle cx="${orbCx}" cy="${orbCy}" r="${orbRadius}" fill="url(#nebula)"/>`,
  );


  // 3. The seeded starfield, with the same size and alpha curves.
  if (stars) {
    const random = seededRandom(seed);
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const depth = random();
      const tint =
        STAR_TINTS[Math.floor(random() * STAR_TINTS.length)] ?? STAR_TINTS[0];
      const x = random() * width;
      const y = random() * height;
      const radius = (0.4 + depth * 1.1) * scale;
      const alpha = 0.12 + depth * look.starAlpha;

      // The brightest few get the faint halo the component adds for depth.
      if (depth > 0.84) {
        points.push(
          `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius * 4).toFixed(2)}" fill="${tint}" fill-opacity="${(alpha * 0.12).toFixed(4)}"/>`,
        );
      }
      points.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${tint}" fill-opacity="${alpha.toFixed(4)}"/>`,
      );
    }

    // One meteor, at the shallow down-left angle the component uses, caught
    // near the middle of its flight so it reads as a streak, not a dot.
    const angle = Math.PI * 0.8;
    const length = 150 * scale;
    const travel = 198 * scale;
    const startX = width * 0.8;
    const startY = height * 0.12;
    const headX = startX + Math.cos(angle) * travel;
    const headY = startY + Math.sin(angle) * travel;
    const tailX = headX - Math.cos(angle) * length;
    const tailY = headY - Math.sin(angle) * length;
    const fade = 0.99;

    defs.push(
      `<linearGradient id="meteor" gradientUnits="userSpaceOnUse" x1="${tailX}" y1="${tailY}" x2="${headX}" y2="${headY}">` +
        `<stop offset="0" stop-color="${rgba("#67e8f9", 0)}"/>` +
        `<stop offset="0.55" stop-color="${rgba("#67e8f9", 0.18 * fade)}"/>` +
        `<stop offset="1" stop-color="${rgba("#ffffff", 0.9 * fade)}"/>` +
        `</linearGradient>`,
    );
    points.push(
      `<line x1="${tailX.toFixed(2)}" y1="${tailY.toFixed(2)}" x2="${headX.toFixed(2)}" y2="${headY.toFixed(2)}" stroke="url(#meteor)" stroke-width="${(1.6 * scale).toFixed(2)}" stroke-linecap="round"/>`,
      `<circle cx="${headX.toFixed(2)}" cy="${headY.toFixed(2)}" r="${(1.8 * scale).toFixed(2)}" fill="#ffffff" fill-opacity="${fade}"/>`,
    );
    layers.push(points.join(""));
  }

  // 4. Vignette, last, so it darkens everything under it.
  defs.push(
    ellipseGradient({
      id: "vignette",
      cx: width / 2,
      cy: height / 2,
      rx: width / Math.SQRT2,
      ry: height / Math.SQRT2,
      stops: [
        [0, rgba("#04050c", 0)],
        [look.vignetteStart, rgba("#04050c", 0)],
        [1, rgba("#04050c", look.vignetteMax)],
      ],
    }),
  );
  layers.push(`<rect width="${width}" height="${height}" fill="url(#vignette)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${layers.join("")}</svg>`;
}

/**
 * The sizes worth having. 4K is the master; 1920 and 2400×1200 cover a blog
 * hero and a wide social header; 1200×630 is the OG card ratio; the clean
 * variant is the same wash with no stars, for laying type over.
 */
const TARGETS = [
  { file: "background-3840x2160.png", width: 3840, height: 2160, stars: true },
  { file: "background-1920x1080.png", width: 1920, height: 1080, stars: true },
  { file: "background-2400x1200.png", width: 2400, height: 1200, stars: true },
  { file: "background-1200x630.png", width: 1200, height: 630, stars: true },
  {
    file: "background-clean-1920x1080.png",
    width: 1920,
    height: 1080,
    stars: false,
  },
  // The "stars and a faint hue of space" brief. The faithful files above keep
  // the site's own vignette, which is what makes a bare backdrop read as black;
  // these ease it and lift the wash so the colour is visible on its own.
  {
    file: "space-subtle-1920x1080.png",
    width: 1920,
    height: 1080,
    stars: true,
    look: { ...SITE_LOOK, vignetteMax: 0.5, density: 1.3 },
  },
  {
    file: "space-1920x1080.png",
    width: 1920,
    height: 1080,
    stars: true,
    look: SPACE_LOOK,
  },
  {
    file: "space-3840x2160.png",
    width: 3840,
    height: 2160,
    stars: true,
    look: SPACE_LOOK,
  },
  {
    file: "space-rich-1920x1080.png",
    width: 1920,
    height: 1080,
    stars: true,
    look: SPACE_RICH_LOOK,
  },
];

fs.mkdirSync(OUT, { recursive: true });

for (const target of TARGETS) {
  const svg = buildSvg({ ...target, seed: 20261031 });
  const file = path.join(OUT, target.file);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  const { size } = fs.statSync(file);
  console.log(
    `wrote ${target.file} — ${target.width}x${target.height}, ${(size / 1024).toFixed(0)} KiB`,
  );
}

