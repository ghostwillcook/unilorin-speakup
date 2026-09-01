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

/** One blocking notification overlay, derived from a notification:new event.
 *  Unlike the old auto-dismissing toasts, these REQUIRE the user to press
 *  Continue — no timeout, no passive dismissal. */
interface ToastEntry {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

// No auto-dismiss timer: the spec requires explicit user interaction ("the
// user must press Continue"). Multiple notifications queue sequentially —
// Notification 1 → Continue → Notification 2 → Continue — so the overlay
// never stacks; only the head of the queue is rendered.

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
  // The blocking overlay queue: notifications arrive here and display ONE at
  // a time (the head of the array). No auto-dismiss — the Continue button
  // pops the head, which either reveals the next or clears the overlay.
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

  // Removes the HEAD toast (the Continue button's handler) — sequential queue
  // semantics: dismissing one reveals the next, or clears the overlay when
  // the queue empties. The bell's history is untouched; the notification row
  // is already persisted server-side.
  const dismissToast = useCallback(() => {
    setToasts((prev) => prev.slice(1));
  }, []);

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

      // Blocking overlay — pushed to the queue; the head displays as a
      // full-screen modal requiring Continue. No cap: a burst queues and
      // shows sequentially, per the spec ("Notification 1 → Continue →
      // Notification 2 → Continue → App").
      setToasts((prev) => [
        ...prev,
        {
          id: `toast-${Date.now()}-${provisionalSeq}`,
          title: provisional.title,
          body: provisional.body,
          createdAt: provisional.createdAt,
        },
      ]);

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

      {/* Blocking notification overlay: portaled to document.body so it
          escapes the header's z-20 stacking context. A full-screen dimmed
          modal — only the HEAD of the queue renders (sequential display, per
          the spec). The user must press Continue; nothing auto-dismisses and
          nothing behind the overlay is interactive while it is up. */}
      {toasts.length > 0 &&
        createPortal(
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={toasts[0].title}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            {/* The card: centered, max-w for readability, solid white so the
                dimmed app behind reads as "paused" rather than bleeding
                through. Rounded glass consistent with the app's card
                language. */}
            <div className="mx-4 w-full max-w-md rounded-3xl border border-line bg-white px-7 py-8 shadow-[0_32px_64px_rgb(0_0_0/0.3)] sm:px-9 sm:py-10">
              {/* Notification icon — a small bell in the app's accent, so the
                  card reads as "notification" at a glance rather than as an
                  error or a generic modal. */}
              <div className="flex justify-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent"
                    aria-hidden="true"
                  >
                    <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" />
                    <path d="M10.3 19.5a2 2 0 0 0 3.4 0" />
                  </svg>
                </span>
              </div>

              {/* Title + body — the notification's content, clearly readable,
                  generous sizing for a phone held at arm's length. */}
              <h3 className="mt-5 text-center text-lg font-bold text-graphite sm:text-xl">
                {toasts[0].title}
              </h3>
              <p className="mt-3 text-center text-sm leading-relaxed text-muted sm:text-base">
                {toasts[0].body}
              </p>

              <p className="mt-4 text-center text-[0.6875rem] text-muted/60">
                {dateTimeLabel(toasts[0].createdAt)}
              </p>

              {/* Queue indicator — only shows when more notifications are
                  waiting, so the user knows pressing Continue reveals
                  another rather than returning to the app. */}
              {toasts.length > 1 && (
                <p className="mt-3 text-center text-xs font-medium text-muted/70">
                  {toasts.length - 1} more notification
                  {toasts.length - 1 === 1 ? "" : "s"} after this
                </p>
              )}

              {/* Continue — the only dismissal. Large pill, full-width on
                  mobile for an easy thumb target; the app's accent fill so it
                  reads as the primary action. */}
              <div className="mt-7">
                <button
                  type="button"
                  onClick={dismissToast}
                  className="w-full rounded-full bg-accent px-6 py-3.5 text-base font-bold text-white shadow-[0_16px_32px_rgb(194_65_12/0.3)] transition-all duration-150 hover:bg-accent-deep hover:shadow-[0_20px_40px_rgb(194_65_12/0.4)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Continue
                </button>
              </div>
            </div>
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
