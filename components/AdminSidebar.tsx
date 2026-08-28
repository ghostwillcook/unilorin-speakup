import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";

import NeonButton from "@/components/NeonButton";
import { SpeakUpWordmark, UnilorinLogo } from "@/components/Logo";

/**
 * The admin shell's navigation column.
 *
 * Defined once and rendered by AdminLayout, so every admin page inherits the
 * same chrome instead of re-deriving it. Fixed at every breakpoint: below `lg`
 * it is an off-canvas drawer driven by a hamburger in a slim top bar, and at
 * `lg` it simply stops translating — AdminLayout reserves the column with
 * padding rather than putting the aside in flow, so a long page never drags the
 * navigation up out of view.
 *
 * `bg-raised` (not .surface) is deliberate: the sidebar is the one opaque raised
 * plane in the UI, which is what lets the translucent panels beside it read as
 * floating over the page wash.
 */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /**
   * When true the link only highlights on an exact pathname match. Required for
   * /admin: a prefix test would light up Dashboard on every admin sub-route.
   */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", exact: true, icon: <DashboardIcon /> },
  { href: "/admin/complaints", label: "Complaints", icon: <ComplaintsIcon /> },
  { href: "/admin/messages", label: "Messages", icon: <MessagesIcon /> },
  { href: "/admin/chat-logs", label: "Chat Logs", icon: <ChatLogsIcon /> },
  { href: "/admin/users", label: "Users", icon: <UsersIcon /> },
  { href: "/admin/settings", label: "Settings", icon: <SettingsIcon /> },
];

/**
 * Whether `pathname` is inside `item`.
 *
 * The prefix branch deliberately requires a following "/" so that a future
 * sibling route such as /admin/complaints-archive cannot claim the Complaints
 * tab, while /admin/complaints/abc123 still does.
 */
function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AdminSidebar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // A tap on a nav link navigates and must also dismiss the drawer; watching
  // the resolved URL covers link taps and browser history alike.
  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  // Escape closes the drawer, matching every other overlay convention.
  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    // Redirects the whole document, so this component never re-renders after.
    void signOut({ callbackUrl: "/" });
  }, []);

  return (
    <>
      {/* Mobile bar — owns the hamburger and keeps the brand visible while the
          drawer is closed. */}
      <div className="fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-raised/95 px-4 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="admin-sidebar"
          className="btn-icon h-9 w-9 rounded-xl"
        >
          <MenuGlyph open={open} />
        </button>
        <SpeakUpWordmark compact />
        <span className="ml-auto text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
          Admin
        </span>
      </div>

      {/* Scrim: closes the drawer and stops stray taps reaching the page. */}
      {open && (
        <div
          onClick={close}
          className="fixed inset-0 z-30 bg-canvas/80 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* `invisible` when closed is load-bearing, not decoration: a drawer left
          at -100% still takes tab stops and is still read out. Transitioning
          visibility alongside the transform holds it visible for the length of
          the slide, so it hides only once it has left the screen. */}
      <aside
        id="admin-sidebar"
        aria-label="Admin navigation"
        className={`fixed bottom-0 left-0 top-0 z-40 flex w-72 max-w-[85vw] flex-col border-r border-line bg-raised transition-[transform,visibility] duration-200 ease-out lg:visible lg:max-w-none lg:translate-x-0 ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <UnilorinLogo size={38} />
          <span className="min-w-0 flex-1 text-base leading-tight">
            <SpeakUpWordmark compact />
            <span className="mt-1 block text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
              Students Affairs
            </span>
          </span>
          {/* The hamburger sits under the scrim once the drawer is open, so the
              drawer carries its own dismiss control. */}
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation"
            className="btn-icon h-8 w-8 lg:hidden"
          >
            <MenuGlyph open />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <p className="field-label px-3">Console</p>
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const active = isActiveRoute(router.pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link relative ${active ? "nav-link-active" : ""}`}
                  >
                    {/* Absolute so the rail costs no horizontal space — labels
                        sit on the same x whether or not the row is current. */}
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent"
                        aria-hidden="true"
                      />
                    )}
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-line px-3 py-4">
          <NeonButton
            variant="ghost"
            onClick={handleSignOut}
            loading={signingOut}
            className="w-full"
          >
            {!signingOut && (
              <svg
                viewBox="0 0 24 24"
                className="h-[1.15rem] w-[1.15rem] shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15.5 8.25V6.5A1.5 1.5 0 0 0 14 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H14a1.5 1.5 0 0 0 1.5-1.5v-1.75" />
                <path d="M18.5 12H9.75M18.5 12l-2.75-2.75M18.5 12l-2.75 2.75" />
              </svg>
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </NeonButton>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Icons — inline so the sidebar carries no icon-font or package dependency.  */
/* ------------------------------------------------------------------------- */

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.15rem] w-[1.15rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.15rem] w-[1.15rem] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function DashboardIcon() {
  return (
    <Icon>
      <rect x="3.25" y="3.25" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.25" y="3.25" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.25" y="13.25" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.25" y="13.25" width="7.5" height="7.5" rx="1.5" />
    </Icon>
  );
}

function ComplaintsIcon() {
  return (
    <Icon>
      <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.25L13.5 3Z" />
      <path d="M13.25 3.25V8.5h5.25" />
      <path d="M8.75 13h6.5M8.75 16.5h4" />
    </Icon>
  );
}

function MessagesIcon() {
  return (
    <Icon>
      <path d="M20.25 12c0 3.73-3.69 6.75-8.25 6.75a9.7 9.7 0 0 1-2.53-.33L5.25 20.25l1.13-3.2C4.98 15.85 3.75 14.05 3.75 12c0-3.73 3.69-6.75 8.25-6.75s8.25 3.02 8.25 6.75Z" />
      <path d="M8.75 11.25h6.5M8.75 14h4" />
    </Icon>
  );
}

function ChatLogsIcon() {
  return (
    <Icon>
      <path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7" />
    </Icon>
  );
}

function UsersIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.6a3 3 0 0 1 0 5.8" />
      <path d="M17.4 14.3a5.5 5.5 0 0 1 3.1 4.7" />
    </Icon>
  );
}

function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.75v2.4M12 18.85v2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M2.75 12h2.4M18.85 12h2.4M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7" />
    </Icon>
  );
}
