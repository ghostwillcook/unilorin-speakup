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
 * The hero diorama's matte 3D objects. Each is an SVG with soft gradient fills
 * (the "clay" look) wrapped in .wl-shape, whose ::after lays the grain that
 * keeps them from reading as glossy plastic. Sizes and tilts are set per
 * instance; nothing here is interactive — the shapes are aria-hidden
 * decoration for a headline that carries its own meaning.
 */
export function SpeechBubbleShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 120 110">
        <defs>
          <linearGradient id="wl-bubble" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#d8ccff" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <path
          d="M60 6c29 0 52 18 52 42S89 90 60 90c-5 0-10-.5-14.6-1.4L24 104l6.8-17.6C17.4 79.2 8 64.9 8 48 8 24 31 6 60 6Z"
          fill="url(#wl-bubble)"
        />
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
          <linearGradient id="wl-mega" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4ac0b" />
            <stop offset="1" stopColor="#dc7c1d" />
          </linearGradient>
          <linearGradient id="wl-mega2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ac2ebc" />
            <stop offset="1" stopColor="#7d1f8c" />
          </linearGradient>
        </defs>
        <path
          d="M14 42h14l36-26v78L28 68H14a8 8 0 0 1-8-8V50a8 8 0 0 1 8-8Z"
          fill="url(#wl-mega)"
          transform="rotate(-18 60 55)"
        />
        <rect
          x="84"
          y="34"
          width="26"
          height="12"
          rx="6"
          fill="url(#wl-mega2)"
          transform="rotate(-18 60 55)"
        />
        <rect
          x="86"
          y="58"
          width="20"
          height="10"
          rx="5"
          fill="url(#wl-mega2)"
          transform="rotate(-18 60 55)"
        />
      </svg>
    </span>
  );
}

export function HeartShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 100 92">
        <defs>
          <linearGradient id="wl-heart" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5b7f" />
            <stop offset="1" stopColor="#dc1d49" />
          </linearGradient>
        </defs>
        <path
          d="M50 86S6 60 6 32.7C6 17 18.8 6 32.5 6 41 6 47.3 10.4 50 15.8 52.7 10.4 59 6 67.5 6 81.2 6 94 17 94 32.7 94 60 50 86 50 86Z"
          fill="url(#wl-heart)"
        />
      </svg>
    </span>
  );
}

export function ShieldShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 92 104">
        <defs>
          <linearGradient id="wl-shield" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8fd0ff" />
            <stop offset="1" stopColor="#4a7dff" />
          </linearGradient>
        </defs>
        <path
          d="M46 4 82 16v32c0 26-15.6 44.4-36 52C25.6 92.4 10 74 10 48V16L46 4Z"
          fill="url(#wl-shield)"
        />
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
          <radialGradient id="wl-sphere" cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#e9deff" />
            <stop offset="0.55" stopColor="#ac2ebc" />
            <stop offset="1" stopColor="#5c1466" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="url(#wl-sphere)" />
      </svg>
    </span>
  );
}

export function RingShape({ className = "" }: { className?: string }) {
  return (
    <span className={`wl-shape ${className}`} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="wl-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd166" />
            <stop offset="1" stopColor="#f4ac0b" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="url(#wl-ring)"
          strokeWidth="16"
        />
      </svg>
    </span>
  );
}
