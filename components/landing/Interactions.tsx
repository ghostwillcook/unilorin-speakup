import { useEffect } from "react";

/**
 * Landing micro-interactions — the cursor-tracked effects the premium pass
 * adds. One mount wires every [data-spotlight] card and [data-magnetic]
 * button on the page with per-element listeners (the landing page's content
 * is static, so elements never appear or disappear after hydration and
 * per-element wiring stays correct without delegation bookkeeping).
 *
 * Both effects only set CSS custom properties (--mx / --my); the visual
 * result lives in globals.css (.wl-spotlight's border ring, .wl-magnetic's
 * translate), so nothing here touches layout and the compositor does all
 * the work.
 *
 * prefers-reduced-motion: no listeners at all — the CSS keeps its static
 * fallbacks, and the magnetic/spotlight properties simply stay unset.
 */
export default function LandingInteractions() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const cleanups: Array<() => void> = [];

    // Spotlight: cards light their border where the cursor is. One listener
    // per card; the ring itself is pure CSS.
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("[data-spotlight]"),
    )) {
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      };
      el.addEventListener("mousemove", onMove);
      cleanups.push(() => el.removeEventListener("mousemove", onMove));
    }

    // Magnetic: the CTA drifts a quarter of the way toward the cursor and
    // springs back on leave. Strength 0.25 — past that the button starts
    // feeling like it is escaping the click.
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("[data-magnetic]"),
    )) {
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty(
          "--mx",
          `${(e.clientX - (r.left + r.width / 2)) * 0.25}px`,
        );
        el.style.setProperty(
          "--my",
          `${(e.clientY - (r.top + r.height / 2)) * 0.25}px`,
        );
      };
      const onLeave = () => {
        el.style.setProperty("--mx", "0px");
        el.style.setProperty("--my", "0px");
      };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
      });
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  return null;
}
