import { cn } from "@/lib/utils/cn";

/**
 * The compact UFO mark used in the navbar.
 *
 * The wordmark artwork is beautiful at hero size but its internal lettering is
 * illegible at 36px, and it duplicates the "Spacedust" text beside it. This is
 * a purpose-built mark: the silhouette and the cyan/violet lights survive at
 * small sizes without needing the logo's full detail.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={cn("text-white", className)}
    >
      {/* Speed lines from the wordmark's original UFO. */}
      <path
        d="M4 24.5 9.5 21.5M2.5 28.5 8 25.5"
        stroke="#67e8f9"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.65"
      />

      {/* Saucer body and dome. */}
      <ellipse cx="20.5" cy="22" rx="14" ry="4.2" fill="#dbe4ff" />
      <ellipse
        cx="20.5"
        cy="20.6"
        rx="14"
        ry="5.2"
        fill="#f8faff"
        stroke="#ffffff"
        strokeOpacity="0.8"
      />
      <path d="M13.5 19.5C13.5 13.2 27.5 13.2 27.5 19.5Z" fill="#eef2ff" />
      <ellipse cx="20.5" cy="19.2" rx="7" ry="1.55" fill="#cfd9f5" />

      {/* Running lights. */}
      <circle cx="12.5" cy="22.1" r="1" fill="#67e8f9" />
      <circle cx="17" cy="23.2" r="0.9" fill="#a78bfa" />
      <circle cx="20.5" cy="23.6" r="1" fill="#67e8f9" />
      <circle cx="24" cy="23.2" r="0.9" fill="#a78bfa" />
      <circle cx="28.5" cy="22.1" r="1" fill="#67e8f9" />

      {/* A single sparkle keeps the mark from feeling like a plain oval. */}
      <path
        d="M30 6.5 30.7 9.3 33.5 10 30.7 10.7 30 13.5 29.3 10.7 26.5 10 29.3 9.3Z"
        fill="#ffffff"
        opacity="0.9"
      />
    </svg>
  );
}
