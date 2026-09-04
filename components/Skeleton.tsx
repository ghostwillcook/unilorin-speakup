/**
 * Loading placeholders for the consoles' data lists.
 *
 * Every one of these replaces a "Loading…" EmptyState, so the placeholder is
 * shaped like the real rows it stands in for (same paddings, roughly the same
 * heights) — when the data lands, the swap is a fill-in rather than a layout
 * jump. That is why the shapes are composed inline at each call site instead
 * of a one-size "list row" variant here: the three lists have genuinely
 * different geometries.
 *
 * The blocks are `animate-pulse` (a Tailwind core keyframe utility, so no
 * custom animation needs to be declared). globals.css' existing
 * prefers-reduced-motion block stops the pulse there: the shimmer is
 * decoration, and a static gray block carries the same "not ready" meaning.
 */

import type { ReactNode } from "react";

/** The atomic gray block. Size and rounding come from className. */
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sunken ${className}`} />;
}

/**
 * A pulse placeholder for a single line of text. The height (h-3.5/h-4) and
 * rounding approximate one rendered line of body/small text; width is passed
 * in so callers can mirror each real row's proportions.
 */
export function SkeletonLine({
  className = "",
  width,
}: {
  className?: string;
  /** Tailwind width utility (e.g. "w-3/5"); defaults to a full line. */
  width?: string;
}) {
  return <Skeleton className={`h-3.5 ${width ?? "w-full"} ${className}`} />;
}

/**
 * Wrapper for a whole list of skeleton rows. `aria-busy` plus a visually
 * hidden label lets screen readers announce the wait once, instead of
 * exposing four near-identical rows of empty blocks.
 */
export function SkeletonList({
  label,
  children,
  className = "",
}: {
  /** Announced to assistive tech, replacing the old "Loading…" text. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
