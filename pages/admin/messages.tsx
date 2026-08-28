import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { isRedirect, requirePage } from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
import { dateTimeLabel, timeLabel } from "@/lib/pseudonym";
import { statusLabel, useSocket } from "@/lib/socket-client";
import type { DmMessage } from "@/lib/socket-client";

/**
 * The Students Affairs Unit's direct-message inbox.
 *
 * Two panes: derived threads on the left, the open conversation on the right.
 * Threads are not rows in the schema — /api/dm folds messages down per student —
 * so this page never invents a thread id: the selector is always a **User.id**,
 * which is also what /api/dm/[studentId] takes.
 *
 * Selection lives in the URL (`?student=<User.id>`) rather than in state. That
 * makes a thread linkable from anywhere in the console, survives back/forward,
 * and removes the usual query-vs-state divergence — with `shallow: true` no
 * server round trip is paid for it.
 *
 * Delivery is dual-path for the same reason as the student panel: the socket
 * server is a separate process that may not be running, and an unanswered
 * student is a product failure, not an infrastructure one. When the socket is
 * down the reply goes out over POST /api/dm/[studentId] and persists
 * identically — only the instant echo is lost.
 */

/** Mirrors MAX_DM_LENGTH in server/socket.mjs and MAX_CONTENT in the REST route. */
const MAX_DM_LENGTH = 4000;

/** How much of a thread's latest message the list preview keeps. */
const PREVIEW_CHARS = 120;

const NEAR_BOTTOM_PX = 96;
const COMPOSER_MAX_PX = 132;

const STAFF_LABEL = "Students Affairs";

interface DmThread {
  /** User.id of the thread owner. */
  studentId: string;
  studentName: string;
  studentEmail: string;
  /** Matriculation number, i.e. User.studentId. */
  studentNumber: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

/** A bubble that may still be awaiting the server's echo. */
interface ThreadMessage extends DmMessage {
  /** True for an optimistic row whose real id has not arrived yet. */
  pending?: boolean;
}

interface Props {
  user: SessionUser;
}

/* ------------------------------------------------------------------------- */
/* Response narrowing — every payload here is untrusted input.                */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asThread(value: unknown): DmThread | null {
  if (!isRecord(value)) return null;
  const studentId = asText(value.studentId);
  if (!studentId) return null;

  const unread = value.unread;
  return {
    studentId,
    studentName: asText(value.studentName) || "Unnamed student",
    studentEmail: asText(value.studentEmail),
    studentNumber: asText(value.studentNumber),
    lastMessage: asText(value.lastMessage),
    lastAt: asText(value.lastAt),
    unread:
      typeof unread === "number" && Number.isFinite(unread) && unread > 0
        ? Math.floor(unread)
        : 0,
  };
}

function asThreads(value: unknown): DmThread[] {
  const list: unknown[] =
    isRecord(value) && Array.isArray(value.threads) ? value.threads : [];
  const rows: DmThread[] = [];
  for (const raw of list) {
    const row = asThread(raw);
    if (row) rows.push(row);
  }
  return rows;
}

function asDmMessage(value: unknown): DmMessage | null {
  if (!isRecord(value)) return null;
  const { id, studentId, senderRole, content, createdAt, studentName } = value;
  if (
    typeof id !== "string" ||
    typeof studentId !== "string" ||
    typeof content !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  if (senderRole !== "STUDENT" && senderRole !== "ADMIN") return null;

  const message: DmMessage = { id, studentId, senderRole, content, createdAt };
  if (typeof studentName === "string") message.studentName = studentName;
  return message;
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

/* ------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* ------------------------------------------------------------------------- */

/** ISO timestamps sort lexicographically, so id only breaks exact ties. */
function byTime(a: ThreadMessage, b: ThreadMessage): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

/** Newest thread first — the ordering /api/dm already returns. */
function byRecency(a: DmThread, b: DmThread): number {
  if (a.lastAt === b.lastAt) return a.studentId.localeCompare(b.studentId);
  return a.lastAt < b.lastAt ? 1 : -1;
}

/** One-line preview: newlines collapsed so a pasted essay stays one row tall. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "No message content";
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS - 1)}…`
    : flat;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Folds a server message into the open thread.
 *
 * De-duplication is by id, which covers the socket echo of a row this tab just
 * created over REST. The pending sweep is the other half: an optimistic bubble
 * has a client-side id that will never match, so the echo it confirms is
 * matched on sender and content instead and replaces it — otherwise the reply
 * would appear twice, once forever unconfirmed.
 */
function mergeMessage(
  list: ThreadMessage[],
  incoming: DmMessage,
): ThreadMessage[] {
  if (list.some((row) => row.id === incoming.id)) return list;

  const settled = list.filter(
    (row) =>
      !(
        row.pending === true &&
        row.senderRole === incoming.senderRole &&
        row.content === incoming.content
      ),
  );
  return [...settled, incoming].sort(byTime);
}

/* ------------------------------------------------------------------------- */

export default function AdminMessages({ user }: Props) {
  const router = useRouter();
  const { socket, status } = useSocket(true);

  const [threads, setThreads] = useState<DmThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);
  /** Bumped by Refresh to re-run the inbox load. */
  const [nonce, setNonce] = useState(0);

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadNonce, setThreadNonce] = useState(0);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);

  /**
   * Mirror of `messages` for socket handlers that must read the current bubbles
   * synchronously. Reading through the ref keeps them out of the listener's
   * dependency list, so the subscription is not torn down and rebuilt on every
   * message that arrives.
   */
  const messagesRef = useRef<ThreadMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const online = status === "online";
  /** "connecting" is not a failure yet, so the fallback notice waits it out. */
  const liveOff = status === "offline" || status === "idle";

  // Selection is read straight from the URL, so there is no second source of
  // truth to keep in sync with it. An array query (?student=a&student=b) is
  // malformed input and reads as no selection.
  const raw = router.query.student;
  const selectedId = typeof raw === "string" && raw ? raw : null;

  const selected = useMemo(
    () => threads.find((row) => row.studentId === selectedId) ?? null,
    [selectedId, threads],
  );

  /* ------------------------------------------------------------------ inbox */

  useEffect(() => {
    const controller = new AbortController();
    setThreadsLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/dm", {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setThreads([]);
          setThreadsLoaded(false);
          setListError(
            readField(body, "error") ??
              `Could not load the inbox (${res.status}).`,
          );
          // The guard ships an actionable hint with its 503; show it verbatim.
          setSetupHint(res.status === 503 ? readField(body, "hint") : null);
          return;
        }

        setThreads(asThreads(body).sort(byRecency));
        setThreadsLoaded(true);
        setListError(null);
        setSetupHint(null);
      } catch {
        if (controller.signal.aborted) return;
        setThreads([]);
        setThreadsLoaded(false);
        setSetupHint(null);
        setListError(
          "Could not reach the server. Check that `npm run dev` is running.",
        );
      } finally {
        if (!controller.signal.aborted) setThreadsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [nonce]);

  /* ----------------------------------------------------------------- thread */

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setThreadError(null);
      setThreadLoading(false);
      return;
    }

    const controller = new AbortController();
    setThreadLoading(true);
    setSendError(null);
    setThreadError(null);
    nearBottom.current = true;

    // Drop bubbles belonging to a thread that is no longer open. Without this,
    // the previous student's messages stay on screen for the whole round trip
    // and — because the bubble labels fall back to the selected thread's name —
    // are relabelled as the newly selected student's, which in an admin console
    // means one student's private messages shown as another's. Rows for *this*
    // thread are kept, so an optimistic reply or a raced live message survives.
    setMessages((current) =>
      current.every((row) => row.studentId === selectedId)
        ? current
        : current.filter((row) => row.studentId === selectedId),
    );

    void (async () => {
      try {
        const res = await fetch(`/api/dm/${encodeURIComponent(selectedId)}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setMessages([]);
          setThreadError(
            readField(body, "error") ??
              `Could not load this conversation (${res.status}).`,
          );
          return;
        }

        const rows: unknown[] =
          isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
        const parsed: ThreadMessage[] = [];
        for (const item of rows) {
          const message = asDmMessage(item);
          if (message) parsed.push(message);
        }
        parsed.sort(byTime);

        setMessages((current) => {
          // On a thread switch `current` holds the previous conversation, so
          // anything keyed to another student is dropped outright.
          const mine = current.filter((row) => row.studentId === selectedId);
          if (mine.length === 0) return parsed;

          // Otherwise a live message may have raced this request, or an
          // optimistic reply may still be awaiting its echo — replacing the
          // array outright would silently lose either. Folding the server's
          // rows in through mergeMessage keeps both and de-duplicates by id.
          let next: ThreadMessage[] = mine;
          for (const row of parsed) next = mergeMessage(next, row);
          return next;
        });
        setThreadError(null);

        // This GET is the read receipt — it just cleared the student's unread
        // messages server-side — so the badge is zeroed here rather than
        // waiting for a refresh to reveal what has already happened. Doing it
        // on success (not on selection) keeps a failed load from clearing a
        // badge for messages nobody actually read, and covers arriving by deep
        // link, where the row may not exist yet when the selection is made.
        setThreads((current) =>
          current.some((row) => row.studentId === selectedId && row.unread > 0)
            ? current.map((row) =>
                row.studentId === selectedId ? { ...row, unread: 0 } : row,
              )
            : current,
        );
      } catch {
        if (controller.signal.aborted) return;
        setMessages([]);
        setThreadError(
          "Could not reach the server to load this conversation.",
        );
      } finally {
        if (!controller.signal.aborted) setThreadLoading(false);
      }
    })();

    return () => controller.abort();
  }, [selectedId, threadNonce]);

  /**
   * Reloads the inbox and, if one is open, the conversation with it.
   *
   * Both matter when the socket is down: that is exactly when new student
   * messages do not arrive on their own, and reloading only the list would
   * update the preview while leaving the thread the admin is reading stale.
   */
  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
    setThreadNonce((value) => value + 1);
  }, []);

  /* -------------------------------------------------------------- selection */

  const select = useCallback(
    (studentId: string) => {
      if (studentId === selectedId) return;
      // Shallow: the pane fetches its own data, so re-running
      // getServerSideProps would only cost a round trip.
      void router.replace(
        { pathname: "/admin/messages", query: { student: studentId } },
        undefined,
        { shallow: true },
      );
      // A half-written reply must never follow the admin to a different
      // student, so switching threads drops the draft and the textarea's
      // grown height with it.
      setDraft("");
      const el = composerRef.current;
      if (el) el.style.height = "auto";
    },
    [router, selectedId],
  );

  const clearSelection = useCallback(() => {
    void router.replace({ pathname: "/admin/messages" }, undefined, {
      shallow: true,
    });
  }, [router]);

  /* ------------------------------------------------------------- live wires */

  useEffect(() => {
    if (!socket) return;

    // Named handlers: an inline closure would leave one live listener behind
    // per re-render, and every one of them would re-fire on the next message.
    function handleDmNew(payload: unknown): void {
      const message = asDmMessage(payload);
      if (!message) return;

      // The admin room carries every thread, so a message for the open one is
      // appended and any other only touches its row in the list.
      if (message.studentId === selectedId) {
        setMessages((current) => mergeMessage(current, message));
      }

      setThreads((current) => {
        const index = current.findIndex(
          (row) => row.studentId === message.studentId,
        );

        // A student's first ever message has no row yet. Insert one from the
        // payload so the conversation is visible now instead of after a
        // refresh; email and matric number fill in on the next inbox load.
        if (index === -1) {
          const created: DmThread = {
            studentId: message.studentId,
            studentName: message.studentName ?? "Unnamed student",
            studentEmail: "",
            studentNumber: "",
            lastMessage: message.content,
            lastAt: message.createdAt,
            unread:
              message.senderRole === "STUDENT" &&
              message.studentId !== selectedId
                ? 1
                : 0,
          };
          return [created, ...current].sort(byRecency);
        }

        const existing = current[index];
        const bump =
          message.senderRole === "STUDENT" && message.studentId !== selectedId;
        const next: DmThread = {
          ...existing,
          studentName: message.studentName ?? existing.studentName,
          lastMessage: message.content,
          lastAt: message.createdAt,
          unread: bump ? existing.unread + 1 : existing.unread,
        };
        const rest = current.filter((_, i) => i !== index);
        return [next, ...rest].sort(byRecency);
      });
    }

    /**
     * The socket path is fire-and-forget, so a rejected reply would otherwise
     * sit as a bubble that never resolves. Failed optimistic rows are dropped
     * and the text handed back to the composer, so nothing typed is lost.
     */
    function handleChatError(payload: unknown): void {
      const stuck = messagesRef.current.filter((row) => row.pending === true);
      if (stuck.length > 0) {
        const last = stuck[stuck.length - 1];
        setMessages((current) => current.filter((row) => row.pending !== true));
        // Only reclaim the composer if it is empty, so a reply already being
        // typed is never overwritten by the one that failed.
        setDraft((text) => (text.trim() ? text : last.content));
      }
      setSendError(
        readField(payload, "message") ??
          "Your reply could not be delivered. Please try again.",
      );
    }

    socket.on("dm:new", handleDmNew);
    socket.on("chat:error", handleChatError);

    return () => {
      socket.off("dm:new", handleDmNew);
      socket.off("chat:error", handleChatError);
    };
  }, [selectedId, socket]);

  /* ---------------------------------------------------------------- scroll */

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Never yank the view away from someone reading back through a thread;
    // only follow when they are already at the end.
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, threadLoading, selectedId]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  /* -------------------------------------------------------------- composer */

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const el = event.target;
      setDraft(el.value.slice(0, MAX_DM_LENGTH));
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
    },
    [],
  );

  const clearComposer = useCallback(() => {
    setDraft("");
    const el = composerRef.current;
    if (el) {
      el.style.height = "auto";
      el.focus();
    }
    nearBottom.current = true;
  }, []);

  const send = useCallback(async () => {
    if (!selectedId || sending) return;
    const content = draft.trim();
    if (!content) return;

    setSendError(null);

    // Optimistic row. The id is client-side and deliberately prefixed so it can
    // never be mistaken for a database id; mergeMessage swaps it for the real
    // row when the server confirms.
    const optimistic: ThreadMessage = {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      studentId: selectedId,
      senderRole: "ADMIN",
      content,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((current) => [...current, optimistic].sort(byTime));
    nearBottom.current = true;

    // Live path: the server writes the row and echoes "dm:new" to the student's
    // room and the admin room, so the confirmed bubble arrives through the
    // listener above.
    if (socket && online) {
      socket.emit("dm:send", { studentId: selectedId, content });
      clearComposer();
      return;
    }

    // Fallback path: same row, same shape, over plain HTTP.
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ content }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setMessages((current) =>
          current.filter((row) => row.id !== optimistic.id),
        );
        setSendError(
          readField(body, "error") ?? `Reply was not sent (${res.status}).`,
        );
        return;
      }

      const message = isRecord(body) ? asDmMessage(body.message) : null;
      if (message) {
        setMessages((current) => mergeMessage(current, message));
        setThreads((current) => {
          const index = current.findIndex(
            (row) => row.studentId === message.studentId,
          );
          if (index === -1) return current;
          const next: DmThread = {
            ...current[index],
            lastMessage: message.content,
            lastAt: message.createdAt,
          };
          const rest = current.filter((_, i) => i !== index);
          return [next, ...rest].sort(byRecency);
        });
      } else {
        // Persisted, but the shape was unexpected; drop the unconfirmable
        // bubble rather than leaving a permanent "pending" mark.
        setMessages((current) =>
          current.filter((row) => row.id !== optimistic.id),
        );
        setThreadNonce((key) => key + 1);
      }
      clearComposer();
    } catch {
      setMessages((current) =>
        current.filter((row) => row.id !== optimistic.id),
      );
      setSendError("Could not reach the server. Your reply was not sent.");
    } finally {
      setSending(false);
    }
  }, [clearComposer, draft, online, selectedId, sending, socket]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void send();
    },
    [send],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void send();
      }
    },
    [send],
  );

  /* ----------------------------------------------------------------- render */

  const unreadTotal = threads.reduce((sum, row) => sum + row.unread, 0);
  const canSend = Boolean(selectedId) && !sending && draft.trim().length > 0;

  return (
    <AdminLayout
      title="Messages"
      subtitle={`Private threads between students and the ${STAFF_LABEL} Unit. Signed in as ${user.name}.`}
      right={
        <>
          {unreadTotal > 0 && (
            <span className="badge border border-line bg-veil text-accent">
              {unreadTotal} unread
            </span>
          )}
          <span className="badge border border-line bg-veil text-muted">
            <span
              className={online ? "pulse-dot" : "pulse-dot-off"}
              aria-hidden="true"
            />
            {liveOff ? "Delivering over the web app" : statusLabel(status)}
          </span>
          <NeonButton
            variant="ghost"
            onClick={refresh}
            loading={threadsLoading || threadLoading}
          >
            Refresh
          </NeonButton>
        </>
      }
    >
      {setupHint && (
        <div className="notice notice-warn mb-5">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong className="font-semibold">Database not configured.</strong>{" "}
            {setupHint}
          </span>
        </div>
      )}

      {listError && !setupHint && (
        <div className="notice notice-error mb-5" role="status">
          <span aria-hidden="true">✕</span>
          <span>{listError}</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        {/* Left pane. On small screens the two panes take turns rather than
            stacking, so a thread is never buried under the whole inbox. */}
        <GlassCard
          className={`max-h-[34rem] flex-col overflow-hidden lg:max-h-[38rem] ${
            selectedId ? "hidden lg:flex" : "flex"
          }`}
        >
          <PanelHeader
            title="Inbox"
            subtitle="Newest activity first."
            right={
              <span className="badge border border-line bg-veil text-muted">
                {threadsLoaded
                  ? `${threads.length} thread${threads.length === 1 ? "" : "s"}`
                  : threadsLoading
                    ? "loading…"
                    : "—"}
              </span>
            }
          />

          {threads.length === 0 ? (
            <EmptyState
              title={
                listError
                  ? "Inbox unavailable"
                  : threadsLoading && !threadsLoaded
                    ? "Loading threads…"
                    : "No conversations yet"
              }
              hint={
                listError
                  ? "Resolve the problem above, then use Refresh."
                  : threadsLoading && !threadsLoaded
                    ? undefined
                    : "A thread appears here as soon as a student writes to the Unit."
              }
            />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.studentId}
                  thread={thread}
                  active={thread.studentId === selectedId}
                  onSelect={select}
                />
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Right pane. */}
        <GlassCard
          className={`h-[34rem] max-h-[80vh] flex-col overflow-hidden lg:h-[38rem] ${
            selectedId ? "flex" : "hidden lg:flex"
          }`}
        >
          {!selectedId ? (
            <>
              <PanelHeader
                title="Conversation"
                subtitle="Pick a thread to read and reply."
              />
              <div className="grid min-h-0 flex-1 place-items-center">
                <EmptyState
                  title="No thread selected"
                  hint={
                    threads.length > 0
                      ? "Choose a student from the inbox to open their private thread."
                      : "Threads appear once a student sends the Unit a message."
                  }
                />
              </div>
            </>
          ) : (
            <>
              <PanelHeader
                title={selected ? selected.studentName : "Conversation"}
                subtitle={
                  selected
                    ? [selected.studentNumber, selected.studentEmail]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    : "Opening thread…"
                }
                right={
                  <NeonButton
                    variant="ghost"
                    onClick={clearSelection}
                    className="lg:hidden"
                  >
                    Inbox
                  </NeonButton>
                }
              />

              <div
                ref={listRef}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                aria-label={
                  selected
                    ? `Conversation with ${selected.studentName}`
                    : "Conversation"
                }
                role="log"
              >
                {threadLoading && messages.length === 0 ? (
                  <p className="px-1 py-10 text-center text-sm text-muted">
                    Loading conversation…
                  </p>
                ) : threadError ? (
                  <div className="notice notice-error" role="status">
                    <span aria-hidden="true">✕</span>
                    <span className="flex-1">{threadError}</span>
                    <button
                      type="button"
                      onClick={() => setThreadNonce((key) => key + 1)}
                      className="shrink-0 font-semibold underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyState
                    title="No messages in this thread"
                    hint="Write below to open the conversation with this student."
                  />
                ) : (
                  <ul className="space-y-3">
                    {messages.map((message) => {
                      const mine = message.senderRole === "ADMIN";
                      return (
                        <li
                          key={message.id}
                          className={`flex flex-col ${
                            mine ? "items-end" : "items-start"
                          }`}
                        >
                          <p className="mb-1 flex items-center gap-2 text-[0.6875rem]">
                            <span
                              className={
                                mine
                                  ? "text-accent font-semibold"
                                  : "font-semibold text-muted"
                              }
                            >
                              {mine
                                ? STAFF_LABEL
                                : (selected?.studentName ??
                                  message.studentName ??
                                  "Student")}
                            </span>
                            <time
                              dateTime={message.createdAt}
                              className="text-muted"
                            >
                              {timeLabel(message.createdAt)}
                            </time>
                            {message.pending && (
                              <span className="text-muted">Sending…</span>
                            )}
                          </p>
                          <div
                            className={`bubble whitespace-pre-wrap ${
                              mine ? "bubble-self" : "bubble-other"
                            } ${message.pending ? "opacity-60" : ""}`}
                          >
                            {message.content}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="border-t border-line px-5 py-4">
                {liveOff && (
                  <div className="notice mb-3">
                    <span aria-hidden="true">ℹ</span>
                    <span>
                      Live delivery is off, so new student messages will not pop
                      in on their own — replies you send are still saved and
                      delivered. Use Refresh to check, or start the live server
                      with{" "}
                      <code className="rounded bg-canvas/85 px-1.5 py-0.5 font-mono text-[0.8125rem] text-accent">
                        npm run socket
                      </code>
                      .
                    </span>
                  </div>
                )}

                {sendError && (
                  <div
                    className="notice notice-error mb-3"
                    role="status"
                    aria-live="polite"
                  >
                    <span aria-hidden="true">✕</span>
                    <span>{sendError}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="flex items-end gap-2">
                  <label htmlFor="dm-reply" className="sr-only">
                    Reply to this student
                  </label>
                  <textarea
                    id="dm-reply"
                    ref={composerRef}
                    rows={1}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleKeyDown}
                    maxLength={MAX_DM_LENGTH}
                    placeholder="Reply as Students Affairs…  (Enter to send, Shift+Enter for a new line)"
                    className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto"
                  />
                  <NeonButton type="submit" disabled={!canSend} loading={sending}>
                    Send
                  </NeonButton>
                </form>

                {draft.length > MAX_DM_LENGTH - 500 && (
                  <p className="mt-2 text-right text-xs text-muted">
                    {draft.length}/{MAX_DM_LENGTH}
                  </p>
                )}
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </AdminLayout>
  );
}

/* ------------------------------------------------------------------------- */

function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: DmThread;
  active: boolean;
  onSelect: (studentId: string) => void;
}) {
  const unread = thread.unread > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(thread.studentId)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
          active
            ? "border-l-2 border-line bg-veil"
            : "border-l-2 border-transparent hover:bg-veil"
        }`}
      >
        <span
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-veil text-xs font-bold text-accent"
          aria-hidden="true"
        >
          {initials(thread.studentName)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                unread ? "font-bold text-graphite" : "font-semibold text-muted"
              }`}
            >
              {thread.studentName}
            </span>
            {unread && (
              <span
                className="badge shrink-0 border border-line bg-veil text-accent"
                aria-label={`${thread.unread} unread message${
                  thread.unread === 1 ? "" : "s"
                }`}
              >
                {thread.unread}
              </span>
            )}
          </span>

          {thread.studentNumber && (
            <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-muted">
              {thread.studentNumber}
            </span>
          )}

          <span
            className={`mt-1 block truncate text-xs ${
              unread ? "text-muted" : "text-muted"
            }`}
          >
            {preview(thread.lastMessage)}
          </span>

          {thread.lastAt && (
            <time
              dateTime={thread.lastAt}
              className="mt-1 block text-[0.6875rem] text-muted"
            >
              {dateTimeLabel(thread.lastAt)}
            </time>
          )}
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
