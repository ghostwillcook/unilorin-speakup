import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";

import AdminDock from "@/components/AdminDock";
import NeonButton from "@/components/NeonButton";
import { SpeakUpWordmark, UnilorinLogo } from "@/components/Logo";
import { useHeaderFold } from "@/lib/useHeaderFold";

/**
 * The admin shell's navigation column.
 *
 * Defined once and rendered by AdminLayout, so every admin page inherits the
 * same chrome instead of re-deriving it. Fixed at every breakpoint: below `lg`
 * navigation lives in the floating AdminDock (this component renders the slim
 * top bar plus the dock itself), and at `lg` it becomes a permanent rail —
 * AdminLayout reserves the column with padding rather than putting the aside in
 * flow, so a long page never drags the navigation up out of view.
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
  { href: "/admin/live-chat", label: "Live Chat", icon: <LiveChatIcon /> },
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
  const [signingOut, setSigningOut] = useState(false);

  // Fold the mobile bar away on scroll down, back on scroll up. The breakpoint
  // is lg (not the hook's md default) because the bar is lg:hidden — it only
  // exists below 1024px.
  const folded = useHeaderFold({ breakpoint: "(max-width: 1023px)" });

  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    // Redirects the whole document, so this component never re-renders after.
    void signOut({ callbackUrl: "/" });
  }, []);

  return (
    <>
      {/* Mobile bar — keeps the brand visible while the dock owns navigation.
          Folds away on scroll (see useHeaderFold) via the shared transform
          classes; the bar is fixed, so the slide is paint-only and never
          disturbs the layout beneath it. */}
      <div
        className={`fold-header fixed inset-x-0 top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-raised/95 px-4 backdrop-blur-md lg:hidden ${
          folded ? "fold-header-hidden" : ""
        }`}
      >
        <SpeakUpWordmark compact />
        <span className="ml-auto text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
          Admin
        </span>
      </div>

      {/* Desktop rail: below lg this simply is not rendered (hidden), so none of
          the old drawer transition machinery exists anymore — the aside is a
          plain, unconditional column at lg and up. */}
      <aside
        aria-label="Admin navigation"
        className="fixed bottom-0 left-0 top-0 z-40 hidden w-72 flex-col border-r border-line bg-raised lg:flex"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <UnilorinLogo size={38} />
          <span className="min-w-0 flex-1 text-base leading-tight">
            <SpeakUpWordmark compact />
            <span className="mt-1 block text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
              Students Affairs
            </span>
          </span>
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

      {/* Mobile navigation: the floating bottom dock (with its Menu sheet for
          the full link list and sign-out). wl-scope supplies the --wl-* custom
          properties the dock's CSS consumes; lg:hidden because the desktop rail
          takes over at lg. */}
      <div className="wl-scope lg:hidden">
        <AdminDock />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Icons — inline so the sidebar carries no icon-font or package dependency.  */
/* ------------------------------------------------------------------------- */

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

function LiveChatIcon() {
  return (
    <Icon>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4c-.5.4-1.3 0-1.3-.6V6.5Z" />
      <path d="M8.5 10h7M8.5 13h4.5" />
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
