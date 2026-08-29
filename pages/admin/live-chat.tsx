import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";

import AdminLayout from "@/components/AdminLayout";
import ChatShell from "@/components/ChatShell";
import { EmptyState } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { requirePage, isRedirect, type SessionUser } from "@/lib/guards";
import { timeLabel, dateTimeLabel } from "@/lib/pseudonym";
import { useSocket } from "@/lib/socket-client";

/**
 * Admin Live Chat — the inbox and the conversation, not the logs.
 *
 * Two panes on desktop (conversations / open thread), one on mobile (inbox;
 * tapping a conversation opens the full-screen ChatShell). Everything the
 * admin does here is REST-backed: the inbox loads from
 * /api/admin/livechat, the thread from /api/admin/livechat/[id], replies over
 * POST. The socket adds the live echo (livechat:new, livechat:inbox) so
 * connected admins see new student messages instantly — and a cold socket
 * costs nothing but that instant, because the next inbox refresh has the row.
 *
 * Chat Logs (/admin/chat-logs) remains the separate historical record; this
 * page is where a student's message is actually answered.
 */

interface InboxConversation {
  id: string;
  pseudonym: string;
  status: "OPEN" | "WAITING" | "CLOSED";
  adminUnread: number;
  userUnread: number;
  student: { id: string; name: string; studentId: string };
  lastMessage: {
    content: string;
    senderRole: string;
    createdAt: string;
  } | null;
  updatedAt: string;
}

interface ThreadMessage {
  id: string;
  conversationId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

const STAFF_LABEL = "Student Affairs";
const STATUS_VALUES = ["OPEN", "WAITING", "CLOSED"] as const;
type LiveStatus = (typeof STATUS_VALUES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInbox(value: unknown): InboxConversation | null {
  if (!isRecord(value)) return null;
  const { id, pseudonym, status, adminUnread, userUnread, student, lastMessage, updatedAt } = value;
  if (
    typeof id !== "string" ||
    typeof pseudonym !== "string" ||
    typeof updatedAt !== "string" ||
    !isRecord(student) ||
    typeof student.id !== "string" ||
    typeof student.name !== "string" ||
    typeof student.studentId !== "string"
  ) {
    return null;
  }
  if (status !== "OPEN" && status !== "WAITING" && status !== "CLOSED") return null;
  const last =
    isRecord(lastMessage) &&
    typeof lastMessage.content === "string" &&
    typeof lastMessage.createdAt === "string"
      ? {
          content: lastMessage.content,
          senderRole: typeof lastMessage.senderRole === "string" ? lastMessage.senderRole : "",
          createdAt: lastMessage.createdAt,
        }
      : null;
  return {
    id,
    pseudonym,
    status,
    adminUnread: typeof adminUnread === "number" ? adminUnread : 0,
    userUnread: typeof userUnread === "number" ? userUnread : 0,
    student: { id: student.id, name: student.name, studentId: student.studentId },
    lastMessage: last,
    updatedAt,
  };
}

function asThreadMessage(value: unknown): ThreadMessage | null {
  if (!isRecord(value)) return null;
  const { id, conversationId, senderRole, content, createdAt } = value;
  if (
    typeof id !== "string" ||
    typeof conversationId !== "string" ||
    typeof content !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  if (senderRole !== "STUDENT" && senderRole !== "ADMIN") return null;
  return { id, conversationId, senderRole, content, createdAt };
}

function byTime(a: ThreadMessage, b: ThreadMessage): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

function preview(text: string): string {
  const t = text.trim();
  return t.length > 64 ? `${t.slice(0, 64)}…` : t;
}

export default function AdminLiveChatPage({ user }: { user: SessionUser }) {
  const { socket, status } = useSocket(true);

  const [inbox, setInbox] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);
  /**
   * The reply text most recently handed to the socket, kept so a chat:error
   * can put it back in the composer if the server rejects it. Cleared when
   * the livechat:new echo of that reply confirms it was persisted.
   */
  const lastReplyRef = useRef<string | null>(null);

  const online = status === "online";
  const selected = inbox.find((c) => c.id === selectedId) ?? null;

  /* ---------------------------------------------------------------- inbox */

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/livechat", {
        headers: { Accept: "application/json" },
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError("Live chat could not be loaded. Please try again.");
        return;
      }
      const rows =
        isRecord(body) && Array.isArray(body.conversations)
          ? body.conversations
          : [];
      const parsed: InboxConversation[] = [];
      for (const raw of rows) {
        const row = asInbox(raw);
        if (row) parsed.push(row);
      }
      setInbox(parsed);
      setError(null);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox, reloadKey]);

  /* --------------------------------------------------------------- thread */

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    let active = true;
    setThreadLoading(true);
    setThreadError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/admin/livechat/${encodeURIComponent(selectedId)}`, {
          headers: { Accept: "application/json" },
        });
        const body: unknown = await res.json().catch(() => null);
        if (!active) return;

        if (!res.ok) {
          setThreadError("This conversation could not be loaded.");
          return;
        }
        const rows =
          isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
        const parsed: ThreadMessage[] = [];
        for (const raw of rows) {
          const message = asThreadMessage(raw);
          if (message) parsed.push(message);
        }
        parsed.sort(byTime);
        setMessages(parsed);

        // This GET is the read receipt — it clears the conversation's
        // adminUnread server-side — so the badge is zeroed locally at the
        // same moment rather than lingering until some unrelated inbox
        // refresh happens to run. Doing it on success (not on selection)
        // keeps a failed load from dismissing a badge for messages nobody
        // actually read.
        setInbox((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, adminUnread: 0 } : c)),
        );
      } catch {
        if (active) setThreadError("Could not reach the server.");
      } finally {
        if (active) setThreadLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedId]);

  const mergeMessage = useCallback((incoming: ThreadMessage) => {
    setMessages((prev) => {
      if (prev.some((row) => row.id === incoming.id)) return prev;
      return [...prev, incoming].sort(byTime);
    });
  }, []);

  const openConversation = useCallback((id: string) => {
    setSelectedId(id);
    setDraft("");
    nearBottom.current = true;
  }, []);

  /* -------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!socket) return;

    function handleNew(payload: unknown): void {
      const message = asThreadMessage(payload);
      if (!message) return;
      if (message.conversationId === selectedIdRef.current) {
        mergeMessage(message);
        // The echo of the Unit's own reply is the proof it was persisted,
        // so the text stashed for chat:error recovery is spent.
        if (message.senderRole === "ADMIN") {
          lastReplyRef.current = null;
        }
      }
    }

    // A student message anywhere: refresh the inbox (badges, previews,
    // ordering). Cheap — one GET, and only on actual events.
    function handleInbox(): void {
      void loadInbox();
    }

    /**
     * The reply path over the socket is fire-and-forget: failures come back
     * as chat:error, and without this listener a rejected reply would simply
     * vanish — the draft is cleared on emit, so the admin loses both the
     * message and the text. Surface the reason through the shell's error
     * notice and hand the lost text back to the composer, but only if it is
     * empty — a reply already being retyped must never be overwritten by the
     * one that failed.
     */
    function handleChatError(payload: unknown): void {
      const reason =
        isRecord(payload) &&
        typeof payload.message === "string" &&
        payload.message.trim()
          ? payload.message
          : null;
      setThreadError(reason ?? "Message could not be sent. Please try again.");
      const lost = lastReplyRef.current;
      lastReplyRef.current = null;
      if (lost) {
        setDraft((current) => (current.trim() ? current : lost));
      }
    }

    // After a reconnect the server holds a fresh socket with no room
    // memberships: without re-joining live:<id> here the open thread would
    // silently stop receiving while livechat:inbox — broadcast to the
    // "admins" room, which the connection handler re-joins automatically —
    // still bumps the list. join() is idempotent, so this is free.
    function handleReconnect(): void {
      // The guard above narrowed `socket`, but that narrowing does not follow
      // into a nested function body, so re-bind it as non-nullable here.
      const live = socket;
      if (live && selectedIdRef.current) {
        live.emit("livechat:join", { conversationId: selectedIdRef.current });
      }
    }

    socket.on("livechat:new", handleNew);
    socket.on("livechat:inbox", handleInbox);
    socket.on("chat:error", handleChatError);
    socket.on("connect", handleReconnect);

    if (selectedIdRef.current) {
      socket.emit("livechat:join", { conversationId: selectedIdRef.current });
    }

    return () => {
      socket.off("livechat:new", handleNew);
      socket.off("livechat:inbox", handleInbox);
      socket.off("chat:error", handleChatError);
      socket.off("connect", handleReconnect);
    };
  }, [loadInbox, mergeMessage, socket]);

  // The join above needs the current selection without re-subscribing.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (socket && selectedId) {
      socket.emit("livechat:join", { conversationId: selectedId });
    }
  }, [selectedId, socket]);

  /* ---------------------------------------------------------------- scroll */

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, threadLoading]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  /* -------------------------------------------------------------- composer */

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const el = event.target;
      setDraft(el.value.slice(0, 4000));
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    },
    [],
  );

  const send = useCallback(async () => {
    if (!selectedId || sending) return;
    const content = draft.trim();
    if (!content) return;

    setThreadError(null);

    if (socket && online) {
      socket.emit("livechat:reply", { conversationId: selectedId, content });
      // Stash what was handed over: the emit has no return value, so a
      // chat:error is the only signal the reply was rejected — and only this
      // ref still holds the text to put back. Spent when the livechat:new
      // echo confirms the row was written.
      lastReplyRef.current = content;
      setDraft("");
      const el = composerRef.current;
      if (el) el.style.height = "auto";
      nearBottom.current = true;
      void loadInbox();
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/admin/livechat/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ content }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setThreadError("Message could not be sent. Please try again.");
        return;
      }
      const message = isRecord(body) ? asThreadMessage(body.message) : null;
      if (message) mergeMessage(message);
      setDraft("");
      void loadInbox();
    } catch {
      setThreadError("Could not reach the server. Your message was not sent.");
    } finally {
      setSending(false);
    }
  }, [draft, loadInbox, mergeMessage, online, selectedId, sending, socket]);

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

  const changeStatus = useCallback(
    async (next: LiveStatus) => {
      if (!selectedId || statusSaving) return;
      setStatusSaving(true);
      try {
        const res = await fetch(
          `/api/admin/livechat/${encodeURIComponent(selectedId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
          },
        );
        if (res.ok) void loadInbox();
      } catch {
        // The pill keeps its previous value; the next inbox refresh is truth.
      } finally {
        setStatusSaving(false);
      }
    },
    [loadInbox, selectedId, statusSaving],
  );

  /* ---------------------------------------------------------------- render */

  const canSend = Boolean(selectedId) && !sending && draft.trim().length > 0;

  return (
    <>
      <Head>
        <title>Live Chat · SpeakUp Admin</title>
      </Head>

      <AdminLayout
        title="Live Chat"
        subtitle={`Answer students here, in real time — signed in as ${user.name}. Chat Logs remains the historical record.`}
        right={
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Refresh
          </button>
        }
      >
        {error && (
          <div className="notice notice-error mb-5" role="status">
            <span className="flex-1">{error}</span>
            <button
              type="button"
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={() => {
                setError(null);
                setReloadKey((k) => k + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
          {/* Inbox: conversations with unread counts, previews and status. */}
          <section className="surface overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-lg font-semibold text-graphite">Conversations</h2>
              <p className="mt-0.5 text-sm text-muted">
                {online ? "Live updates on" : "Updates on refresh"}
              </p>
            </div>

            {loading ? (
              <p className="px-5 py-10 text-center text-sm text-muted">
                Loading conversations…
              </p>
            ) : inbox.length === 0 ? (
              <EmptyState
                title="No conversations yet"
                hint="When a student writes in Live Chat, their conversation appears here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {inbox.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-veil ${
                        c.id === selectedId ? "bg-veil" : ""
                      }`}
                      onClick={() => openConversation(c.id)}
                      aria-current={c.id === selectedId ? "page" : undefined}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-graphite">
                            {c.pseudonym}
                          </span>
                          <span className="truncate text-xs text-muted">
                            {c.student.name} · {c.student.studentId}
                          </span>
                          {c.adminUnread > 0 && (
                            <span className="badge badge-pending">
                              {c.adminUnread} unread
                            </span>
                          )}
                        </div>
                        {c.lastMessage && (
                          <p className="mt-1 truncate text-sm text-muted">
                            <span
                              className={
                                c.lastMessage.senderRole === "STUDENT"
                                  ? ""
                                  : "font-semibold text-accent"
                              }
                            >
                              {c.lastMessage.senderRole === "STUDENT" ? "" : "You: "}
                            </span>
                            {preview(c.lastMessage.content)}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted/70">
                          {dateTimeLabel(c.updatedAt)}
                        </p>
                      </div>
                      <StatusPill status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* The open conversation. Renders nothing until one is selected;
              full-screen on mobile via ChatShell. */}
          {selected ? (
            <ChatShell
              title={selected.pseudonym}
              subtitle={`${selected.student.name} · ${selected.student.studentId}`}
              badge={<StatusPill status={selected.status} />}
              onBack={() => setSelectedId(null)}
              footer={
                threadError ? (
                  <div className="border-t border-line px-5 py-3">
                    <div className="notice notice-error" role="status" aria-live="polite">
                      <span aria-hidden="true">✕</span>
                      <span className="flex-1">{threadError}</span>
                      <button
                        type="button"
                        className="shrink-0 font-semibold underline underline-offset-2"
                        onClick={() => setThreadError(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : undefined
              }
              composer={
                <div className="border-t border-line">
                  <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
                    {STATUS_VALUES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`tab text-xs ${
                          selected.status === s ? "tab-active" : ""
                        }`}
                        onClick={() => void changeStatus(s)}
                        disabled={statusSaving || selected.status === s}
                      >
                        {s === "OPEN" ? "Active" : s === "WAITING" ? "Waiting" : "Closed"}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={handleSubmit}
                    className="flex items-end gap-2 px-5 py-4"
                  >
                    <label htmlFor="admin-livechat-composer" className="sr-only">
                      Reply to {selected.pseudonym}
                    </label>
                    <textarea
                      id="admin-livechat-composer"
                      ref={composerRef}
                      rows={1}
                      value={draft}
                      onChange={handleDraftChange}
                      onKeyDown={handleKeyDown}
                      maxLength={4000}
                      placeholder="Type your message…  (Enter to send)"
                      className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto"
                    />
                    <NeonButton type="submit" disabled={!canSend} loading={sending}>
                      Send
                    </NeonButton>
                  </form>
                </div>
              }
            >
              <div
                ref={listRef}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                role="log"
                aria-label="Live chat conversation"
              >
                {threadLoading ? (
                  <p className="px-1 py-10 text-center text-sm text-muted">
                    Loading the conversation…
                  </p>
                ) : messages.length === 0 ? (
                  <EmptyState
                    title="No messages yet"
                    hint="When this student writes, their messages appear here."
                  />
                ) : (
                  <ul className="space-y-3">
                    {messages.map((message) => {
                      const mine = message.senderRole === "ADMIN";
                      return (
                        <li
                          key={message.id}
                          className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                        >
                          <p className="mb-1 flex items-center gap-2 text-[0.6875rem]">
                            <span
                              className={
                                mine
                                  ? "font-semibold text-graphite/75"
                                  : "font-semibold text-accent"
                              }
                            >
                              {mine ? STAFF_LABEL : selected.pseudonym}
                            </span>
                            <time
                              dateTime={message.createdAt}
                              className="text-muted/60"
                            >
                              {timeLabel(message.createdAt)}
                            </time>
                          </p>
                          <div
                            className={`bubble max-w-[85%] whitespace-pre-wrap ${
                              mine ? "bubble-self" : "bubble-staff"
                            }`}
                          >
                            {message.content}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </ChatShell>
          ) : (
            <section className="surface hidden lg:flex lg:items-center lg:justify-center">
              <div className="max-w-xs px-6 py-16 text-center">
                <p className="text-sm font-medium text-graphite/70">
                  Select a conversation to reply.
                </p>
                <p className="mt-1 text-xs text-graphite/40">
                  Unread counts and previews live in the list.
                </p>
              </div>
            </section>
          )}
        </div>
      </AdminLayout>
    </>
  );
}

function StatusPill({ status }: { status: LiveStatus }) {
  const cls =
    status === "OPEN"
      ? "badge badge-review"
      : status === "WAITING"
        ? "badge badge-pending"
        : "badge badge-neutral";
  return (
    <span className={`${cls} shrink-0`}>
      <span
        className={status === "OPEN" ? "pulse-dot" : "pulse-dot-off"}
        aria-hidden="true"
      />
      {status === "OPEN" ? "Active" : status === "WAITING" ? "Waiting" : "Closed"}
    </span>
  );
}

export const getServerSideProps: GetServerSideProps<{
  user: SessionUser;
}> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
