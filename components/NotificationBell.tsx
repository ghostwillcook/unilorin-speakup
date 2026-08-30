import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";

import { dateTimeLabel } from "@/lib/pseudonym";
import { subscribeToPush } from "@/lib/push";
import { useSocket } from "@/lib/socket-client";

/**
 * The student notification bell — the read side of the admin→student
 * notification channel, rendered in both headers of the student console
 * (mobile greeting row and desktop bar).
 *
 * Self-contained by design: it owns its data (GET /api/notifications →
 * { notifications, unread }), its realtime updates (socket "notification:new"
 * to the student's personal room), and its actions (mark-all-read, Web Push
 * opt-in). The headers that host it only supply a spot in the layout — the one
 * exception being `onOpenChange`, which exists purely for stacking (see
 * below) — and it uses the plain app vocabulary (btn-ghost, badge) rather than
 * the mobile header's wl-* classes: it has to sit in both headers without
 * inheriting either's scoping.
 *
 * Stacking, and why the dropdown's own z-40 is not enough: the bell lives
 * inside the sticky header, which is a z-20 stacking context. The dropdown
 * inherits that ceiling, so its own z-40 cannot beat the mobile dock (z-30)
 * or the dock's account sheet (z-31) — both would paint over the panel's
 * lower half on short viewports. The fix lives one level up: while the
 * dropdown is open the bell reports it through `onOpenChange`, and the
 * hosting page lifts the whole header to z-40 (and pins it against the
 * scroll-fold), so the header — and everything inside it, dropdown included —
 * clears the dock for as long as the menu is up.
 *
 * Popup toasts: a new notification also pops onto the screen as a dismissible
 * card — not just a badge bump — because a student mid-complaint deserves to
 * know the Unit just posted something. These render through a portal to
 * document.body: the header's stacking context would otherwise cap them at
 * z-20, under the dock, and a fixed element inside a sticky parent inherits
 * that ceiling on several engines. Portaling to the top level lets them sit
 * at z-50, above every console chrome element (header z-20/z-40, dock z-30,
 * sheet z-31).
 */

/** Mirrors StudentNotification in pages/api/notifications/index.ts. */
interface StudentNotification {
  id: string;
  title: string;
  body: string;
  /** null = still unread; the unread rows carry the dropdown's highlight. */
  readAt: string | null;
  createdAt: string;
}

type PushState = "idle" | "on" | "failed";

/** One on-screen popup toast, derived from a notification:new event. */
interface ToastEntry {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** How long a toast stays on screen before closing itself. */
const TOAST_MS = 8000;
/** Cap on stacked toasts — a burst of five drops the oldest two rather than
 *  filling the viewport. Three feels like "you have things to read"; five
 *  feels like a takeover. */
const TOAST_CAP = 3;

// Monotonic counter for provisional notification:new rows. Date.now() alone
// collides when two events land in the same millisecond (duplicate keys in
// the list, only one rendered); the counter guarantees uniqueness within this
// tab's lifetime, and crypto.randomUUID (when present) across reloads.
let provisionalSeq = 0;

function nextProvisionalId(): string {
  provisionalSeq += 1;
  return `local:${crypto.randomUUID?.() ?? Date.now()}-${provisionalSeq}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNotification(value: unknown): StudentNotification | null {
  if (!isRecord(value)) return null;
  const { id, title, body, readAt, createdAt } = value;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  if (readAt !== null && typeof readAt !== "string") return null;
  return { id, title, body, readAt, createdAt };
}

export default function NotificationBell({
  onOpenChange,
}: {
  /**
   * Reports every open/close transition so the hosting header can react —
   * the student console uses it to lift the header's z-index above the
   * mobile dock while the dropdown is up (see the file-level note on
   * stacking) and to pin the header against its scroll-fold. Optional, so
   * the bell still works dropped into any other header unchanged.
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const { data: session, status: authStatus } = useSession();
  // The socket here is listen-only; it exists so notification:new can bump the
  // badge the moment a send lands, badge closed or open.
  const { socket } = useSocket(true);

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<StudentNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // Portal-mounted popup cards: one per recent notification:new, each with its
  // own dismissal (Close button or the TOAST_MS timer).
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // Web Push support can only be probed in the browser, so it starts "no" and
  // flips after mount — SSR renders no button at all, which is correct.
  const [pushSupported, setPushSupported] = useState(false);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [subscribing, setSubscribing] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  // Guards the fetch replace-race: load() can be re-entered (notification:new
  // refetches while a mount-time request is still in flight), and responses
  // may land out of order — a stale one resolving last would wipe the newer
  // rows. Only the response carrying the latest sequence number is applied.
  const latestReq = useRef(0);

  const userId = session?.user?.id ?? null;

  // Removes one toast — the Close button's handler. The auto-dismiss sweep
  // below uses the same state setter on a timer.
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-dismiss: a single timer keyed on the toast list, resetting whenever a
  // new toast arrives (each gets a fresh TOAST_MS window from that point).
  // The sweep parses the timestamp back out of the id (`toast-<ms>-<seq>`).
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - TOAST_MS;
      setToasts((prev) =>
        prev.filter((t) => {
          const stamp = Number.parseInt(t.id.split("-")[1] ?? "0", 10);
          return Number.isNaN(stamp) || stamp > cutoff;
        }),
      );
    }, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  /* ---------------------------------------------------------------- load */

  const load = useCallback(async () => {
    const seq = ++latestReq.current;
    try {
      const res = await fetch("/api/notifications", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const body: unknown = await res.json().catch(() => null);
      if (!isRecord(body)) return;
      // A newer request has superseded this one — drop the stale payload.
      if (seq !== latestReq.current) return;

      const rows = Array.isArray(body.notifications) ? body.notifications : [];
      const parsed: StudentNotification[] = [];
      for (const raw of rows) {
        const row = asNotification(raw);
        if (row) parsed.push(row);
      }
      setNotifications(parsed);
      setUnread(typeof body.unread === "number" ? body.unread : 0);
    } catch {
      // Offline or cold: the badge simply stays where it was. The bell is an
      // enhancement, never a blocker.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      if (authStatus !== "loading") setLoaded(true);
      return;
    }
    void load();
  }, [authStatus, load, userId]);

  /* ------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!socket || !userId) return;

    // notification:new carries { title, body, createdAt } but no row id (see
    // server/socket.mjs), so the handler prepends a provisional row to light
    // the badge instantly and then refetches — the refetch swaps the provisional
    // entry for the persisted one with its real id. The same event also raises
    // a popup toast: a badge bump alone is invisible to a student who isn't
    // looking at the header, and "the Unit just posted" is worth interrupting
    // for.
    function handleNew(payload: unknown): void {
      if (!isRecord(payload)) return;
      const provisional: StudentNotification = {
        id: nextProvisionalId(),
        title: typeof payload.title === "string" ? payload.title : "",
        body: typeof payload.body === "string" ? payload.body : "",
        readAt: null,
        createdAt:
          typeof payload.createdAt === "string"
            ? payload.createdAt
            : new Date().toISOString(),
      };
      setNotifications((prev) => [provisional, ...prev]);
      setUnread((count) => count + 1);

      // Popup toast — same content, own id so the Close button can target it
      // independently of the badge row. The timestamp suffix doubles as the
      // expiry key for the auto-dismiss sweep.
      setToasts((prev) => {
        const next: ToastEntry[] = [
          {
            id: `toast-${Date.now()}-${provisionalSeq}`,
            title: provisional.title,
            body: provisional.body,
            createdAt: provisional.createdAt,
          },
          ...prev,
        ];
        return next.slice(0, TOAST_CAP);
      });

      void load();
    }

    socket.on("notification:new", handleNew);
    return () => {
      socket.off("notification:new", handleNew);
    };
  }, [load, socket, userId]);

  /* ----------------------------------------------------- open/close plumbing */

  // Every open/close transition is reported up, so the hosting header can
  // lift itself above the mobile dock (and pin against its scroll-fold) for
  // exactly as long as the dropdown is on screen. Calling with `false` on
  // mount is harmless: the host's state already starts closed.
  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  // A tap outside the bell's subtree closes the dropdown — the standard menu
  // dismissal, since the bell is in a header, not a modal flow.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent): void {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  /* ------------------------------------------------------------ push probe */

  useEffect(() => {
    // Guards spelled out exactly: SSR has no window, iOS Safari still ships
    // no PushManager, and a Notification API without a service worker can
    // never deliver a background push. Unsupported → the button never renders.
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    ) {
      setPushSupported(true);
    }

    // Repeat visitors: permission already granted on a previous visit, with a
    // live subscription registered against the service worker. Without this
    // check the bell would offer "Enable push notifications" to a browser
    // that is in fact already subscribed. Permission granted but no
    // subscription (user reset site data, or never completed the flow) stays
    // "idle" so the button still offers the opt-in.
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      let cancelled = false;
      void (async () => {
        try {
          const registration = await navigator.serviceWorker?.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          if (!cancelled && subscription) setPushState("on");
        } catch {
          // Probe only: any failure just leaves the button at "idle".
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, []);

  /* ------------------------------------------------------------- actions */

  const markAllRead = useCallback(async () => {
    // Local first so the highlight drops on the same tap that requested it;
    // the POST is idempotent, so a failure costs nothing but a refresh.
    setNotifications((prev) =>
      prev.map((row) =>
        row.readAt === null ? { ...row, readAt: new Date().toISOString() } : row,
      ),
    );
    setUnread(0);
    try {
      await fetch("/api/notifications/read", { method: "POST" });
    } catch {
      // Same stance as load(): the badge is advisory, not load-bearing.
    }
  }, []);

  const enablePush = useCallback(async () => {
    setSubscribing(true);
    setPushState("idle");
    try {
      // subscribeToPush never throws — permission denied, unsupported browser,
      // missing VAPID key, any network failure all return null, which is simply
      // "push is off for this browser".
      const subscription = await subscribeToPush();
      setPushState(subscription ? "on" : "failed");
    } finally {
      setSubscribing(false);
    }
  }, []);

  /* -------------------------------------------------------------- render */

  const badgeLabel =
    unread > 0 ? `${unread > 99 ? "99+" : unread} unread notifications` : "";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn-icon relative h-9 w-9"
        aria-label={badgeLabel ? `Notifications, ${badgeLabel}` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {/* The bell, drawn inline at button scale to stay single-file. */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" />
          <path d="M10.3 19.5a2 2 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Popup toasts: portaled to document.body so they escape the header's
          z-20 stacking context entirely. Fixed bottom-right on desktop,
          bottom-center on mobile (above the dock's 64px + safe-area). Each
          card carries the notification's title and body with a Close button;
          auto-dismisses after TOAST_MS. */}
      {toasts.length > 0 &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed inset-x-4 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] z-50 flex flex-col items-center gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
          >
            {toasts.map((toast) => (
              <div
                key={toast.id}
                // pointer-events re-enabled on the card itself (the wrapper
                // is pointer-events-none so taps pass through the gaps
                // between stacked toasts to the page underneath).
                className="pointer-events-auto w-full max-w-sm rounded-2xl border border-line bg-white px-4 py-3.5 shadow-[0_24px_48px_rgb(0_0_0/0.18)]"
                role="status"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-graphite">
                      {toast.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {toast.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    aria-label="Close notification"
                    className="btn-icon -mr-1 -mt-1 h-7 w-7 shrink-0 rounded-full text-muted"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                  </button>
                </div>
                <p className="mt-2 text-right text-[0.6875rem] text-muted/60">
                  {dateTimeLabel(toast.createdAt)}
                </p>
              </div>
            ))}
          </div>,
          document.body,
        )}

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          // z-40 within the header's own stacking context — the ceiling the
          // host must lift for this to matter: the header is z-20 by default,
          // and while this dropdown is open the host raises the header itself
          // to z-40 (via onOpenChange) so the whole context clears the mobile
          // dock (z-30) and its account sheet (z-31). Clamped width so it
          // never runs off a phone screen.
          className="absolute right-0 top-[calc(100%+0.625rem)] z-40 w-[min(22rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_48px_rgb(0_0_0/0.16)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-graphite">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-semibold text-accent underline underline-offset-2 hover:text-accent-deep"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                {loaded ? "No notifications yet." : "Loading…"}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((row) => (
                  <li
                    key={row.id}
                    // Unread rows carry the veil wash; read ones sit on plain
                    // white, so the highlight means something.
                    className={`px-4 py-3 ${row.readAt === null ? "bg-veil" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-graphite">
                        {row.title}
                      </p>
                      <time
                        dateTime={row.createdAt}
                        className="shrink-0 text-[0.6875rem] text-muted/70"
                      >
                        {dateTimeLabel(row.createdAt)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">
                      {row.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pushSupported && (
            <div className="border-t border-line px-4 py-3">
              {pushState === "on" ? (
                <p className="text-xs font-medium text-muted" role="status">
                  Push notifications enabled.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => void enablePush()}
                    disabled={subscribing}
                    className="text-xs font-semibold text-accent underline underline-offset-2 hover:text-accent-deep disabled:opacity-45"
                  >
                    {subscribing ? "Enabling…" : "Enable push notifications"}
                  </button>
                  {pushState === "failed" && (
                    <p className="text-xs text-danger" role="status">
                      Push could not be enabled on this browser. The in-app bell
                      still works.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
