import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { useInView, usePrefersReducedMotion } from "@/lib/useInView";

/* ------------------------------------------------------------------------- */
/* Reveal — slide up and fade in when scrolled into view                      */
/* ------------------------------------------------------------------------- */

type RevealDirection = "up" | "left" | "right";

/**
 * Wraps content in a scroll-triggered reveal. The transform lives in CSS (see
 * .reveal in globals.css) so the animation runs on the compositor rather than
 * re-rendering React on scroll.
 */
export function Reveal({
  children,
  delay = 0,
  direction = "up",
  className = "",
}: {
  children: ReactNode;
  /** Milliseconds. Use with a stagger to assemble a row in sequence. */
  delay?: number;
  direction?: RevealDirection;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`reveal reveal-${direction} ${inView ? "reveal-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * Reveals each child in turn, `step` ms apart. Children assemble in sequence
 * instead of snapping in as one block.
 */
export function Stagger({
  children,
  step = 80,
  className = "",
  direction = "up",
}: {
  children: ReactNode;
  step?: number;
  className?: string;
  direction?: RevealDirection;
}) {
  const items = Children.toArray(children).filter(isValidElement);

  return (
    <div className={className}>
      {items.map((child, i) => (
        <Reveal key={(child as ReactElement).key ?? i} delay={i * step} direction={direction}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* SplitLines — per-line reveal for oversized display headings                */
/* ------------------------------------------------------------------------- */

/**
 * Reveals a heading one authored line at a time. Pass the lines explicitly
 * rather than splitting on width: the source site hard-codes its line breaks,
 * and guessing from measurement causes reflow jitter.
 *
 * Each line is clipped by an overflow-hidden wrapper so the text rises out of
 * nothing instead of fading in place.
 */
export function SplitLines({
  lines,
  step = 120,
  className = "",
}: {
  lines: string[];
  step?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();

  return (
    <span ref={ref} className={`block ${className}`}>
      {lines.map((line, i) => (
        <span key={line + i} className="line-clip">
          <span
            className={`line-inner ${inView ? "line-in" : ""}`}
            style={{ transitionDelay: `${i * step}ms` }}
          >
            {line}
          </span>
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* WordLines — per-word reveal for oversized display headings                  */
/* ------------------------------------------------------------------------- */

/**
 * Reveals a heading word by word, in one continuous stagger that runs across
 * line boundaries — word 1 of line 2 fires after the last word of line 1, so
 * a multi-line headline assembles as a single sequence instead of restarting
 * per row.
 *
 * Layout transparency is the whole trick: a word is already the unit that
 * text wraps on, so wrapping each word in an inline-block clip (see
 * .word-clip in globals.css) changes nothing about how the line breaks. The
 * inter-word space is rendered as a text node BETWEEN the clips — a space
 * inside an overflow-hidden inline-block collapses to nothing, while a text
 * node between them is the browser's own inter-word spacing.
 *
 * Each entry of `lines` may be a plain string or a list of React nodes; the
 * nodes let one word carry extra styling (the .wl-accent serif word) without
 * breaking it out of the word sequence.
 */
export function WordLines({
  lines,
  step = 100,
  className = "",
}: {
  lines: (string | ReactNode[])[];
  step?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>();

  // Each authored line stays its own block, so hard-coded line breaks keep
  // working exactly as they did with SplitLines.
  const parsed = lines.map((line) =>
    typeof line === "string" ? line.split(/\s+/).filter(Boolean) : line,
  );

  // Prefix sums give each word a sequence index that keeps counting across
  // lines — the delay math below is what makes the stagger continuous.
  const starts: number[] = [];
  let total = 0;
  for (const line of parsed) {
    starts.push(total);
    total += line.length;
  }

  return (
    <span ref={ref} className={`block ${className}`}>
      {parsed.map((lineWords, lineIndex) => {
        const start = starts[lineIndex];
        return (
          <span key={lineIndex} className="block">
            {lineWords.map((word, wordIndex) => (
              <Fragment key={`${lineIndex}-${wordIndex}`}>
                {wordIndex > 0 ? " " : null}
                <span className="line-clip word-clip">
                  <span
                    className={`line-inner ${inView ? "line-in" : ""}`}
                    style={{ transitionDelay: `${(start + wordIndex) * step}ms` }}
                  >
                    {word}
                  </span>
                </span>
              </Fragment>
            ))}
          </span>
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* RotatingWord — fixed prefix, cycling suffix                                */
/* ------------------------------------------------------------------------- */

/**
 * Cycles a single word in place. Width is reserved by the longest entry so the
 * surrounding text does not shuffle sideways on every swap.
 */
export function RotatingWord({
  words,
  interval = 2200,
  className = "",
}: {
  words: string[];
  interval?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced || words.length < 2) return;

    const cycle = window.setInterval(() => {
      setLeaving(true);
      // Half-beat later, swap the text and let the new word slide in.
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setLeaving(false);
      }, 280);
    }, interval);

    return () => window.clearInterval(cycle);
  }, [interval, words.length, reduced]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span className={`rotator ${className}`}>
      {/* Reserves the width of the longest word without being visible or read
          aloud, so layout never shifts mid-cycle. */}
      <span className="rotator-ghost" aria-hidden="true">
        {longest}
      </span>
      <span className={`rotator-word ${leaving ? "rotator-out" : "rotator-in"}`}>
        {words[index]}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* Marquee — seamless infinite horizontal ticker                              */
/* ------------------------------------------------------------------------- */

/**
 * Infinite horizontal scroll. The track is rendered twice and translated by
 * exactly -50%, which is what makes the loop seamless — at the end of the
 * animation the second copy sits precisely where the first began.
 */
export function Marquee({
  items,
  seconds = 24,
  reverse = false,
  className = "",
  separator = "•",
}: {
  items: string[];
  seconds?: number;
  reverse?: boolean;
  className?: string;
  separator?: string;
}) {
  const reduced = usePrefersReducedMotion();

  const track = (
    <div className="marquee-group" aria-hidden={undefined}>
      {items.map((item, i) => (
        <span key={item + i} className="marquee-item">
          {item}
          <span className="marquee-sep" aria-hidden="true">
            {separator}
          </span>
        </span>
      ))}
    </div>
  );

  // Reduced motion: render one static row rather than a frozen doubled track.
  if (reduced) {
    return <div className={`marquee ${className}`}>{track}</div>;
  }

  const style: CSSProperties = {
    animationDuration: `${seconds}s`,
    animationDirection: reverse ? "reverse" : "normal",
  };

  return (
    <div className={`marquee ${className}`}>
      <div className="marquee-track" style={style}>
        {track}
        {/* Duplicate is decorative — hidden from assistive tech so the list is
            not announced twice. */}
        <div aria-hidden="true" className="contents">
          {track}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* HoverSwap — two stacked text layers trading places                         */
/* ------------------------------------------------------------------------- */

export function HoverSwapLabel({ children }: { children: string }) {
  return (
    <span className="swap">
      <span className="swap-a">{children}</span>
      {/* The incoming copy is decorative: the accessible name comes from the
          first layer, so it must not be read a second time. */}
      <span className="swap-b" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------- */
/* SlideSwitch — horizontal slide between panels (dashboard tabs)             */
/* ------------------------------------------------------------------------- */

/**
 * Slides between panels on key change. Direction is derived from whether the
 * new index is ahead of or behind the old one, so moving left feels like
 * moving left.
 */
export function SlideSwitch({
  activeKey,
  index,
  children,
  className = "",
}: {
  activeKey: string;
  index: number;
  children: ReactNode;
  className?: string;
}) {
  const [shown, setShown] = useState({ key: activeKey, index, node: children });
  const [phase, setPhase] = useState<"idle" | "in">("idle");
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (activeKey === shown.key) {
      // Same panel, new content (e.g. a refetch) — swap without animating.
      setShown((s) => ({ ...s, node: children }));
      return;
    }
    setShown({ key: activeKey, index, node: children });
    if (reduced) return;

    setPhase("idle");
    const raf = window.requestAnimationFrame(() => setPhase("in"));
    return () => window.cancelAnimationFrame(raf);
  }, [activeKey, index, children, shown.key, reduced]);

  const fromRight = index >= shown.index;

  return (
    <div className={`slide-viewport ${className}`}>
      <div
        key={shown.key}
        className={`slide-panel ${
          reduced ? "slide-static" : phase === "in" ? "slide-in" : fromRight ? "slide-from-right" : "slide-from-left"
        }`}
      >
        {shown.node}
      </div>
    </div>
  );
}

/** Escape hatch for one-off elements needing the reveal classes directly. */
export function revealProps(inView: boolean, delay = 0) {
  return {
    className: `reveal reveal-up ${inView ? "reveal-in" : ""}`,
    style: { transitionDelay: `${delay}ms` } as CSSProperties,
  };
}
