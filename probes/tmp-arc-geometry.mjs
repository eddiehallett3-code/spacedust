/**
 * Temp check: does the Slingshot arc actually bend *toward* the letter it wraps?
 *
 * The whole reading depends on it. A gravity assist curves toward the mass, so the
 * arc's centre must be the letter's centre and the straight legs must be tangent to
 * it — otherwise the path has a corner (a wobble) instead of one smooth deflection.
 *
 * Resolves the SVG arc exactly as the renderer does, from the same `d` string.
 */

const PATH = "M 0 205 L 300 205 A 45 45 0 0 0 345 160 L 345 0";
/** The o's centre in the artwork's own coordinates — the mass. */
const LETTER = { x: 300, y: 160 };
const R = 45;
/** Half the x-height of the o at its rendered size, in artwork units. */
const LETTER_RADIUS = 26;

// ── Parse the arc out of the path string ────────────────────────────────────
const arc = PATH.match(/A (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)/);
if (!arc) throw new Error("no arc in path");
const [, rx, , , largeArc, sweep, ex, ey] = arc.map((v) => (isNaN(Number(v)) ? v : Number(v)));
const start = { x: 300, y: 205 };
const end = { x: ex, y: ey };

console.log("arc params:", { rx, largeArc, sweep, end });
console.log("  start:", start.x, start.y);

// ── Resolve the centre, the way the SVG spec says ───────────────────────────
const dx = (start.x - end.x) / 2;
const dy = (start.y - end.y) / 2;
const d = Math.sqrt(dx * dx + dy * dy);
const rSq = rx * rx;

const sign = largeArc === sweep ? -1 : 1;
const sq = Math.max(0, (rSq - d * d) / (d * d));
const factor = sign * Math.sqrt(sq);
const cxp = factor * (rx * dy) / rx;
const cyp = factor * -(rx * dx) / rx;
const centre = {
  x: cxp + (start.x + end.x) / 2,
  y: cyp + (start.y + end.y) / 2,
};

console.log("\narc centre :", centre.x.toFixed(3), centre.y.toFixed(3));
console.log("the letter :", LETTER.x, LETTER.y);
console.log(
  "  → centre matches the letter (the mass):",
  Math.abs(centre.x - LETTER.x) < 1e-6 && Math.abs(centre.y - LETTER.y) < 1e-6,
);

// ── Tangency: the legs are the arc's tangents, so there must be no corner ───
const angleOf = (p) => Math.atan2(p.y - centre.y, p.x - centre.x);
const aStart = angleOf(start);
const aEnd = angleOf(end);

// Tangent (counter-clockwise, matching sweep=0) is the radius rotated -90°.
const tangentAt = (a, dir) => ({
  x: Math.sin(a) * dir,
  y: -Math.cos(a) * dir,
});

const tStart = tangentAt(aStart, 1);
const tEnd = tangentAt(aEnd, 1);

console.log("\nincoming direction (1,0) vs arc tangent at start:",
  tStart.x.toFixed(3), tStart.y.toFixed(3));
console.log("outgoing direction (0,-1) vs arc tangent at end:",
  tEnd.x.toFixed(3), tEnd.y.toFixed(3));
console.log("  → straight in, straight out (no corner):",
  Math.abs(tStart.x - 1) < 1e-6 &&
    Math.abs(tStart.y) < 1e-6 &&
    Math.abs(tEnd.x) < 1e-6 &&
    Math.abs(tEnd.y + 1) < 1e-6);

// ── Concavity: the arc must bulge *away* from its centre, i.e. toward nothing ─
// A point on the arc is at radius R from the centre; the chord's midpoint is
// closer. So the bend curves around the planet, not away from it.
const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const aMid = (aStart + aEnd) / 2;
const arcMid = {
  x: centre.x + R * Math.cos(aMid),
  y: centre.y + R * Math.sin(aMid),
};

console.log("\nchord midpoint:", mid.x.toFixed(2), mid.y.toFixed(2),
  "→ distance from the letter:", dist(mid, centre).toFixed(2));
console.log("arc midpoint  :", arcMid.x.toFixed(2), arcMid.y.toFixed(2),
  "→ distance from the letter:", dist(arcMid, centre).toFixed(2));
console.log(
  "  → the arc bulges away from the letter, so it curves *around* it:",
  dist(arcMid, centre) > dist(mid, centre),
);
console.log("  → clearance from the glyph:",
  (R - LETTER_RADIUS).toFixed(1), "units (glyph radius", LETTER_RADIUS + ")");

// ── The motes sit on the path ───────────────────────────────────────────────
const MOTES = [
  { x: 50, y: 205 },
  { x: 150, y: 205 },
  { x: 265, y: 205 },
  { x: 345, y: 130.7 },
];

console.log("\nmotes: distance along the path from the letter's approach");
console.log("(a straight-line gap under-reports on the bend, so this walks the path)");

/** Arc length from the path's start to a mote, in artwork units. */
const ARC_LENGTH = R * Math.PI / 2;
const pathDistance = (m) => {
  if (m.y === 205 && m.x <= 300) return m.x; // approach leg
  if (m.x === 345 && m.y <= 160) return 300 + ARC_LENGTH + (160 - m.y); // escape leg
  return null;
};

let previous = null;
for (const m of MOTES) {
  const s = pathDistance(m);
  const gap = previous === null ? null : s - previous;
  console.log(
    "  ",
    `(${m.x}, ${m.y})`,
    "→ s =",
    s.toFixed(1),
    gap === null ? "" : `· gap ${gap.toFixed(1)}`,
  );
  previous = s;
}
console.log("  → gaps increase: 100, 115, 135 — it leaves faster than it arrived");
