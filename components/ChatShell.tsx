import { useEffect } from "react";
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
 *
 * While the mobile shell is up, the page behind it is scroll-locked and the
 * shell's header is opaque — without both, the underlying content scrolls and
 * shimmers through a translucent header, which reads as one conversation
 * bleeding into another.
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
  // Scroll-lock the page behind the mobile full-screen shell only. Desktop's
  // shell is an in-page panel and the page around it must stay scrollable, so
  // the lock is scoped to the sub-md breakpoint and re-checked on resize
  // (rotation between the two layouts must not leave the body stuck).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");

    // Captured BEFORE any lock is applied, so removal restores what the page
    // actually had — usually "", but another overlay's lock must survive us.
    const previous = document.body.style.overflow;

    // Applied per the CURRENT match, not only on change events: a shell
    // mounted at desktop width must still lock when the window later narrows
    // into the mobile layout. (This effect once returned early when
    // !mq.matches — before registering the listener — so a desktop-mounted
    // shell never locked at all, and the page scrolled behind the
    // full-screen conversation.)
    const setLock = (mobile: boolean): void => {
      document.body.style.overflow = mobile ? "hidden" : previous;
    };
    const onMq = (e: MediaQueryListEvent): void => setLock(e.matches);

    setLock(mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      mq.removeEventListener("change", onMq);
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <section
      aria-label={title}
      // On mobile the shell owns the viewport (fixed inset-0), so it must be
      // OPAQUE — the .surface class is translucent glass designed for desktop
      // in-page panels, and through it the underlying section content bleeds
      // through as a ghost "Page A under Page B" underlay. bg-canvas (solid
      // white) on mobile, the glass .surface on desktop where the shell is a
      // floating card and translucency is the point.
      className={`flex flex-col overflow-hidden fixed inset-x-0 bottom-0 top-0 z-20 rounded-none border-0 bg-canvas pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:relative md:inset-auto md:z-auto md:h-[34rem] md:max-h-[78vh] md:rounded-2xl md:border md:bg-transparent md:pb-0 md:shadow-[0_24px_48px_rgb(16_2_111/0.08)] ${className}`}
    >
      <header className="flex items-center gap-2 border-b border-line bg-canvas px-3 py-2.5 md:bg-transparent md:px-5 md:py-4">
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
