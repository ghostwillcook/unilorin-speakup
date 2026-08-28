import { useEffect, useState } from "react";
import type { SessionUser } from "@/lib/guards";

/**
 * The floating bottom navigation dock — the mobile half of the auth/mobile
 * design spec.
 *
 * A 64px violet pill suspended 16px above the screen edge, with a 44px white
 * circular highlight that slides behind the active icon on a spring curve
 * (the spec's stiffness 350 / damping 25, approximated by an overshooting
 * cubic-bezier in CSS — there is no motion library in this app).
 *
 * The fourth slot is Menu rather than a destination: it opens the account
 * sheet (name, student ID, sign out), which is what a phone user loses when
 * the desktop tab bar and header controls are hidden at this width.
 *
 * Desktop never sees this component — the caller renders it inside a
 * md:hidden wrapper.
 */
export default function StudentDock({
  tabs,
  active,
  onChange,
  user,
  onSignOut,
}: {
  /** Same keys as the desktop tab bar, so the two stay in lockstep. */
  tabs: ReadonlyArray<{ key: string; label: string; icon: "chat" | "dm" | "complaint" }>;
  active: string;
  onChange: (key: string) => void;
  user: SessionUser;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Scroll elevation: once content passes underneath, the dock's shadow
  // deepens (the spec's 24px -> 36px blur growth, as two states).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Slot count including Menu, for the highlight's percentage position.
  const slots = tabs.length + 1;
  const activeIndex = tabs.findIndex((t) => t.key === active);
  // The highlight tracks the active tab; when Menu is open it slides to Menu.
  const highlightIndex = menuOpen ? tabs.length : activeIndex;

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const initials = firstName.charAt(0).toUpperCase() + (user.name.trim().split(/\s+/).slice(-1)[0]?.charAt(0).toUpperCase() ?? "");

  return (
    <>
      {menuOpen && (
        <div
          className="wl-sheet"
          role="dialog"
          aria-label="Account menu"
        >
          <div className="flex items-center gap-3">
            <span className="wl-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--wl-ink)]">{user.name}</p>
              <p className="font-mono text-xs text-[var(--wl-slate)]">{user.studentId}</p>
            </div>
          </div>
          <button
            type="button"
            className="wl-auth-submit mt-4"
            style={{ height: 44 }}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      )}

      <nav className={`wl-dock ${scrolled ? "wl-dock-scrolled" : ""}`} aria-label="Dashboard sections">
        {/* The highlight is positioned by percentage of dock width so it never
            needs measurement: each slot is an equal flex fraction, so slot i's
            centre is (i + 0.5) / slots of the width. */}
        {highlightIndex >= 0 && (
          <span
            className="wl-dock-highlight"
            style={{ left: `${((highlightIndex + 0.5) / slots) * 100}%` }}
            aria-hidden="true"
          />
        )}

        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className="wl-dock-item"
            aria-current={t.key === active && !menuOpen ? "page" : undefined}
            onClick={() => {
              setMenuOpen(false);
              onChange(t.key);
            }}
          >
            <DockIcon kind={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}

        <button
          type="button"
          className="wl-dock-item"
          aria-current={menuOpen ? "page" : undefined}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <DockIcon kind="menu" />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}

/* One icon set drawn at dock scale — 22px strokes at 1.7 weight, matching the
   outline-icon weight the spec asks for on inactive tabs. */
function DockIcon({ kind }: { kind: "chat" | "dm" | "complaint" | "menu" }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    "aria-hidden": true as const,
  };
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (kind === "chat") {
    return (
      <svg {...common}>
        <path
          d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4c-.5.4-1.3 0-1.3-.6V6.5Z"
          {...stroke}
        />
      </svg>
    );
  }
  if (kind === "dm") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5.5" width="17" height="11" rx="3" {...stroke} />
        <path d="m4.5 7 7.5 5 7.5-5" {...stroke} />
      </svg>
    );
  }
  if (kind === "complaint") {
    return (
      <svg {...common}>
        <path
          d="M12 4.5 21 19.5H3L12 4.5Z"
          {...stroke}
        />
        <path d="M12 10v4" {...stroke} />
        <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 7h16M4 12h16M4 17h10" {...stroke} />
    </svg>
  );
}
