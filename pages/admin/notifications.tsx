import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { requirePage, isRedirect, type SessionUser } from "@/lib/guards";
import { dateTimeLabel } from "@/lib/pseudonym";
import { useSocket } from "@/lib/socket-client";

/**
 * Admin Notifications — the Unit's push-notification channel.
 *
 * One composer, one history list. The admin writes a title and a message,
 * picks the audience (every active student, or one student found through the
 * same anonymous-ID-or-matric lookup the Messages page uses), and sends.
 * Every recipient gets a Notification row (the in-app center), a realtime
 * notification:new to their personal room, and a Web Push per subscription.
 *
 * The send path mirrors the Messages reply path: the socket is the primary
 * channel (notification:send in, notification:sent { count } back — the
 * broadcast fan-out happens on the socket server, which also emits the
 * realtime events), and POST /api/admin/notifications is the REST twin for a
 * session whose socket is down. The REST route deliberately emits no realtime
 * event, so a send can never go through both channels and double-notify
 * online students — but the rows are the source of truth either way, which is
 * why the history list refreshes after every send no matter which path took
 * it.
 *
 * The history list has one wrinkle: the API returns a row per recipient, so a
 * broadcast to 300 students is 300 identical rows. See groupHistory below for
 * how they are collapsed back into one entry per send.
 */
// No length caps on title or body — the API route, the socket server, and
// this composer all agree: the admin is the trusted author and the Postgres
// TEXT column is unlimited. Only non-empty is validated (client-side here,
// server-side in both write paths).
/**
 * The socket send is fire-and-forget, so "no answer" has to eventually mean
 * something. 30s is generous: the server pushes to every subscription of
 * every recipient sequentially, so a large broadcast legitimately takes a
 * while — the guard only exists so a server that dies mid-send cannot leave
 * the Send button disabled forever.
 */
const SEND_TIMEOUT_MS = 30_000;
/** How long the "Sent to N students" confirmation lingers before fading. */
const CONFIRMATION_MS = 6_000;

/** A student found through the "One student" lookup. */
interface LookedUpUser {
  id: string;
  name: string;
  /** Matriculation number, i.e. User.studentId. */
  studentId: string;
  anonymousId: string | null;
}

/** One row of GET /api/admin/notifications — one recipient's copy. */
interface NotificationRow {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  recipient: { id: string; name: string; studentId: string };
}

/** One entry of the on-screen history: one send, however many recipients. */
interface HistoryEntry {
  /** The group's first row — only a React key, never shown. */
  id: string;
  title: string;
  body: string;
  createdAt: string;
  /** How many rows collapsed into this entry. */
  count: number;
  /** Null when the entry is a broadcast (count > 1): "All students". */
  recipient: NotificationRow["recipient"] | null;
}

type Audience = "ALL" | "ONE";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function asNotificationRow(value: unknown): NotificationRow | null {
  if (!isRecord(value)) return null;
  const { id, title, body, createdAt, recipient } = value;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    typeof createdAt !== "string" ||
    !isRecord(recipient) ||
    typeof recipient.id !== "string" ||
    typeof recipient.name !== "string" ||
    typeof recipient.studentId !== "string"
  ) {
    return null;
  }
  return {
    id,
    title,
    body,
    createdAt,
    recipient: {
      id: recipient.id,
      name: recipient.name,
      studentId: recipient.studentId,
    },
  };
}

/**
 * Collapse the per-recipient rows into one entry per send.
 *
 * A broadcast is written by a single createMany — one INSERT, so Postgres'
 * NOW() (the transaction timestamp) is identical on every row of that send,
 * and no two separate sends can ever share one. Rows that agree on
 * title + body + createdAt are therefore the same send; since the list
 * arrives newest-first, a send's rows are contiguous. An entry with more than
 * one row is a broadcast (recipient hidden behind "All students"); a single
 * row is a targeted send and shows the student.
 *
 * The one ambiguity: a broadcast that happened to reach exactly one active
 * student reads as a targeted send. That is indistinguishable in the data
 * model itself (the row never recorded an intent), so the list shows the
 * truth it has.
 *
 * (A broadcast larger than the API's 50-row window is truncated, so `count`
 * is a lower bound for big sends — the label stays "All students" either
 * way, which is why the count is kept for nothing but the key-uniqueness of
 * the render.)
 */
function groupHistory(rows: NotificationRow[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    const last = entries[entries.length - 1];
    if (
      last &&
      last.title === row.title &&
      last.body === row.body &&
      last.createdAt === row.createdAt
    ) {
      last.count += 1;
      continue;
    }
    entries.push({
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      count: 1,
      recipient: row.recipient,
    });
  }
  return entries;
}

// CharCount is gone with the length caps: with no ceiling there is nothing
// to count down to, and a live character count on an unlimited field is
// noise without information.

export default function AdminNotificationsPage() {
  const { socket, status } = useSocket(true);

  /* -------------------------------------------------------------- composer */

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("ALL");
  /** The found student, when the audience is "One student". */
  const [target, setTarget] = useState<LookedUpUser | null>(null);

  const [sending, setSending] = useState(false);
  /** Error copy — validation misses, socket rejections, REST failures. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The brief "Sent to N students" line after a successful send. */
  const [confirmation, setConfirmation] = useState<string | null>(null);

  /**
   * The payload most recently handed to the socket, kept so the listener
   * below can tell its own send's notification:sent / chat:error apart from
   * events this page has no stake in — and so an ambiguous disconnect can
   * say what was at stake. Cleared the moment any answer arrives.
   */
  const pendingRef = useRef<{ title: string; body: string } | null>(null);
  /** The silence guard described at SEND_TIMEOUT_MS. */
  const sendTimerRef = useRef<number | null>(null);
  /** Auto-dismiss timer for the confirmation line. */
  const confirmTimerRef = useRef<number | null>(null);

  const online = status === "online";

  /* -------------------------------------------------------------- history */

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications", {
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setHistoryError("Recent sends could not be loaded. Please try again.");
        return;
      }
      const rows =
        isRecord(payload) && Array.isArray(payload.notifications)
          ? payload.notifications
          : [];
      const parsed: NotificationRow[] = [];
      for (const raw of rows) {
        const row = asNotificationRow(raw);
        if (row) parsed.push(row);
      }
      setHistory(groupHistory(parsed));
      setHistoryError(null);
    } catch {
      setHistoryError("Could not reach the server. Check your connection.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  /* ------------------------------------------------------------------ send */

  const clearSendTimer = useCallback(() => {
    if (sendTimerRef.current !== null) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }, []);

  /**
   * The shared success path for both channels: show the count, reset the
   * composer, and refresh the history — the rows are the source of truth, so
   * the list is refetched rather than optimistically edited (a broadcast adds
   * one row per student, which the client cannot predict without the server's
   * answer anyway).
   */
  const finishSend = useCallback(
    (count: number | null) => {
      setSending(false);
      setConfirmation(
        count === null
          ? "Sent."
          : `Sent to ${count} student${count === 1 ? "" : "s"}.`,
      );
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = window.setTimeout(() => {
        setConfirmation(null);
        confirmTimerRef.current = null;
      }, CONFIRMATION_MS);

      setTitle("");
      setBody("");
      setTarget(null);
      void loadHistory();
    },
    [loadHistory],
  );

  /** The REST twin — the only path when the socket is down. */
  const sendViaRest = useCallback(
    async (payload: { title: string; body: string; userId?: string }) => {
      setSending(true);
      try {
        const res = await fetch("/api/admin/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        const json: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          // The route's own copy ("A title is required.", "No active student
          // recipients were found.", the rate-limit line) is human already.
          setNotice(
            readField(json, "error") ??
              "Notification could not be sent. Please try again.",
          );
          return;
        }
        const count =
          isRecord(json) && typeof json.count === "number" ? json.count : null;
        finishSend(count);
      } catch {
        setNotice("Could not reach the server. The notification was not sent.");
      } finally {
        setSending(false);
      }
    },
    [finishSend],
  );

  const send = useCallback(() => {
    if (sending) return;

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      setNotice("A title and a message are both required.");
      return;
    }
    if (audience === "ONE" && !target) {
      setNotice("Find and select the student you want to notify first.");
      return;
    }

    setNotice(null);
    setConfirmation(null);

    const payload: { title: string; body: string; userId?: string } = {
      title: trimmedTitle,
      body: trimmedBody,
    };
    if (audience === "ONE" && target) payload.userId = target.id;

    if (socket && online) {
      // Fire-and-forget, same contract as a livechat reply: the success
      // receipt is notification:sent { count }, the failure one chat:error.
      // Neither is awaited here — the listener below owns both.
      socket.emit("notification:send", payload);
      pendingRef.current = { title: payload.title, body: payload.body };
      setSending(true);
      clearSendTimer();
      sendTimerRef.current = window.setTimeout(() => {
        if (!pendingRef.current) return;
        pendingRef.current = null;
        setSending(false);
        setNotice(
          "The server took too long to confirm the send. Check Recent sends below — if it is not listed, send again.",
        );
        // The send may have landed after the silence window closed, so the
        // list the admin is being told to check is refreshed, not left stale.
        void loadHistory();
      }, SEND_TIMEOUT_MS);
      return;
    }

    void sendViaRest(payload);
  }, [
    audience,
    body,
    clearSendTimer,
    loadHistory,
    online,
    sending,
    sendViaRest,
    socket,
    target,
    title,
  ]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      send();
    },
    [send],
  );

  /* -------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!socket) return;

    function handleSent(payload: unknown): void {
      if (!pendingRef.current) return;
      pendingRef.current = null;
      clearSendTimer();
      const count =
        isRecord(payload) && typeof payload.count === "number"
          ? payload.count
          : null;
      finishSend(count);
    }

    /**
     * The socket path's only failure signal. This page has no other socket
     * traffic, so a chat:error while a send is pending is always that send's
     * answer; one arriving with nothing pending (a stray from a previous
     * page's socket, say) is ignored rather than surfaced as a mystery error.
     */
    function handleChatError(payload: unknown): void {
      if (!pendingRef.current) return;
      pendingRef.current = null;
      clearSendTimer();
      setSending(false);
      setNotice(
        readField(payload, "message") ??
          "Notification could not be sent. Please try again.",
      );
    }

    /**
     * A disconnect while a send is pending is ambiguous: the emit may already
     * have reached the server (and been persisted), or may have died on the
     * wire. Automatically retrying over REST risks duplicating a send that
     * actually landed, so instead the admin is told exactly what is uncertain
     * and where to look — the history list is the truth either way.
     */
    function handleDisconnect(): void {
      if (!pendingRef.current) return;
      pendingRef.current = null;
      clearSendTimer();
      setSending(false);
      setNotice(
        "The connection dropped before the send was confirmed. Check Recent sends below — if it is not listed, send again.",
      );
      // The emit may have reached the server before the wire died, so the
      // history is refreshed rather than assumed empty — the rows say whether
      // the send actually landed.
      void loadHistory();
    }

    socket.on("notification:sent", handleSent);
    socket.on("chat:error", handleChatError);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("notification:sent", handleSent);
      socket.off("chat:error", handleChatError);
      socket.off("disconnect", handleDisconnect);
    };
  }, [clearSendTimer, finishSend, loadHistory, socket]);

  /* --------------------------------------------------------------- render */

  const canSend =
    !sending &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (audience === "ALL" || target !== null);

  return (
    <>
      <Head>
        <title>Notifications · SpeakUp Admin</title>
      </Head>

      <AdminLayout
        title="Notifications"
        subtitle="Send a notification to every student, or just one. Delivered in-app and as a push notification."
      >
        <div className="space-y-5">
          {/* Compose */}
          <GlassCard>
            <PanelHeader
              title="Compose"
              subtitle="One title, one message — the same text goes to every recipient."
              right={
                // The badge says which channel a send will take, so the REST
                // fallback never happens invisibly.
                <span className="badge badge-neutral">
                  <span
                    className={online ? "pulse-dot" : "pulse-dot-off"}
                    aria-hidden="true"
                  />
                  {online ? "Socket live" : "Socket offline"}
                </span>
              }
            />
            <form
              className="space-y-4 px-5 py-4"
              onSubmit={handleSubmit}
              noValidate
            >
              <div>
                <label
                  className="field-label"
                  htmlFor="notification-title"
                >
                  Title
                </label>
                <input
                  id="notification-title"
                  type="text"
                  className="field"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Resumption date update"
                  autoComplete="off"
                />
              </div>

              <div>
                <label
                  className="field-label"
                  htmlFor="notification-body"
                >
                  Message
                </label>
                <textarea
                  id="notification-body"
                  className="textarea"
                  rows={8}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="What every recipient should read…"
                />
              </div>

              <fieldset>
                <legend className="field-label">Audience</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`tab ${audience === "ALL" ? "tab-active" : ""}`}
                    aria-pressed={audience === "ALL"}
                    onClick={() => setAudience("ALL")}
                  >
                    All students
                  </button>
                  <button
                    type="button"
                    className={`tab ${audience === "ONE" ? "tab-active" : ""}`}
                    aria-pressed={audience === "ONE"}
                    onClick={() => setAudience("ONE")}
                  >
                    One student
                  </button>
                </div>
              </fieldset>

              {audience === "ONE" && (
                <StudentLookup
                  target={target}
                  onFound={setTarget}
                  onClear={() => setTarget(null)}
                />
              )}

              {notice && (
                <p className="notice notice-error" role="status" aria-live="polite">
                  <span aria-hidden="true">✕</span>
                  <span className="flex-1">{notice}</span>
                  <button
                    type="button"
                    className="shrink-0 font-semibold underline underline-offset-2"
                    onClick={() => setNotice(null)}
                  >
                    Dismiss
                  </button>
                </p>
              )}

              {confirmation && (
                <p className="notice" role="status" aria-live="polite">
                  <span aria-hidden="true">✓</span>
                  <span className="flex-1">{confirmation}</span>
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <NeonButton type="submit" loading={sending} disabled={!canSend}>
                  Send notification
                </NeonButton>
              </div>
            </form>
          </GlassCard>

          {/* History */}
          <GlassCard>
            <PanelHeader
              title="Recent sends"
              subtitle="The last 50 notifications, newest first."
            />
            {historyError ? (
              <div className="px-5 py-6">
                <div className="notice notice-error" role="status">
                  <span aria-hidden="true">✕</span>
                  <span className="flex-1">{historyError}</span>
                  <button
                    type="button"
                    className="shrink-0 font-semibold underline underline-offset-2"
                    onClick={() => void loadHistory()}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : historyLoading ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                Loading recent sends…
              </p>
            ) : history.length === 0 ? (
              <EmptyState
                title="No notifications yet"
                hint="Everything you send from the composer above is listed here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {history.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-graphite">
                        {entry.title}
                      </span>
                      <span className="badge badge-neutral">
                        {entry.recipient
                          ? `${entry.recipient.name} · ${entry.recipient.studentId}`
                          : "All students"}
                      </span>
                      <time
                        dateTime={entry.createdAt}
                        className="ml-auto text-xs text-muted/70"
                      >
                        {dateTimeLabel(entry.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                      {entry.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      </AdminLayout>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* "One student" — find a student by anonymous ID or matric number            */
/* ------------------------------------------------------------------------- */

/**
 * The audience picker's targeted mode: the admin types a handle ("Anonymous
 * #42") or a matric number, presses Find, and the found student is surfaced as
 * an identity chip so the admin can confirm they reached the right person
 * before anything is sent. The chip is the selection — Clear puts the picker
 * back, and the Send button stays disabled while nothing is selected.
 *
 * Misses show human copy, never a technical error, because the input is a
 * human typing from memory (the same contract as the Messages page's lookup).
 */
function StudentLookup({
  target,
  onFound,
  onClear,
}: {
  /** The currently selected student, if any — owned by the parent, because
   *  the send needs it. */
  target: LookedUpUser | null;
  onFound: (user: LookedUpUser) => void;
  onClear: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);

  async function find(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = identifier.trim();
    if (!query || busy) return;

    setBusy(true);
    setMiss(null);
    try {
      const res = await fetch(
        `/api/admin/users/lookup?identifier=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      const payload: unknown = await res.json().catch(() => null);

      if (res.status === 404) {
        setMiss(
          readField(payload, "error") ??
            "User not found. Please check the ID or matric number and try again.",
        );
        return;
      }
      if (!res.ok || !isRecord(payload) || !isRecord(payload.user)) {
        setMiss("Something went wrong looking that up. Please try again.");
        return;
      }

      const u = payload.user;
      const id = typeof u.id === "string" ? u.id : "";
      const name = typeof u.name === "string" ? u.name : "";
      const studentId = typeof u.studentId === "string" ? u.studentId : "";
      const anonymousId =
        typeof u.anonymousId === "string" ? u.anonymousId : null;
      if (!id || !name || !studentId) {
        setMiss("Something went wrong looking that up. Please try again.");
        return;
      }

      onFound({ id, name, studentId, anonymousId });
      // The chip now carries the selection, so the input gives itself back
      // for the next lookup without an extra Clear.
      setIdentifier("");
    } catch {
      setMiss("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-veil px-4 py-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => void find(event)}
      >
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor="notification-lookup">
            Anonymous ID or matric number
          </label>
          <input
            id="notification-lookup"
            type="text"
            className="field"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Anonymous #42 or 19/52HL123"
            autoComplete="off"
          />
        </div>
        {/* Ghost, not solid: the composer's Send button is the screen's one
            loud element. */}
        <NeonButton
          type="submit"
          variant="ghost"
          loading={busy}
          disabled={!identifier.trim()}
        >
          Find student
        </NeonButton>
      </form>

      {miss && (
        <p className="mt-3 text-sm text-warn" role="status">
          {miss}
        </p>
      )}

      {target && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="badge badge-neutral">
            {target.name} · {target.studentId}
            {target.anonymousId ? ` · ${target.anonymousId}` : ""}
          </span>
          <button
            type="button"
            className="text-sm font-semibold text-muted underline underline-offset-2"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<{
  user: SessionUser;
}> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
