import type { ReactNode } from "react";

/**
 * The shared panel surface. Everything that needs a panel uses this rather
 * than re-declaring the border and shadow, which is what keeps the treatment
 * identical across student and admin areas.
 */
export default function GlassCard({
  children,
  className = "",
  hover = false,
  id,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** Present so a card can be an in-page anchor target. */
  id?: string;
  as?: "div" | "section" | "article" | "aside" | "li";
}) {
  return (
    <Tag id={id} className={`surface ${hover ? "surface-hover" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

/** Section heading with an optional trailing slot. */
export function PanelHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="heading text-lg">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-graphite/55">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

/** Consistent empty state so every list reads the same when it has no rows. */
export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-sm font-medium text-graphite/70">{title}</p>
      {hint && <p className="mt-1 text-xs text-graphite/40">{hint}</p>}
    </div>
  );
}
