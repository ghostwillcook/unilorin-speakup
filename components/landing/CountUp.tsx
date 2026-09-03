import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion } from "@/lib/useInView";

/**
 * Counts from zero to `value` when scrolled into view, over 1.5s, per the
 * Wollo motion spec.
 *
 * The animation is eased (ease-out cubic) so the number decelerates into its
 * final value rather than ticking linearly, and the element renders the
 * target immediately — before hydration and for reduced-motion users — so
 * the figure is never missing from the page, only briefly smaller.
 */
export default function CountUp({
  value,
  duration = 1500,
  suffix = "",
  prefix = "",
  className = "",
}: {
  value: number;
  /** Milliseconds. 1500 matches the spec. */
  duration?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const reduced = usePrefersReducedMotion();
  // Seeded with the target, not 0: the server render (and any no-JS client)
  // shows the real figure. The count-up effect still runs on first in-view —
  // it starts by setting display to ~0 on its first animation frame, so
  // hydration flashes the real number and then the animation takes over.
  const [display, setDisplay] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;

    // Reduced motion: land on the value at once. Still wait for inView so the
    // swap reads as intentional rather than as a flash of the wrong number.
    if (reduced) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      // ease-out cubic: fast off the line, gentle into the final value.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
