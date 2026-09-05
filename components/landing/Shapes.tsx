import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/useInView";

/**
 * Scroll-linked parallax for the hero's floating objects, per the Wollo motion
 * spec: foreground objects travel faster than their container (speed 0.3)
 * to manufacture Z-axis depth.
 *
 * The translation is applied to this wrapper while the idle float animation
 * runs on the child (see .wl-float), so the two transforms never fight over
 * the same element. A rAF gate means at most one transform per frame however
 * fast the browser fires scroll events, and the listener is passive so it can
 * never delay scrolling.
 */
export function ParallaxObject({
  speed = 0.3,
  className = "",
  style,
  children,
}: {
  /** Fraction of window.scrollY applied as translateY. 0.3 = spec's foreground. */
  speed?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;

    let raf = 0;
    const apply = () => {
      raf = 0;
      if (ref.current) {
        ref.current.style.transform = `translateY(${window.scrollY * speed}px)`;
      }
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [speed, reduced]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

/**
 * The hero diorama's matte 3D objects. Each is an SVG lit like clay: a single
 * light source at the top-left (matching the page's shadow direction), a
 * specular highlight where that light lands, and an occlusion shade where the
 * form turns away from it — the Pixar-clay look rather than glossy plastic,
 * because .wl-shape's ::after grain overlay keeps the finish matte.
 *
 * Every gradient stops short of pure white/pure black so nothing reads as
 * plastic or as an outline. Sizes and tilts are set per instance; nothing
 * here is interactive — the shapes are aria-hidden decoration for a headline
 * that carries its own meaning. Cursor tilt is applied by the .wl-tilt
 * wrapper around these shapes, not by the shapes themselves.
 */

/** Soft elliptical light landing — the specular highlight every shape shares.
 *  Positioned top-left because that is where the page's light comes from. */
function Highlight({
  id,
  cx,
  cy,
  rx,
  ry,
  opacity = 0.55,
}: {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity?: number;
}) {
  return (
    <>
      <defs>
        <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity={opacity} />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity={opacity * 0.35} />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
    </>
  );
}

export function SpeechBubbleShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 120 110">
        <defs>
          <linearGradient id="wl-bubble" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#efe9ff" />
            <stop offset="1" stopColor="#c9b8f7" />
          </linearGradient>
          <linearGradient id="wl-bubble-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.55" stopColor="#7b5cd6" stopOpacity="0" />
            <stop offset="1" stopColor="#7b5cd6" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <path
          d="M60 6c29 0 52 18 52 42S89 90 60 90c-5 0-10-.5-14.6-1.4L24 104l6.8-17.6C17.4 79.2 8 64.9 8 48 8 24 31 6 60 6Z"
          fill="url(#wl-bubble)"
        />
        {/* Occlusion: the bubble's lower lip turns away from the top-left light. */}
        <path
          d="M60 6c29 0 52 18 52 42S89 90 60 90c-5 0-10-.5-14.6-1.4L24 104l6.8-17.6C17.4 79.2 8 64.9 8 48 8 24 31 6 60 6Z"
          fill="url(#wl-bubble-shade)"
        />
        <Highlight id="wl-bubble-hl" cx={42} cy={28} rx={30} ry={18} opacity={0.75} />
        <circle cx="42" cy="46" r="5" fill="#10026f" opacity="0.85" />
        <circle cx="60" cy="46" r="5" fill="#10026f" opacity="0.85" />
        <circle cx="78" cy="46" r="5" fill="#10026f" opacity="0.85" />
      </svg>
    </span>
  );
}

export function MegaphoneShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 130 110">
        <defs>
          <linearGradient id="wl-mega" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#ffd166" />
            <stop offset="0.55" stopColor="#f4ac0b" />
            <stop offset="1" stopColor="#c96a12" />
          </linearGradient>
          <linearGradient id="wl-mega2" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#c14fd2" />
            <stop offset="0.55" stopColor="#ac2ebc" />
            <stop offset="1" stopColor="#7d1f8c" />
          </linearGradient>
        </defs>
        <g transform="rotate(-18 60 55)">
          <path
            d="M14 42h14l36-26v78L28 68H14a8 8 0 0 1-8-8V50a8 8 0 0 1 8-8Z"
            fill="url(#wl-mega)"
          />
          {/* The cone's inner face, one step darker — it faces away from the
              light, which is what makes the horn read as a volume. */}
          <path
            d="M28 42 64 16v78L28 68Z"
            fill="#b35f0e"
            opacity="0.55"
          />
          <Highlight id="wl-mega-hl" cx={40} cy={50} rx={22} ry={14} opacity={0.6} />
          <rect x="84" y="34" width="26" height="12" rx="6" fill="url(#wl-mega2)" />
          <rect x="86" y="58" width="20" height="10" rx="5" fill="url(#wl-mega2)" />
          {/* Sound-wave pills get their own tiny top lights so they read as
              rounded bars, not flat rectangles. */}
          <rect x="87" y="35.5" width="20" height="3.5" rx="1.75" fill="#ffffff" opacity="0.35" />
          <rect x="89" y="59.5" width="14" height="3" rx="1.5" fill="#ffffff" opacity="0.3" />
        </g>
      </svg>
    </span>
  );
}

export function HeartShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 100 92">
        <defs>
          <linearGradient id="wl-heart" x1="0.15" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#ff8fa8" />
            <stop offset="0.5" stopColor="#ff5b7f" />
            <stop offset="1" stopColor="#c8103f" />
          </linearGradient>
        </defs>
        <path
          d="M50 86S6 60 6 32.7C6 17 18.8 6 32.5 6 41 6 47.3 10.4 50 15.8 52.7 10.4 59 6 67.5 6 81.2 6 94 17 94 32.7 94 60 50 86 50 86Z"
          fill="url(#wl-heart)"
        />
        {/* The classic clay-heart gloss: one broad sheen where the light
            lands on the upper-left lobe, one small tight sparkle beside it. */}
        <Highlight id="wl-heart-hl" cx={32} cy={26} rx={20} ry={14} opacity={0.65} />
        <ellipse cx="63" cy="18" rx="5" ry="3.5" fill="#ffffff" opacity="0.5" transform="rotate(-18 63 18)" />
      </svg>
    </span>
  );
}

export function ShieldShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 92 104">
        <defs>
          <linearGradient id="wl-shield" x1="0.15" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#b7e2ff" />
            <stop offset="0.5" stopColor="#8fd0ff" />
            <stop offset="1" stopColor="#2e5fe0" />
          </linearGradient>
        </defs>
        <path
          d="M46 4 82 16v32c0 26-15.6 44.4-36 52C25.6 92.4 10 74 10 48V16L46 4Z"
          fill="url(#wl-shield)"
        />
        {/* Left face catches the light, right face turns into shade — two
            overlay paths split down the shield's spine give it thickness. */}
        <path
          d="M46 4 82 16v32c0 26-15.6 44.4-36 52Z"
          fill="#1d3fa8"
          opacity="0.35"
        />
        <Highlight id="wl-shield-hl" cx={32} cy={26} rx={16} ry={22} opacity={0.55} />
        <path
          d="m30 52 11 11 22-24"
          stroke="#ffffff"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}

export function SphereShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="wl-sphere" cx="0.35" cy="0.3" r="0.95">
            <stop offset="0" stopColor="#f2e9ff" />
            <stop offset="0.45" stopColor="#c05fd0" />
            <stop offset="0.8" stopColor="#ac2ebc" />
            <stop offset="1" stopColor="#4a0f55" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="url(#wl-sphere)" />
        {/* A sphere needs its light to land as a place, not a direction —
            one broad sheen plus a tight window reflection on the upper left. */}
        <Highlight id="wl-sphere-hl" cx={36} cy={32} rx={20} ry={16} opacity={0.7} />
        <ellipse cx="38" cy="28" rx="7" ry="5" fill="#ffffff" opacity="0.65" transform="rotate(-20 38 28)" />
      </svg>
    </span>
  );
}

export function RingShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="wl-ring" x1="0.1" y1="0.1" x2="0.95" y2="0.95">
            <stop offset="0" stopColor="#ffe3a0" />
            <stop offset="0.5" stopColor="#ffd166" />
            <stop offset="1" stopColor="#d98f06" />
          </linearGradient>
        </defs>
        {/* The band is drawn twice: full-strength ring, then a dark arc over
            the far side so the torus reads as a tube with a lit near edge. */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="url(#wl-ring)"
          strokeWidth="16"
        />
        <path
          d="M78 78A40 40 0 0 0 78 22"
          fill="none"
          stroke="#a86c00"
          strokeWidth="16"
          strokeLinecap="round"
          opacity="0.4"
        />
        {/* Tight specular dot where the light lands on the near edge. */}
        <ellipse
          cx="30"
          cy="28"
          rx="7"
          ry="4.5"
          fill="#ffffff"
          opacity="0.7"
          transform="rotate(-45 30 28)"
        />
      </svg>
    </span>
  );
}
