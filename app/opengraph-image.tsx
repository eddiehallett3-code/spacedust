import { ImageResponse } from "next/og";

/**
 * The card a link to this site renders as.
 *
 * Without a file like this, `openGraph` asks for a `summary_large_image` card and
 * Next supplies nothing — so every shared link, chat unfurl and post about the
 * app showed a blank rectangle while a designed logo sat unused in `public/`.
 *
 * Generated rather than a static PNG so the wording is one string to change and
 * cannot drift from the app: if a tool is added, this card moves in the same
 * commit as the tool list below it.
 */
export const alt = "Spacedust — clean up your Solana wallet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The six tools, in the order the nav and the landing page show them. */
const TOOLS = [
  ["Swap", "Send", "Burn"],
  ["Reclaim", "Revoke", "Scan"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "84px 92px",
          backgroundColor: "#04050c",
          color: "#f4f2ff",
          fontFamily: "sans-serif",
        }}
      >
        {/* A violet rule rather than a gradient: Satori renders a solid edge
            identically everywhere, and a card that fails to build is a worse
            outcome than a plain one. */}
        <div
          style={{
            width: 132,
            height: 8,
            borderRadius: 999,
            backgroundColor: "#8b5cf6",
            marginBottom: 40,
          }}
        />

        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3 }}>
          Spacedust
        </div>

        <div
          style={{
            fontSize: 36,
            color: "#b9b3d6",
            marginTop: 22,
            lineHeight: 1.35,
          }}
        >
          Clean up your Solana wallet.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 56 }}>
          {TOOLS.map((row, index) => (
            <div key={index} style={{ display: "flex", gap: 18 }}>
              {row.map((tool) => (
                <div
                  key={tool}
                  style={{
                    padding: "12px 26px",
                    borderRadius: 999,
                    border: "1px solid rgba(139,92,246,0.5)",
                    backgroundColor: "rgba(139,92,246,0.16)",
                    color: "#ddd0ff",
                    fontSize: 30,
                  }}
                >
                  {tool}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
