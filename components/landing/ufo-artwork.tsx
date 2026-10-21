import { cn } from "@/lib/utils/cn";

/**
 * The Spacedust saucer, drawn as layered SVG rather than a bitmap or a 3D model.
 *
 * This follows the standalone UFO in the logo: a domed canopy over a wide disc,
 * separated by the dark equatorial band, with the speed lines kept as a hint of
 * direction. The extra depth comes from a real side hull and underside rather
 * than a single white ellipse: the top surface catches light, the lower hull
 * falls into shadow, and the rim carries the cyan/violet running lights.
 *
 * The caller supplies a unique gradient prefix because the mark appears more
 * than once on the landing page; duplicate SVG ids would make one copy inherit
 * the other's gradients.
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
  const surface = `${idPrefix}-surface`;
  const hull = `${idPrefix}-hull`;
  const underside = `${idPrefix}-underside`;
  const rim = `${idPrefix}-rim`;
  const beam = `${idPrefix}-beam`;
  const glow = `${idPrefix}-glow`;
  const blur = `${idPrefix}-blur`;
  const shadowBlur = `${idPrefix}-shadow-blur`;

  return (
    <div className={cn("relative min-w-0 max-w-full select-none", className)} aria-hidden>
      <div className="pointer-events-none absolute inset-[8%] -z-10 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.3),rgba(34,211,238,0.08)_48%,transparent_70%)] blur-2xl" />

      <svg
        viewBox="0 0 640 480"
        className="relative h-auto w-full max-w-full overflow-visible drop-shadow-[0_40px_58px_rgba(4,5,12,0.78)]"
        fill="none"
      >
        <defs>
          <radialGradient id={dome} cx="36%" cy="20%" r="82%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="32%" stopColor="#f8faff" />
            <stop offset="63%" stopColor="#d9e2f7" />
            <stop offset="86%" stopColor="#aab8de" />
            <stop offset="100%" stopColor="#7e8cb6" />
          </radialGradient>

          <linearGradient id={body} x1="0.08" y1="0" x2="0.92" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="24%" stopColor="#f0f5ff" />
            <stop offset="54%" stopColor="#d3def4" />
            <stop offset="79%" stopColor="#a0aed3" />
            <stop offset="100%" stopColor="#7d8ab2" />
          </linearGradient>

          <linearGradient id={surface} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#edf4ff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#b8c8e8" stopOpacity="0.2" />
          </linearGradient>

          <linearGradient id={hull} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8d9bc2" />
            <stop offset="30%" stopColor="#5a668b" />
            <stop offset="63%" stopColor="#293250" />
            <stop offset="100%" stopColor="#080d1d" />
          </linearGradient>

          <radialGradient id={underside} cx="50%" cy="36%" r="74%">
            <stop offset="0%" stopColor="#4d5a7e" />
            <stop offset="52%" stopColor="#1b2441" />
            <stop offset="100%" stopColor="#060a17" />
          </radialGradient>

          <linearGradient id={rim} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#dce6fb" />
            <stop offset="100%" stopColor="#7483ab" />
          </linearGradient>

          <linearGradient id={beam} x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.32" />
            <stop offset="48%" stopColor="#22d3ee" stopOpacity="0.1" />
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

          <filter id={shadowBlur} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
        </defs>

        {/* Atmosphere, contact shadow and the soft under-light stay behind the craft. */}
        <ellipse cx="320" cy="286" rx="292" ry="162" fill={`url(#${glow})`} />
        <ellipse
          cx="320"
          cy="382"
          rx="188"
          ry="26"
          fill="#02040d"
          opacity="0.78"
          filter={`url(#${shadowBlur})`}
        />
        <ellipse
          cx="320"
          cy="438"
          rx="154"
          ry="18"
          fill="#67e8f9"
          opacity="0.16"
          filter={`url(#${blur})`}
        />

        {/* A wide, very faint beam. It should read as atmosphere, not a spotlight. */}
        <path
          d="M 218 292 L 422 292 L 510 468 L 130 468 Z"
          fill={`url(#${beam})`}
        />

        {/* Speed lines, borrowed from the logo's original direction. */}
        <g stroke="#67e8f9" strokeLinecap="round" opacity="0.32">
          <path d="M 84 302 L 204 276" strokeWidth="2" />
          <path d="M 58 334 L 186 305" strokeWidth="1.4" opacity="0.75" />
          <path d="M 106 362 L 218 336" strokeWidth="1" opacity="0.55" />
        </g>

        {/* The shaded hull gives the disc its thickness. */}
        <ellipse cx="320" cy="278" rx="222" ry="60" fill={`url(#${hull})`} />
        <ellipse
          cx="320"
          cy="292"
          rx="188"
          ry="34"
          fill={`url(#${underside})`}
          opacity="0.9"
        />

        {/* Top surface: the lit, slightly inset deck. */}
        <ellipse
          cx="320"
          cy="248"
          rx="228"
          ry="62"
          fill={`url(#${body})`}
          stroke="#f8fbff"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />
        <ellipse
          cx="320"
          cy="242"
          rx="196"
          ry="43"
          fill={`url(#${surface})`}
          stroke="#ffffff"
          strokeOpacity="0.18"
          strokeWidth="1"
        />

        {/* Upper rim catches the key light; the lower arc is the dark seam. */}
        <path
          d="M 106 248 C 132 208 508 208 534 248"
          stroke="#ffffff"
          strokeOpacity="0.82"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M 98 258 Q 320 338 542 258"
          stroke="#6d7ca8"
          strokeOpacity="0.72"
          strokeWidth="2"
        />
        <path
          d="M 108 258 Q 320 326 532 258"
          stroke="#b8c7e8"
          strokeOpacity="0.34"
          strokeWidth="1"
        />
        {/* The logo's dark band, wrapped around the front rim rather than
            filling the deck: a lens this wide reads as a hole, not a seam. */}
        <path
          d="M 100 256 Q 320 322 540 256 L 540 264 Q 320 334 100 264 Z"
          fill="#080d1f"
          opacity="0.9"
        />
        <path
          d="M 108 256 Q 320 318 532 256"
          stroke="#cbd8f2"
          strokeOpacity="0.4"
          strokeWidth="1"
        />

        {/* Canopy: a tall, glassed dome sitting inside the rim. */}
        <ellipse cx="320" cy="246" rx="94" ry="16" fill="#0b1226" opacity="0.86" />
        <path
          d="M 228 246 C 228 160 412 160 412 246 Z"
          fill={`url(#${dome})`}
          stroke="#8c9cc2"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />
        <ellipse cx="320" cy="245" rx="91" ry="17" fill={`url(#${rim})`} opacity="0.96" />
        <ellipse cx="320" cy="247" rx="87" ry="11" fill="#10182f" opacity="0.8" />
        <path
          d="M 252 230 C 268 192 372 192 388 230"
          stroke="#ffffff"
          strokeOpacity="0.92"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse
          cx="286"
          cy="205"
          rx="34"
          ry="13"
          fill="#ffffff"
          opacity="0.56"
          transform="rotate(-16 286 205)"
        />

        {/* A little reflected violet on the shaded edge. */}
        <path
          d="M 477 258 Q 525 278 492 312"
          stroke="#8b5cf6"
          strokeOpacity="0.34"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Running lights set into the rim. */}
        {[
          { x: 172, y: 288, color: "#67e8f9" },
          { x: 240, y: 304, color: "#a78bfa" },
          { x: 320, y: 312, color: "#67e8f9" },
          { x: 400, y: 304, color: "#a78bfa" },
          { x: 468, y: 288, color: "#67e8f9" },
        ].map((light) => (
          <g key={`${light.x}-${light.y}`}>
            <circle
              cx={light.x}
              cy={light.y}
              r="12"
              fill={light.color}
              opacity="0.16"
            />
            <circle cx={light.x} cy={light.y} r="3.4" fill={light.color} />
            <circle
              cx={light.x}
              cy={light.y}
              r="1.2"
              fill="#ffffff"
              opacity="0.9"
            />
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

