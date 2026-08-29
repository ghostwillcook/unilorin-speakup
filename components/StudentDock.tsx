import { useState } from "react";
import type { SessionUser } from "@/lib/guards";

/**
 * The mobile bottom navigation bar — the flat monochrome half of the
 * auth/mobile design spec.
 *
 * A white bar fixed flush to the bottom edge (no radius, no shadow), with
 * each destination as an icon-above-label column. Wayfinding is carried
 * entirely by weight and colour: the active destination is a solid black
 * fill with a bold near-black label, inactive ones are light-grey outlines
 * with regular labels. All of that is CSS — driven by `aria-current="page"`
 * and `currentColor` inheritance — so the component only decides which
 * icon variant to draw.
 *
 * This replaced the old sliding-highlight dock (a violet pill with a white
 * circle that travelled behind the active icon): that absolutely-positioned
 * circle clipped the icons and labels it passed under, and its percentage
 * maths misbehaved at narrow widths. The flat design has no overlapping
 * elements to misalign.
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
  /** Same keys as the desktop tab bar, so the two stay in lockstep. The icon
      union mirrors the dock's own DockIcon kinds — "room" is the crowd, not
      the envelope, so the Anonymous Room never reads as Direct Messages. */
  tabs: ReadonlyArray<{
    key: string;
    label: string;
    icon: "chat" | "dm" | "complaint" | "room";
  }>;
  active: string;
  onChange: (key: string) => void;
  user: SessionUser;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

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

          {/* Every section, because the dock bar itself only carries three —
              Lodge Complaint lives here (and in My Complaints' own button). */}
          <div className="mt-4 space-y-1 border-t border-[var(--wl-rule)] pt-3">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onChange(t.key);
                }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--wl-slate)] transition-colors hover:bg-[rgb(16_2_111/0.05)] hover:text-[var(--wl-ink)]"
                aria-current={t.key === active ? "page" : undefined}
              >
                {t.label}
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
            ))}
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

      <nav className="wl-dock" aria-label="Dashboard sections">
        {/* The bar carries the first three sections; the fourth slot is always
            Menu. Everything is still reachable through the sheet above. */}
        {tabs.slice(0, 3).map((t) => (
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
            <DockIcon kind={t.icon} active={t.key === active && !menuOpen} />
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
          <DockIcon kind="menu" active={menuOpen} />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}

/* One icon set drawn at dock scale — 22px. Two variants per icon, because the
   flat spec marks the active destination by silhouette weight rather than
   position: active = a solid filled shape (a heavy near-black silhouette,
   drawn with fill="currentColor" and no stroke), inactive = the same shape
   as a soft rounded outline (stroke="currentColor", 1.7 weight, round caps
   and joins). Interiors are knocked out in white on the filled variants —
   the bar's own colour — so details like the envelope flap stay legible
   against the solid fill. */
function DockIcon({
  kind,
  active,
}: {
  kind: "chat" | "dm" | "complaint" | "room" | "menu";
  active: boolean;
}) {
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
    // The bubble's tail curls left; three dots carry the "conversation" read.
    const bubble =
      "M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4c-.5.4-1.3 0-1.3-.6V6.5Z";
    return (
      <svg {...common}>
        {active ? (
          <>
            <path d={bubble} fill="currentColor" />
            {/* Dots knocked out of the solid bubble in the bar's white. */}
            <circle cx="8.5" cy="10.25" r="1.05" fill="#ffffff" />
            <circle cx="12" cy="10.25" r="1.05" fill="#ffffff" />
            <circle cx="15.5" cy="10.25" r="1.05" fill="#ffffff" />
          </>
        ) : (
          <>
            <path d={bubble} {...stroke} />
            <circle cx="8.5" cy="10.25" r="1.05" fill="currentColor" />
            <circle cx="12" cy="10.25" r="1.05" fill="currentColor" />
            <circle cx="15.5" cy="10.25" r="1.05" fill="currentColor" />
          </>
        )}
      </svg>
    );
  }
  if (kind === "dm") {
    return active ? (
      <svg {...common}>
        {/* Solid envelope; the flap is redrawn as a white stroke on top so
            the shape still reads as an envelope and not a plain slab. */}
        <rect x="3.5" y="5.5" width="17" height="11" rx="3" fill="currentColor" />
        <path
          d="m4.5 7 7.5 5 7.5-5"
          fill="none"
          stroke="#ffffff"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg {...common}>
        <rect x="3.5" y="5.5" width="17" height="11" rx="3" {...stroke} />
        <path d="m4.5 7 7.5 5 7.5-5" {...stroke} />
      </svg>
    );
  }
  if (kind === "complaint") {
    return active ? (
      <svg {...common}>
        {/* Solid triangle with the exclamation knocked out in white. */}
        <path d="M12 4.5 21 19.5H3L12 4.5Z" fill="currentColor" />
        <path d="M12 10v4" stroke="#ffffff" strokeWidth={1.7} strokeLinecap="round" fill="none" />
        <circle cx="12" cy="16.8" r="0.9" fill="#ffffff" />
      </svg>
    ) : (
      <svg {...common}>
        <path d="M12 4.5 21 19.5H3L12 4.5Z" {...stroke} />
        <path d="M12 10v4" {...stroke} />
        <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "room") {
    // A crowd — the Anonymous Room is students among students. The paths
    // mirror the side rail's crowd icon in pages/student/index.tsx: two
    // figures (head circle + shoulder arc) and a partial third. Active is a
    // plain solid fill of those same shapes — unlike the envelope or the
    // triangle there is no interior detail to knock out in white.
    return (
      <svg {...common}>
        <circle
          cx="9"
          cy="8"
          r="3.2"
          {...(active ? { fill: "currentColor" } : stroke)}
        />
        <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" {...(active ? { fill: "currentColor" } : stroke)} />
        <path d="M15.5 5.6a3 3 0 0 1 0 5.8" {...(active ? { fill: "currentColor" } : stroke)} />
        <path d="M17.4 14.3a5.5 5.5 0 0 1 3.1 4.7" {...(active ? { fill: "currentColor" } : stroke)} />
      </svg>
    );
  }
  // Menu: three dots (an ellipsis) — outlined when inactive, solid when the
  // sheet is open, so the slot reads as pressed while its card is up.
  return (
    <svg {...common}>
      <circle cx="5" cy="12" r="1.6" {...(active ? { fill: "currentColor" } : stroke)} />
      <circle cx="12" cy="12" r="1.6" {...(active ? { fill: "currentColor" } : stroke)} />
      <circle cx="19" cy="12" r="1.6" {...(active ? { fill: "currentColor" } : stroke)} />
    </svg>
  );
}
