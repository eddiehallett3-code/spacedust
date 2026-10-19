import { cn } from "@/lib/utils/cn";

/**
 * The Spacedust saucer, drawn as layered SVG rather than a bitmap or a 3D model.
 *
 * The logo's UFO is a flat white silhouette. This is a 2.5D interpretation of
 * it: a lit dome, a metallic disc, cyan/violet running lights and a faint
 * tractor beam. The caller supplies a unique gradient prefix because the mark
 * appears twice on the landing page — once static on phones, once as the
 * scroll-driven object on larger screens — and duplicate SVG ids would make the
 * second copy inherit the first one's gradients.
 *
 * Purely decorative, so it is hidden from assistive tech. The float animation is
 * applied to the wrapper and is disabled by the global reduced-motion rule.
 */
export function UfoArtwork({
  idPrefix,
  className,
}: {
  idPrefix: string;
  className?: string;
}) {
  const dome = `${idPrefix}-dome`;
  const body = `${idPrefix}-body`;
  const underside = `${idPrefix}-underside`;
  const beam = `${idPrefix}-beam`;
  const glow = `${idPrefix}-glow`;
  const blur = `${idPrefix}-blur`;

  return (
    <div className={cn("relative min-w-0 max-w-full select-none", className)} aria-hidden>
      <div className="pointer-events-none absolute inset-[8%] -z-10 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.3),rgba(34,211,238,0.08)_48%,transparent_70%)] blur-2xl" />

      <svg
        viewBox="0 0 640 480"
        className="relative h-auto w-full max-w-full overflow-visible drop-shadow-[0_36px_54px_rgba(4,5,12,0.7)]"
        fill="none"
      >
        <defs>
          <radialGradient id={dome} cx="38%" cy="27%" r="76%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="48%" stopColor="#eef2ff" />
            <stop offset="100%" stopColor="#9ca8cf" />
          </radialGradient>

          <linearGradient id={body} x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="34%" stopColor="#e8edff" />
            <stop offset="68%" stopColor="#b7c4e6" />
            <stop offset="100%" stopColor="#7785ae" />
          </linearGradient>

          <linearGradient id={underside} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#7c8ab4" />
            <stop offset="58%" stopColor="#3d486d" />
            <stop offset="100%" stopColor="#1b2140" />
          </linearGradient>

          <linearGradient id={beam} x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.30" />
            <stop offset="52%" stopColor="#22d3ee" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>

          <radialGradient id={glow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.42" />
            <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>

          <filter id={blur} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        {/* Atmosphere and underglow, kept behind the craft. */}
        <ellipse cx="320" cy="292" rx="286" ry="158" fill={`url(#${glow})`} />
        <ellipse
          cx="320"
          cy="438"
          rx="156"
          ry="18"
          fill="#67e8f9"
          opacity="0.14"
          filter={`url(#${blur})`}
        />

        {/* A wide, very faint beam. It should read as atmosphere, not a spotlight. */}
        <path
          d="M 218 278 L 422 278 L 510 464 L 130 464 Z"
          fill={`url(#${beam})`}
        />

        {/* Speed lines, borrowed from the logo's original direction. */}
        <g stroke="#67e8f9" strokeLinecap="round" opacity="0.32">
          <path d="M 84 302 L 204 276" strokeWidth="2" />
          <path d="M 58 334 L 186 305" strokeWidth="1.4" opacity="0.75" />
          <path d="M 106 362 L 218 336" strokeWidth="1" opacity="0.55" />
        </g>

        {/* Underside first, then the lit disc that sits over it. */}
        <ellipse cx="320" cy="278" rx="196" ry="44" fill={`url(#${underside})`} />
        <ellipse
          cx="320"
          cy="264"
          rx="210"
          ry="54"
          fill={`url(#${body})`}
          stroke="#f8fbff"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />

        {/* Rim highlights sell the curve without needing a texture. */}
        <ellipse
          cx="320"
          cy="260"
          rx="178"
          ry="38"
          stroke="#ffffff"
          strokeOpacity="0.58"
          strokeWidth="2"
        />
        <path
          d="M 146 262 Q 320 316 494 262"
          stroke="#8b5cf6"
          strokeOpacity="0.28"
          strokeWidth="2"
        />

        {/* Dome and its specular highlight. */}
        <path d="M 232 258 C 232 188 408 188 408 258 Z" fill={`url(#${dome})`} />
        <ellipse cx="320" cy="257" rx="88" ry="17" fill="#dfe7ff" opacity="0.9" />
        <path
          d="M 257 238 C 272 207 368 207 383 238"
          stroke="#ffffff"
          strokeOpacity="0.82"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse cx="291" cy="218" rx="24" ry="11" fill="#ffffff" opacity="0.55" />

        {/* Running lights around the front edge. */}
        {[
          { x: 172, y: 270, color: "#67e8f9" },
          { x: 240, y: 286, color: "#a78bfa" },
          { x: 320, y: 294, color: "#67e8f9" },
          { x: 400, y: 286, color: "#a78bfa" },
          { x: 468, y: 270, color: "#67e8f9" },
        ].map((light) => (
          <g key={`${light.x}-${light.y}`}>
            <circle
              cx={light.x}
              cy={light.y}
              r="11"
              fill={light.color}
              opacity="0.16"
            />
            <circle cx={light.x} cy={light.y} r="3.2" fill={light.color} />
          </g>
        ))}

        {/* A few sparkles keep the empty space feeling like space. */}
        <g fill="#ffffff">
          <path
            d="M 520 86 l 5 16 16 5 -16 5 -5 16 -5 -16 -16 -5 16 -5 z"
            opacity="0.9"
          />
          <path
            d="M 112 130 l 3 10 10 3 -10 3 -3 10 -3 -10 -10 -3 10 -3 z"
            opacity="0.62"
          />
          <circle cx="560" cy="170" r="2.5" opacity="0.6" />
          <circle cx="88" cy="210" r="1.8" opacity="0.48" />
          <circle cx="500" cy="350" r="1.6" opacity="0.42" />
        </g>
      </svg>
    </div>
  );
}

