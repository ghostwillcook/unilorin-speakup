import type { ReactNode } from "react";

/**
 * The shared chat surface: a familiar messaging-app frame — header, scrolling
 * message area, docked composer — that uses the space it is given.
 *
 * On desktop this is the normal in-page panel (34rem, capped at 78vh, rounded,
 * bordered). On mobile it owns the viewport instead of shrinking into it: the
 * shell goes fixed full-screen with its own back button, and the composer pads
 * its bottom by the navigation dock's height so nothing sits under the dock.
 * That is the messaging spec's mobile requirement (§45-47): the conversation
 * occupies the available screen — no tiny floating panels.
 */
export default function ChatShell({
  title,
  subtitle,
  badge,
  onBack,
  onDismiss,
  children,
  composer,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  /** Right-side status pill or identity chip. */
  badge?: ReactNode;
  /** Mobile-only back button — shown below md, when the shell is full-screen. */
  onBack?: () => void;
  /** Optional close control for the whole view (full-screen threads). */
  onDismiss?: () => void;
  /** The scrollable message list. Manages its own scrolling. */
  children: ReactNode;
  /** The composer bar; docked to the bottom of the shell. */
  composer: ReactNode;
  /** Optional strip between list and composer (notices, errors). */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={`surface flex flex-col overflow-hidden fixed inset-x-0 bottom-0 top-0 z-20 rounded-none border-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:relative md:inset-auto md:z-auto md:h-[34rem] md:max-h-[78vh] md:rounded-2xl md:border md:pb-0 ${className}`}
    >
      <header className="flex items-center gap-2 border-b border-line bg-canvas/85 px-3 py-2.5 backdrop-blur-md md:bg-transparent md:px-5 md:py-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="btn-icon -ml-1 h-9 w-9 shrink-0 rounded-full md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-graphite md:text-lg">
            {title}
          </h2>
          {subtitle && (
            <p className="truncate text-xs text-muted md:text-sm">{subtitle}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">{badge}</div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="btn-icon h-9 w-9 shrink-0 rounded-full"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {children}
        {footer}
        {composer}
      </div>
    </section>
  );
}
