/**
 * Export the tool emblems as standalone image files.
 *
 * Usage: node scripts/make-tool-icons.mjs
 *
 * The marks live in `components/layout/tool-emblem.tsx` as React fragments
 * inside a record. Rather than copy their path data here — which would drift
 * the moment somebody edits a curve — this reads that file and pulls the inner
 * markup out of each entry. The JSX inside is already plain SVG (`path`,
 * `circle` with `d`/`cx`/`cy`/`r`), so the only work is dropping the JSX
 * comments and the `<>` fragment wrappers.
 *
 * Output, into `public/press/icons/`:
 *
 *   icon-<tool>.svg        white, transparent, viewBox 0 0 24 24
 *   icon-<tool>-512.png    512×512, transparent
 *   icon-<tool>-ink.svg    the same mark in near-black, for light layouts
 *
 * The stroke weight is the component's own — 1.5 units in a 24-unit box — so
 * an export is the same drawing the site shows, not a redraw. If an export ever
 * looks heavier than the page, that is the ratio the design chose, not a bug:
 * at 512px it resolves to a 32px stroke.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE = path.join(process.cwd(), "components", "layout", "tool-emblem.tsx");
const OUT = path.join(process.cwd(), "public", "press", "icons");
const PNG_SIZE = 512;

/** The six tools in nav order, then the two page-only marks. */
const KEYS = [
  "slingshot",
  "void",
  "payload",
  "salvage",
  "approvals",
  "scan",
  "how-it-works",
  "security",
];

/** White is what the site draws; ink is for layouts on a light background. */
const COLOURS = [
  { suffix: "", stroke: "#ffffff" },
  { suffix: "-ink", stroke: "#04050c" },
];

const source = fs.readFileSync(SOURCE, "utf8");

/** Pull one entry's inner SVG markup out of the ICONS record. */
function innerFor(key) {
  const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp(`\\n  ["']?${escaped}["']?: \\(\\n([\\s\\S]*?)\\n  \\),`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `No "${key}" emblem found in ${SOURCE}. If the ICONS record changed shape, fix this parser rather than copying the paths.`,
    );
  }
  return match[1]
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // drop the JSX comments
    .replace(/^\s*<>\s*/, "") // …the opening fragment, which sits at the start
    .replace(/\s*<\/>\s*$/, "") // …and the closing one, at the end
    .replace(/\n\s*<>/g, "")
    .replace(/\n\s*<\/>/g, "")
    .replace(/\s*\n\s*/g, " ") // collapse the source's indentation
    .trim();
}

/** The documented spec: stroke only, one weight, round ends, no fills. */
function svgFor(inner, stroke, size) {
  const dimensions = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });

const summary = [];
for (const key of KEYS) {
  const inner = innerFor(key);

  for (const { suffix, stroke } of COLOURS) {
    const base = `icon-${key}${suffix}`;
    const svg = svgFor(inner, stroke);
    fs.writeFileSync(path.join(OUT, `${base}.svg`), `${svg}\n`);

    await sharp(Buffer.from(svgFor(inner, stroke, PNG_SIZE)))
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `${base}-${PNG_SIZE}.png`));

    summary.push(base);
  }
}

console.log(`wrote ${summary.length * 2} files for ${KEYS.length} marks into public/press/icons/`);
for (const base of summary) console.log(`  ${base}.svg + ${base}-${PNG_SIZE}.png`);
