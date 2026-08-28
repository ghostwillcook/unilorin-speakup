import { useState } from "react";

/**
 * UNILORIN crest. Renders /unilorin-logo.jpeg when present and falls back to an
 * inline mark if it is missing, so the landing page never shows a broken image
 * — the spec requires / to be visually complete before anything is set up.
 */
export function UnilorinLogo({ size = 64 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <CrestFallback size={size} label="UNILORIN" initials="UNI" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the
    // onError fallback simple; next/image swallows the error boundary.
    <img
      src="/unilorin-logo.jpeg"
      alt="University of Ilorin"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="rounded-full border border-line object-cover shadow-[0_4px_12px_-4px_rgba(11,11,12,0.18)]"
    />
  );
}

/**
 * Students Affairs Unit mark. No such asset exists on this machine, so this is
 * a deliberate placeholder — drop the real file at /public/student-affairs.png
 * and swap this for <img>.
 */
export function StudentAffairsLogo({ size = 64 }: { size?: number }) {
  return <CrestFallback size={size} label="Students Affairs" initials="SAU" />;
}

function CrestFallback({
  size,
  label,
  initials,
}: {
  size: number;
  label: string;
  initials: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      style={{ filter: "drop-shadow(0 4px 12px rgba(11,11,12,0.14))" }}
    >
      <defs>
        <linearGradient id={`crest-${initials}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b0b0c" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#c2410c" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <path
        d="M50 4 L92 20 V52 C92 74 74 90 50 96 C26 90 8 74 8 52 V20 Z"
        fill="#ffffff"
        stroke={`url(#crest-${initials})`}
        strokeWidth="3"
      />
      <text
        x="50"
        y="58"
        textAnchor="middle"
        fontSize="24"
        fontWeight="700"
        fill="#0b0b0c"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing="1"
      >
        {initials}
      </text>
    </svg>
  );
}

/** Wordmark used in headers and the sidebar. */
export function SpeakUpWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="font-bold tracking-tight">
      <span className="text-graphite">SPEAK</span>
      <span className="text-accent">UP</span>
      {!compact && (
        <span className="ml-2 hidden text-xs font-medium uppercase tracking-widest text-muted sm:inline">
          UNILORIN
        </span>
      )}
    </span>
  );
}
