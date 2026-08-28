import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";

/**
 * The admin console's floating bottom dock — the mobile-admin counterpart to
 * StudentDock, per the same design spec: a 64px violet pill suspended 16px
 * above the screen edge with a 44px white circular highlight that slides
 * behind the active icon on a spring curve (the CSS classes carry all of
 * that; there is no motion library in this app).
 *
 * The crucial difference from StudentDock: this dock navigates routes, it
 * does not switch tabs. The first three slots are Links (Dashboard,
 * Complaints, Messages) and the active state is read from the router rather
 * than props — which means the route can be somewhere the dock cannot
 * represent (e.g. /admin/users). In that case no slot is active and the
 * highlight is not rendered at all; those destinations live in the Menu
 * sheet instead, which is what a phone admin loses when the sidebar collapses
 * to an off-canvas drawer below lg.
 *
 * Desktop never sees this component — the caller renders it inside a
 * lg:hidden-style wrapper, mirroring how StudentDock is mounted.
 */

type IconKind = "dashboard" | "complaints" | "messages" | "chat-logs" | "users" | "settings" | "menu";

interface NavItem {
  href: string;
  label: string;
  icon: IconKind;
  /**
   * When true the entry only highlights on an exact pathname match. Required
   * for /admin: a prefix test would light up Dashboard on every admin
   * sub-route.
   */
  exact?: boolean;
}

/** Every admin destination, in sidebar order — the sheet lists all six. */
const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", exact: true, icon: "dashboard" },
  { href: "/admin/complaints", label: "Complaints", icon: "complaints" },
  { href: "/admin/messages", label: "Messages", icon: "messages" },
  { href: "/admin/chat-logs", label: "Chat Logs", icon: "chat-logs" },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/settings", label: "Settings", icon: "settings" },
];

/**
 * The dock shows only the first three; the rest are sheet-only. Order is
 * load-bearing — the highlight positions itself by slot index.
 */
const DOCK_ITEMS = NAV_ITEMS.slice(0, 3);

/**
 * Whether `pathname` is inside `item` (copied from AdminSidebar so the dock
 * and the sidebar can never disagree about which section is current).
 *
 * The prefix branch deliberately requires a following "/" so that a future
 * sibling route such as /admin/complaints-archive cannot claim the Complaints
 * tab, while /admin/complaints/abc123 still does.
 */
function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AdminDock() {
  const router = useRouter();
  // SessionProvider is mounted app-wide, so the session is read directly
  // instead of being threaded through props. `data` is undefined while the
  // session is loading — every read below is optional-chained so the sheet
  // renders a graceful placeholder instead of crashing.
  const { data: session } = useSession();
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

  // Close the sheet when the route changes: watching the resolved URL covers
  // link taps and browser history alike (the same pattern AdminSidebar uses
  // for its drawer). The dock Links also close it on click, because a tap on
  // the already-current route fires no asPath change.
  useEffect(() => {
    setMenuOpen(false);
  }, [router.asPath]);

  const handleSignOut = useCallback(() => {
    // Redirects the whole document, so this component never re-renders after.
    void signOut({ callbackUrl: "/" });
  }, []);

  // Slot count including Menu, for the highlight's percentage position.
  const slots = DOCK_ITEMS.length + 1;
  const activeIndex = DOCK_ITEMS.findIndex((item) => isActiveRoute(router.pathname, item));
  // The highlight tracks the active route; when Menu is open it slides to
  // Menu, mirroring StudentDock. When neither applies (-1 — e.g. the route is
  // /admin/users, which has no dock slot) the highlight is simply not
  // rendered rather than parked somewhere misleading.
  const highlightIndex = menuOpen ? DOCK_ITEMS.length : activeIndex;

  const name = session?.user?.name?.trim() ?? "";
  const email = session?.user?.email ?? "";
  const words = name ? name.split(/\s+/) : [];
  // Same initials recipe as StudentDock (first letter of first and last
  // words); with no name yet known the avatar falls back to a lone "A".
  const initials = words.length
    ? words[0].charAt(0).toUpperCase() + (words[words.length - 1]?.charAt(0).toUpperCase() ?? "")
    : "A";

  return (
    <>
      {menuOpen && (
        <div
          className="wl-sheet"
          role="dialog"
          aria-label="Admin menu"
        >
          <div className="flex items-center gap-3">
            <span className="wl-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              {/* Lines with no data are omitted rather than rendered empty —
                  the sheet must never show a blank identity row. */}
              {name && <p className="text-sm font-semibold text-[var(--wl-ink)]">{name}</p>}
              {email && <p className="font-mono text-xs text-[var(--wl-slate)]">{email}</p>}
            </div>
          </div>

          {/* All six destinations: the three the dock shows plus the three it
              cannot, so nothing in the sidebar is unreachable on a phone. */}
          <nav className="mt-4 space-y-1" aria-label="Admin sections">
            {NAV_ITEMS.map((item) => {
              const active = isActiveRoute(router.pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                    active
                      ? "font-semibold text-[var(--wl-violet)]"
                      : "text-[var(--wl-slate)]"
                  }`}
                >
                  <NavIcon kind={item.icon} size={20} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            className="wl-auth-submit mt-4"
            style={{ height: 44 }}
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      )}

      <nav className={`wl-dock ${scrolled ? "wl-dock-scrolled" : ""}`} aria-label="Admin sections">
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

        {DOCK_ITEMS.map((item) => {
          const active = !menuOpen && isActiveRoute(router.pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="wl-dock-item"
              aria-current={active ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <NavIcon kind={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className="wl-dock-item"
          aria-current={menuOpen ? "page" : undefined}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <NavIcon kind="menu" />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}

/* The sidebar's icon shapes, redrawn as one parameterised component so the
   same glyph serves the 22px dock slots and the smaller sheet rows. */
function NavIcon({ kind, size = 22 }: { kind: IconKind; size?: number }) {
  const common = {
    width: size,
    height: size,
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

  if (kind === "dashboard") {
    return (
      <svg {...common} className="shrink-0">
        <rect x="3.25" y="3.25" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <rect x="13.25" y="3.25" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <rect x="3.25" y="13.25" width="7.5" height="7.5" rx="1.5" {...stroke} />
        <rect x="13.25" y="13.25" width="7.5" height="7.5" rx="1.5" {...stroke} />
      </svg>
    );
  }
  if (kind === "complaints") {
    return (
      <svg {...common} className="shrink-0">
        <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.25L13.5 3Z" {...stroke} />
        <path d="M13.25 3.25V8.5h5.25" {...stroke} />
        <path d="M8.75 13h6.5M8.75 16.5h4" {...stroke} />
      </svg>
    );
  }
  if (kind === "messages") {
    return (
      <svg {...common} className="shrink-0">
        <path d="M20.25 12c0 3.73-3.69 6.75-8.25 6.75a9.7 9.7 0 0 1-2.53-.33L5.25 20.25l1.13-3.2C4.98 15.85 3.75 14.05 3.75 12c0-3.73 3.69-6.75 8.25-6.75s8.25 3.02 8.25 6.75Z" {...stroke} />
        <path d="M8.75 11.25h6.5M8.75 14h4" {...stroke} />
      </svg>
    );
  }
  if (kind === "chat-logs") {
    return (
      <svg {...common} className="shrink-0">
        <path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7" {...stroke} />
      </svg>
    );
  }
  if (kind === "users") {
    return (
      <svg {...common} className="shrink-0">
        <circle cx="9" cy="8" r="3.25" {...stroke} />
        <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" {...stroke} />
        <path d="M16 5.6a3 3 0 0 1 0 5.8" {...stroke} />
        <path d="M17.4 14.3a5.5 5.5 0 0 1 3.1 4.7" {...stroke} />
      </svg>
    );
  }
  if (kind === "settings") {
    return (
      <svg {...common} className="shrink-0">
        <circle cx="12" cy="12" r="3.25" {...stroke} />
        <path d="M12 2.75v2.4M12 18.85v2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M2.75 12h2.4M18.85 12h2.4M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7" {...stroke} />
      </svg>
    );
  }
  // Menu: three horizontal lines, as on StudentDock.
  return (
    <svg {...common} className="shrink-0">
      <path d="M4 7h16M4 12h16M4 17h10" {...stroke} />
    </svg>
  );
}
