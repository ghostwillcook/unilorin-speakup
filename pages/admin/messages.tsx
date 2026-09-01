import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";

import AdminLayout from "@/components/AdminLayout";
import ChatShell from "@/components/ChatShell";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { requirePage, isRedirect, type SessionUser } from "@/lib/guards";
import { timeLabel, dateTimeLabel } from "@/lib/pseudonym";
import { useSocket } from "@/lib/socket-client";

/**
 * Admin Messages — the inbox and the conversation, not the logs.
 *
 * The old DM page and the old Live Chat page were merged: every private
 * conversation between a student and the Unit is a LiveConversation now, so
 * this is the single pane of glass over all of them. Two panes on desktop
 * (conversations / open thread), one on mobile (inbox; tapping a conversation
 * opens the full-screen ChatShell). Everything the admin does here is
 * REST-backed: the inbox loads from /api/admin/livechat, the thread from
 * /api/admin/livechat/[id], replies over POST. The socket adds the live echo
 * (livechat:new, livechat:inbox, livechat:deleted) so connected admins see
 * new student messages instantly — and a cold socket costs nothing but that
 * instant, because the next inbox refresh has the row.
 *
 * Two things live here that the old Live Chat page did not have:
 *
 *   - "Message a User" — the DM page's lookup card. The admin finds a student
 *     by anonymous ID or matric number and is dropped into their conversation.
 *     The inbox is conversation-based (not ?student=-based like the old DM
 *     page), so the found user is resolved to a conversation by refetching
 *     the inbox and matching on student id; a student who has never written
 *     has no conversation to open (one is created lazily by their first
 *     message), and the card says so instead of dead-ending.
 *
 *   - Message deletion (moderation). An admin may delete ANY message in any
 *     conversation — a student's or the Unit's own. The gesture is optimistic
 *     (the bubble leaves immediately), travels over livechat:delete when the
 *     socket is warm or DELETE /api/livechat/messages/[id] when it is not,
 *     and the livechat:deleted broadcast removes the row from every other
 *     open client too.
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

/** A student found through the "Message a User" lookup. */
interface LookedUpUser {
  id: string;
  name: string;
  /** Matriculation number, i.e. User.studentId. */
  studentId: string;
  anonymousId: string | null;
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

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

export default function AdminMessagesPage() {
  const { socket, status } = useSocket(true);

  const [inbox, setInbox] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  /**
   * Bumped to re-run the thread-fetch effect without changing the selection —
   * the reconnect handler uses it to reload the open thread, because anything
   * sent during a socket outage never arrived as livechat:new and re-joining
   * the room alone does not bring those rows back.
   */
  const [threadNonce, setThreadNonce] = useState(0);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  /**
   * The "Message a User" lookup. `lookupNote` carries the outcome of
   * resolving the found student to a conversation — the "has not started one
   * yet" case above all — and renders inside the lookup card, under the
   * found-user chip it explains.
   */
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  /**
   * Moderation state: which bubble's delete action is revealed (clicking a
   * bubble shows it) and which one is awaiting the inline confirm. Revealing
   * and confirming are separate steps so a stray click on a bubble — which is
   * also how you read one on mobile — can never delete anything on its own.
   */
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);
  /**
   * The reply text most recently handed to the socket, kept so a chat:error
   * can put it back in the composer if the server rejects it. Cleared when
   * the livechat:new echo of that reply confirms it was persisted.
   */
  const lastReplyRef = useRef<string | null>(null);
  /**
   * Messages removed by this tab's own delete gesture and not yet confirmed,
   * keyed by id, kept so a failure can put the bubbles back. A Map, not a
   * single slot: deleting A then B in quick succession stashes both, and each
   * must be restorable independently — one slot would drop A when B is
   * stashed, and a chat:error would restore B (and only B) even if A was the
   * one that failed. An entry is spent when the livechat:deleted broadcast
   * (or a 200 from the REST fallback) confirms that soft delete was written.
   */
  const pendingDeletes = useRef<Map<string, ThreadMessage>>(new Map());

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
        setError("Messages could not be loaded. Please try again.");
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
  }, [selectedId, threadNonce]);

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
    // A delete gesture must never follow the admin into another student's
    // conversation — a revealed action or a half-confirmed delete aimed at
    // the previous thread's bubble would be live ammunition in the wrong one.
    setRevealedId(null);
    setConfirmingId(null);
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
     * A message was soft-deleted in the open conversation — by this tab's own
     * moderation gesture or by another admin's. The row goes from the thread
     * by id, and if this tab removed it optimistically the broadcast doubles
     * as the success receipt (the stash for chat:error recovery is spent).
     * The inbox refresh matters because the deleted row may be the one the
     * conversation's preview was showing.
     */
    function handleDeleted(payload: unknown): void {
      const id =
        isRecord(payload) && typeof payload.id === "string" ? payload.id : null;
      if (!id) return;
      setMessages((prev) => prev.filter((row) => row.id !== id));
      // The broadcast doubles as the success receipt for this tab's own
      // optimistically removed rows: that delete was written, so its stash
      // entry is spent.
      pendingDeletes.current.delete(id);
      setRevealedId((current) => (current === id ? null : current));
      setConfirmingId((current) => (current === id ? null : current));
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
     *
     * The same event answers failed deletes (the delete path is just as
     * fire-and-forget): every optimistically removed bubble still stashed in
     * pendingDeletes goes back, sorted into place, so the moderation gesture
     * cannot silently eat messages the server refused to delete. All of them,
     * not just the latest — a chat:error says a socket action failed, but not
     * which one, so every unconfirmed removal is un-done.
     */
    function handleChatError(payload: unknown): void {
      const reason =
        isRecord(payload) &&
        typeof payload.message === "string" &&
        payload.message.trim()
          ? payload.message
          : null;

      const lostMessages = [...pendingDeletes.current.values()];
      pendingDeletes.current.clear();
      if (lostMessages.length > 0) {
        setMessages((prev) => {
          const byId = new Map(prev.map((row) => [row.id, row]));
          for (const lost of lostMessages) byId.set(lost.id, lost);
          return [...byId.values()].sort(byTime);
        });
      }

      const lostReply = lastReplyRef.current;
      lastReplyRef.current = null;
      if (lostReply) {
        setDraft((current) => (current.trim() ? current : lostReply));
      }

      setThreadError(reason ?? "Message could not be sent. Please try again.");
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
        // Re-joining restores the room, not the messages that were sent while
        // the socket was down — livechat:new for those never arrived, and
        // never will. Reload the open thread from the source of truth.
        setThreadNonce((n) => n + 1);
      }
    }

    socket.on("livechat:new", handleNew);
    socket.on("livechat:inbox", handleInbox);
    socket.on("livechat:deleted", handleDeleted);
    socket.on("chat:error", handleChatError);
    socket.on("connect", handleReconnect);

    if (selectedIdRef.current) {
      socket.emit("livechat:join", { conversationId: selectedIdRef.current });
    }

    return () => {
      socket.off("livechat:new", handleNew);
      socket.off("livechat:inbox", handleInbox);
      socket.off("livechat:deleted", handleDeleted);
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

  /* ------------------------------------------------------- message deletion */

  /**
   * Clicking a bubble reveals (or hides) its delete action. Reading a bubble
   * is also tapping a bubble, so reveal is deliberately inert — the trash
   * button and then an inline confirm are what arm the gesture.
   */
  const toggleReveal = useCallback((id: string) => {
    setConfirmingId(null);
    setRevealedId((current) => (current === id ? null : id));
  }, []);

  const cancelDelete = useCallback(() => {
    setConfirmingId(null);
    setRevealedId(null);
  }, []);

  /**
   * Deletes any message in the open conversation — the admin's own or the
   * student's (moderation). Removal is optimistic: the bubble leaves
   * immediately, travels over livechat:delete when the socket is warm or
   * DELETE /api/livechat/messages/[id] when it is not, and the row is stashed
   * so any failure — a chat:error from the socket path, a non-200 or a
   * network fall from the REST path — can put it back exactly where it was.
   */
  const removeMessage = useCallback(
    async (message: ThreadMessage) => {
      setConfirmingId(null);
      setRevealedId(null);
      setThreadError(null);

      setMessages((prev) => prev.filter((row) => row.id !== message.id));
      pendingDeletes.current.set(message.id, message);

      if (socket && online) {
        // Fire-and-forget, same as a reply: the livechat:deleted broadcast is
        // the success receipt, chat:error the failure one.
        socket.emit("livechat:delete", { messageId: message.id });
        return;
      }

      try {
        const res = await fetch(
          `/api/livechat/messages/${encodeURIComponent(message.id)}`,
          { method: "DELETE", headers: { Accept: "application/json" } },
        );
        if (!res.ok) {
          setMessages((prev) => {
            if (prev.some((row) => row.id === message.id)) return prev;
            return [...prev, message].sort(byTime);
          });
          setThreadError("Message could not be deleted. Please try again.");
          return;
        }
        pendingDeletes.current.delete(message.id);
        // The preview may have pointed at the removed row.
        void loadInbox();
      } catch {
        setMessages((prev) => {
          if (prev.some((row) => row.id === message.id)) return prev;
          return [...prev, message].sort(byTime);
        });
        setThreadError("Could not reach the server. The message was not deleted.");
      }
    },
    [loadInbox, online, socket],
  );

  /* ---------------------------------------------------------------- lookup */

  /**
   * Resolves a lookup hit to a conversation. The inbox is conversation-based,
   * so the found User.id has to be matched against a fresh inbox fetch — the
   * copy on screen may predate the student's first message (or be stale in
   * either direction), and the selection needs the row present to render its
   * header at all. The fetched rows are kept: they are server truth and at
   * least as fresh as what was on screen.
   *
   * A student who has never written has no conversation — one is created
   * lazily by their first message — so there is nothing to select. The card
   * says so instead of dead-ending, and the found-user chip stays so the
   * admin can confirm they reached the right person.
   */
  const handleLookupFound = useCallback(
    async (found: LookedUpUser) => {
      setLookupNote(null);
      setLookupBusy(true);
      try {
        const res = await fetch("/api/admin/livechat", {
          headers: { Accept: "application/json" },
        });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setLookupNote("Their conversation could not be loaded. Please try again.");
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

        const match = parsed.find((c) => c.student.id === found.id);
        if (match) {
          openConversation(match.id);
        } else {
          setLookupNote(
            "This student has not started a conversation yet. They will appear here once they write.",
          );
        }
      } catch {
        setLookupNote("Could not reach the server. Please try again.");
      } finally {
        setLookupBusy(false);
      }
    },
    [openConversation],
  );

  /* ---------------------------------------------------------------- render */

  const canSend = Boolean(selectedId) && !sending && draft.trim().length > 0;

  return (
    <>
      <Head>
        <title>Messages · Student Connect Admin</title>
      </Head>

      <AdminLayout
        title="Messages"
        subtitle="Every private conversation between a student and the Unit."
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

        <MessageALookup
          onFound={(found) => void handleLookupFound(found)}
          note={lookupNote}
          resolving={lookupBusy}
        />

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
                hint="When a student writes to the Unit, their conversation appears here."
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
                    <label htmlFor="admin-messages-composer" className="sr-only">
                      Reply to {selected.pseudonym}
                    </label>
                    <textarea
                      id="admin-messages-composer"
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
                aria-label="Messages conversation"
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
                      const revealed = revealedId === message.id;
                      const confirming = confirmingId === message.id;
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
                          {/* The bubble is the reveal affordance: tapping it
                              (a tap is also how you read one on mobile) shows
                              the delete action beside it. flex-row-reverse on
                              the Unit's own bubbles keeps the action hugging
                              the screen edge either way. */}
                          <div
                            className={`flex max-w-[85%] items-center gap-1.5 ${
                              mine ? "flex-row-reverse" : ""
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleReveal(message.id)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  toggleReveal(message.id);
                                }
                              }}
                              className={`bubble whitespace-pre-wrap ${
                                mine ? "bubble-self" : "bubble-staff"
                              }`}
                            >
                              {message.content}
                            </div>

                            {revealed && !confirming && (
                              <button
                                type="button"
                                className="btn-icon h-8 w-8 shrink-0 rounded-full"
                                aria-label={`Delete this message from ${
                                  mine ? STAFF_LABEL : selected.pseudonym
                                }`}
                                onClick={() => setConfirmingId(message.id)}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="h-4 w-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.6}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
                                  <path d="M6.5 7l.8 11a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-11" />
                                  <path d="M10.25 10.75v5M13.75 10.75v5" />
                                </svg>
                              </button>
                            )}

                            {/* Inline confirm — no window.confirm, so the
                                gesture stays inside the conversation frame
                                on mobile, and the two buttons are real
                                controls rather than a browser dialog the
                                admin cannot style or read quickly. */}
                            {confirming && (
                              <span className="flex shrink-0 items-center gap-2 text-xs">
                                <span className="text-muted">Delete?</span>
                                <button
                                  type="button"
                                  className="font-semibold text-danger underline underline-offset-2"
                                  onClick={() => void removeMessage(message)}
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  className="font-semibold text-muted underline underline-offset-2"
                                  onClick={cancelDelete}
                                >
                                  Keep
                                </button>
                              </span>
                            )}
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

/* ------------------------------------------------------------------------- */
/* "Message a User" — find a student by anonymous ID or matric number          */
/* ------------------------------------------------------------------------- */

/**
 * The admin types a handle ("Anonymous #42") or a matric number, presses
 * Find, and the found user is surfaced as a small identity chip so the admin
 * can confirm they reached the right person before anything opens.
 *
 * Opening is the parent's job, because the parent owns the inbox: the merged
 * Messages inbox is conversation-based, so "open this student" means
 * resolving them to a conversation — which only the parent can do. The
 * outcome of that resolution comes back as `note` (a student who has never
 * written has no conversation yet, so there is nothing to open).
 *
 * Misses show human copy, never a technical error, because the input is a
 * human typing from memory.
 */
function MessageALookup({
  onFound,
  note,
  resolving,
}: {
  onFound: (user: LookedUpUser) => void;
  /** Outcome of resolving the last found user to a conversation, if any. */
  note?: string | null;
  /** True while the parent resolves the found user to a conversation. */
  resolving?: boolean;
}) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { state: "idle" }
    | { state: "not-found"; message: string }
    | { state: "found"; user: LookedUpUser }
  >({ state: "idle" });

  async function find(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = identifier.trim();
    if (!query || busy) return;

    setBusy(true);
    setResult({ state: "idle" });
    try {
      const res = await fetch(
        `/api/admin/users/lookup?identifier=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      const body: unknown = await res.json().catch(() => null);

      if (res.status === 404) {
        setResult({
          state: "not-found",
          message:
            readField(body, "error") ??
            "User not found. Please check the ID or matric number and try again.",
        });
        return;
      }
      if (!res.ok || !isRecord(body) || !isRecord(body.user)) {
        setResult({
          state: "not-found",
          message: "Something went wrong looking that up. Please try again.",
        });
        return;
      }

      const u = body.user;
      const id = typeof u.id === "string" ? u.id : "";
      const name = typeof u.name === "string" ? u.name : "";
      const studentId = typeof u.studentId === "string" ? u.studentId : "";
      const anonymousId = typeof u.anonymousId === "string" ? u.anonymousId : null;
      if (!id || !name || !studentId) {
        setResult({
          state: "not-found",
          message: "Something went wrong looking that up. Please try again.",
        });
        return;
      }

      setResult({ state: "found", user: { id, name, studentId, anonymousId } });
    } catch {
      setResult({
        state: "not-found",
        message: "Could not reach the server. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="mb-5">
      <PanelHeader
        title="Message a User"
        subtitle="Find a student by anonymous ID or matric number, and open their conversation."
      />
      <form className="flex flex-wrap items-end gap-3 px-5 py-4" onSubmit={(e) => void find(e)}>
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor="lookup-identifier">
            Anonymous ID or matric number
          </label>
          <input
            id="lookup-identifier"
            type="text"
            className="field"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Anonymous #42 or 19/52HL123"
            autoComplete="off"
          />
        </div>
        <NeonButton type="submit" loading={busy} disabled={!identifier.trim()}>
          Find user
        </NeonButton>
      </form>

      {result.state === "not-found" && (
        <p className="px-5 pb-4 text-sm text-warn" role="status">
          {result.message}
        </p>
      )}

      {result.state === "found" && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5">
            <span className="badge border border-line bg-veil text-graphite">
              {result.user.name} · {result.user.studentId}
              {result.user.anonymousId ? ` · ${result.user.anonymousId}` : ""}
            </span>
            <NeonButton
              type="button"
              className="px-3 py-1.5 text-xs"
              loading={resolving}
              disabled={resolving}
              onClick={() => onFound(result.user)}
            >
              Open their conversation
            </NeonButton>
          </div>
          {/* The resolution note rides in the card, right under the chip it
              explains — most often "no conversation yet", which is not an
              error, so muted text rather than a red notice. */}
          {note && (
            <p className="border-t border-line px-5 py-3 text-sm text-muted" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </GlassCard>
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
