import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Scroll-reveal primitive.
 *
 * One IntersectionObserver per element, disconnected as soon as it has fired
 * when `once` is set — cheaper than a shared observer with a registry, and it
 * means a long admin list does not keep dozens of live observers alive.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.15,
  rootMargin = "0px 0px -8% 0px",
  once = true,
}: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
} = {}): { ref: RefObject<T>; inView: boolean } {
  // The useRef<T>(null) overload yields RefObject<T>, which is what a DOM ref
  // prop accepts — useRef<T | null>(null) gives RefObject<T | null> and will
  // not assign to it.
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No IntersectionObserver (or a reduced-motion preference) means content
    // must still be visible — never gate content on an effect that may not run.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    ) {
      setInView(true);
      return;
    }

    // The observer callback fires before the browser has painted the initial
    // (pre-reveal) state for anything already in the viewport — the entire
    // first screen on a large monitor. React then applies the revealed class
    // in the same paint, the transition has no start state to animate from,
    // and the element simply appears: animations work on phones (where content
    // is below the fold and reveals on scroll) but not on desktop. Scheduling
    // the state change two frames out forces the initial state to paint first,
    // so the transition runs. Same rAF is cancelled if the element unmounts.
    let raf = 0;
    const commit = (visible: boolean) => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setInView(visible);
        });
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            commit(true);
            if (once) observer.disconnect();
          } else if (!once) {
            commit(false);
          }
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(node);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [threshold, rootMargin, once]);

  return { ref, inView };
}

/**
 * True when the visitor has asked for reduced motion. Read once on mount and
 * kept live, so a mid-session OS change is honoured.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
