import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";

import { useSocket } from "@/lib/socket-client";

/**
 * The blocking notification overlay — a full-screen modal the student cannot
 * ignore. This is SEPARATE from NotificationBell and renders exactly ONCE on
 * the student page (not per-header), because the old design had two bell
 * instances each running their own overlay, producing two stacked modals.
 *
 * Two delivery paths feed the same queue:
 *
 *   1. Realtime: the socket server emits `notification:new` to the student's
 *      personal room when the admin sends. Instant.
 *   2. Catch-up: on mount, GET /api/notifications returns every UNREAD
 *      notification. This covers the case the realtime path cannot: when the
 *      admin sent via REST (socket was cold), the notification landed in the
 *      database but no socket event was emitted — the student would otherwise
 *      never see the overlay at all.
 *
 * The queue displays ONE notification at a time. Continue pops the head,
 * revealing the next. No auto-dismiss — the spec is explicit that the user
 * must interact before continuing. Marking as read is handled by the bell's
 * own logic and the /api/notifications/read endpoint; this component only
 * manages the visual dismissal.
 */

interface QueuedNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Prefix for locally-generated ids — a fallback only, for realtime payloads
 * that arrive without the notification row id (older socket server builds).
 */
const LOCAL_PREFIX = "overlay-";
let localSeq = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function NotificationOverlay() {
  const { data: session, status: authStatus } = useSession();
  const { socket } = useSocket(true);
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const [mounted, setMounted] = useState(false);
  // Guards the catch-up fetch: it runs once per session (not per re-render),
  // and only for notifications that are UNREAD (readAt === null).
  const catchUpDone = useRef(false);

  const userId = session?.user?.id ?? null;

  // SSR guard: createPortal needs document.body, which doesn't exist during
  // server rendering. The overlay is client-only by construction.
  useEffect(() => {
    setMounted(true);
  }, []);

  /* -------------------------------------------------------- catch-up path */

  // On mount (once per session), fetch unread notifications and queue them.
  // This is the path that covers REST-sent notifications the realtime path
  // missed.
  useEffect(() => {
    if (catchUpDone.current) return;
    if (!userId || authStatus !== "authenticated") return;
    catchUpDone.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/notifications", {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const body: unknown = await res.json().catch(() => null);
        if (!isRecord(body) || !Array.isArray(body.notifications)) return;

        // Only UNREAD notifications get the blocking overlay — a student
        // returning to the app after reading yesterday's messages should not
        // be re-blocked by them. The bell's "Mark all read" clears this.
        const unread = body.notifications.filter(
          (raw): raw is Record<string, unknown> =>
            isRecord(raw) && raw.readAt === null,
        );

        const queued: QueuedNotification[] = [];
        for (const raw of unread) {
          const title = typeof raw.title === "string" ? raw.title : "";
          const bodyText = typeof raw.body === "string" ? raw.body : "";
          const createdAt =
            typeof raw.createdAt === "string"
              ? raw.createdAt
              : new Date().toISOString();
          const id =
            typeof raw.id === "string" ? raw.id : `${LOCAL_PREFIX}${Date.now()}-${++localSeq}`;
          if (title && bodyText) {
            queued.push({ id, title, body: bodyText, createdAt });
          }
        }

        if (queued.length > 0) {
          setQueue((prev) => {
            // De-duplicate against anything already queued from realtime.
            // Both paths key on the notification's real DB id (the socket
            // payload carries it), so the same row arriving through both
            // channels is recognized as one.
            const seen = new Set(prev.map((q) => q.id));
            return [...prev, ...queued.filter((q) => !seen.has(q.id))];
          });
        }
      } catch {
        // Catch-up is best-effort: if it fails, the bell still has the
        // notifications and the student can read them there.
      }
    })();
  }, [authStatus, userId]);

  /* ------------------------------------------------------ realtime path */

  useEffect(() => {
    if (!socket) return;

    function handleNew(payload: unknown): void {
      if (!isRecord(payload)) return;
      const title = typeof payload.title === "string" ? payload.title : "";
      const body = typeof payload.body === "string" ? payload.body : "";
      if (!title || !body) return;

      // Prefer the notification's real DB row id when the payload carries it
      // (current socket server builds do), so realtime entries dedupe
      // against the catch-up fetch's DB ids. The synthetic overlay-<ts> id
      // is only a fallback for payloads without one.
      const id =
        typeof payload.id === "string" && payload.id
          ? payload.id
          : `${LOCAL_PREFIX}${Date.now()}-${++localSeq}`;

      const entry: QueuedNotification = {
        id,
        title,
        body,
        createdAt:
          typeof payload.createdAt === "string"
            ? payload.createdAt
            : new Date().toISOString(),
      };
      setQueue((prev) => {
        // De-duplicate against anything already queued from the catch-up
        // fetch: the same notification can arrive through both paths (row
        // fetched on mount, then the realtime emit — or vice versa), and
        // both now speak the same DB row id. Keying on id rather than
        // title+body also keeps a repeat announcement with identical text
        // from being wrongly skipped as a duplicate.
        const seen = new Set(prev.map((q) => q.id));
        return seen.has(entry.id) ? prev : [...prev, entry];
      });
    }

    socket.on("notification:new", handleNew);
    return () => {
      socket.off("notification:new", handleNew);
    };
  }, [socket]);

  /* ------------------------------------------------------------- dismiss */

  const dismiss = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  /* -------------------------------------------------------------- render */

  // No queue, or SSR: render nothing.
  if (queue.length === 0 || !mounted) return null;

  const current = queue[0];

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={current.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-3xl border border-line bg-white px-7 py-8 shadow-[0_32px_64px_rgb(0_0_0/0.3)] sm:px-9 sm:py-10">
        {/* Bell icon — reads as "notification" at a glance. */}
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

        <h3 className="mt-5 text-center text-lg font-bold text-graphite sm:text-xl">
          {current.title}
        </h3>
        {/* whitespace-pre-line preserves the admin's line breaks: a
            multi-paragraph notification reads as paragraphs, not one solid
            wall of text. (The default collapses \n into nothing.) */}
        <p className="mt-3 whitespace-pre-line text-center text-sm leading-relaxed text-muted sm:text-base">
          {current.body}
        </p>

        {queue.length > 1 && (
          <p className="mt-3 text-center text-xs font-medium text-muted/70">
            {queue.length - 1} more notification
            {queue.length - 1 === 1 ? "" : "s"} after this
          </p>
        )}

        <div className="mt-7">
          <button
            type="button"
            onClick={dismiss}
            className="w-full rounded-full bg-accent px-6 py-3.5 text-base font-bold text-white shadow-[0_16px_32px_rgb(194_65_12/0.3)] transition-all duration-150 hover:bg-accent-deep hover:shadow-[0_20px_40px_rgb(194_65_12/0.4)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Continue
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
