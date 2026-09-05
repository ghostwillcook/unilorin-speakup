import { useEffect } from "react";

/**
 * Landing micro-interactions — the cursor-tracked effects the premium pass
 * adds. One mount wires every [data-spotlight] card, [data-magnetic] button,
 * and [data-tilt-scene] diorama on the page with per-element listeners (the
 * landing page's content is static, so elements never appear or disappear
 * after hydration and per-element wiring stays correct without delegation
 * bookkeeping).
 *
 * All effects only set CSS custom properties (--mx / --my, --wl-rx / --wl-ry
 * / --wl-ts); the visual result lives in globals.css (.wl-spotlight's border
 * ring, .wl-magnetic's translate, .wl-tilt's perspective rotation), so
 * nothing here touches layout and the compositor does all the work.
 *
 * prefers-reduced-motion: no listeners at all — the CSS keeps its static
 * fallbacks, and the tracking properties simply stay unset.
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

    // Scene tilt: every [data-tilt] object inside a [data-tilt-scene] leans
    // toward the cursor and grows slightly when it gets close. One listener
    // on the scene container (not the shapes — they stay pointer-events:
    // none so decoration can never swallow a click). The CSS eases the
    // continuously-updated values over 0.6s, which is the fluid lag the
    // clay objects should have. Rotation is capped at 10 degrees: past
    // that a flat SVG's foreshortening starts reading as a skew.
    const MAX_DEG = 10;
    for (const scene of Array.from(
      document.querySelectorAll<HTMLElement>("[data-tilt-scene]"),
    )) {
      const shapes = Array.from(
        scene.querySelectorAll<HTMLElement>("[data-tilt]"),
      );
      if (shapes.length === 0) continue;

      const reset = () => {
        for (const el of shapes) {
          el.style.setProperty("--wl-rx", "0deg");
          el.style.setProperty("--wl-ry", "0deg");
          el.style.setProperty("--wl-ts", "1");
        }
      };
      const onMove = (e: MouseEvent) => {
        const s = scene.getBoundingClientRect();
        for (const el of shapes) {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          // Cursor position relative to the scene, -1..1 on each axis.
          const nx = (e.clientX - (s.left + s.width / 2)) / (s.width / 2);
          const ny = (e.clientY - (s.top + s.height / 2)) / (s.height / 2);
          el.style.setProperty("--wl-rx", `${(nx * MAX_DEG).toFixed(2)}deg`);
          el.style.setProperty("--wl-ry", `${(-ny * MAX_DEG).toFixed(2)}deg`);
          // Proximity scale: 1.1 when the cursor is on the shape's center,
          // falling off to 1 across ~1.5x its own radius.
          const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
          const reach = Math.max(r.width, r.height) * 0.75;
          const prox = Math.max(0, 1 - dist / (reach * 2));
          el.style.setProperty("--wl-ts", `${(1 + prox * 0.12).toFixed(3)}`);
        }
      };
      scene.addEventListener("mousemove", onMove);
      scene.addEventListener("mouseleave", reset);
      cleanups.push(() => {
        scene.removeEventListener("mousemove", onMove);
        scene.removeEventListener("mouseleave", reset);
      });
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  return null;
}
