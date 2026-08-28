import { useEffect, useState } from "react";

/**
 * The mobile header fold-away, shared by every sticky/fixed bar in the app
 * (landing, student console, admin console).
 *
 * Scrolling down past `threshold` hides the bar; scrolling up reveals it; an
 * open drawer/menu (`pinned`) keeps it visible. The `breakpoint` is a media
 * query string because the consoles change layout at different widths: the
 * admin bar exists only below lg, the others below md.
 *
 * Returns `true` when the bar should be hidden — the caller applies the
 * transform, since only it knows whether the bar is sticky or fixed and what
 * class vocabulary its surface uses.
 */
export function useHeaderFold({
  breakpoint = "(max-width: 767px)",
  pinned = false,
  threshold = 64,
  jitter = 8,
}: {
  breakpoint?: string;
  /** True while a drawer or menu must keep the bar on screen. */
  pinned?: boolean;
  /** Scroll depth before folding engages, so the top of the page never hides. */
  threshold?: number;
  /** Dead-zone in px against rubber-banding and sub-pixel scroll events. */
  jitter?: number;
} = {}): boolean {
  const [withinBreakpoint, setWithinBreakpoint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(breakpoint);
    setWithinBreakpoint(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setWithinBreakpoint(e.matches);
    mq.addEventListener("change", onMq);

    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) < jitter) return;
      setHidden(y > lastY && y > threshold);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("scroll", onScroll);
    };
  }, [breakpoint, jitter, threshold]);

  return withinBreakpoint && hidden && !pinned;
}
