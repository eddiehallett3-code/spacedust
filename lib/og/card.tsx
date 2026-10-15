import { ImageResponse } from "next/og";

/**
 * The card a *tool* link renders as.
 *
 * The root `app/opengraph-image.tsx` already covers the site, and it describes the
 * product — which is the right card for the explainer pages. It is the wrong card
 * for a link to one tool: someone sharing `/scan` in a chat was advertising "six
 * non-custodial tools" rather than the read-only lookup they had just used, so the
 * unfurl told the reader nothing about why they should click.
 *
 * Built here rather than copied into six files for the reason the five minute
 * details in `TOOLS` live in one object: six near-identical cards drift, and the
 * one that drifts is the one nobody looks at. The route files are three lines each
 * and hold no design.
 *
 * Satori is not a browser. It supports a subset of flexbox and inline styles only —
 * no CSS file, no Tailwind classes, no `gap` on a bare flex container without an
 * explicit `display`, and any `div` with more than one child needs `display: flex`
 * spelled out. The styles below are shaped around those limits, which is why they
 * look unlike every other component in this repo.
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export function ogCard({ title, subtitle }: { title: string; subtitle: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "84px 92px",
          backgroundColor: "#04050c",
          color: "#f4f2ff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* A violet rule rather than a gradient: Satori renders a solid edge
              identically everywhere, and a card that fails to build is a worse
              outcome than a plain one. Same treatment as the root card. */}
          <div
            style={{
              width: 132,
              height: 8,
              borderRadius: 999,
              backgroundColor: "#8b5cf6",
              marginBottom: 40,
            }}
          />
          <div style={{ fontSize: 92, fontWeight: 700, letterSpacing: -3 }}>{title}</div>
          <div
            style={{
              fontSize: 34,
              color: "#b9b3d6",
              marginTop: 22,
              lineHeight: 1.35,
            }}
          >
            {subtitle}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 30,
            color: "#8b93b8",
          }}
        >
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>Spacedust</span>
          <span>·</span>
          <span>Non-custodial. You sign every transaction.</span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
