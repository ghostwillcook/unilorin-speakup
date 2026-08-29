import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useSession } from "next-auth/react";

import ChatShell from "@/components/ChatShell";
import { EmptyState } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { timeLabel } from "@/lib/pseudonym";
import { statusLabel, useSocket } from "@/lib/socket-client";

/**
 * Live Chat — the student's own real-time conversation with the Students
 * Affairs Unit (one conversation per student, persisted in LiveMessage).
 *
 * The REST route is the spine: history loads from /api/livechat on every mount,
 * and sends fall back to it whenever the socket is not connected — which, on a
 * cold free-tier socket server, is routine rather than exceptional. The socket
 * only ever ADDS liveness (instant echo, instant replies); it is never load-
 * bearing. That inversion of the old global-room design is what makes a
 * refresh-safe Live Chat: the database is the source of truth.
 *
 * All user-facing status copy is production copy — no npm commands, no
 * terminal instructions (the old room's messages are gone by design).
 */

const MAX_CONTENT = 4000;
const STAFF_LABEL = "Students Affairs";

interface LiveChatMessage {
  id: string;
  conversationId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLiveMessage(value: unknown): LiveChatMessage | null {
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

function byTime(a: LiveChatMessage, b: LiveChatMessage): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

export default function LiveChatPanel() {
  const { data: session, status: authStatus } = useSession();
  const { socket, status } = useSocket(true);

  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [pseudonym, setPseudonym] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);

  const userId = session?.user?.id ?? null;
  const online = status === "online";

  const mergeMessage = useCallback((incoming: LiveChatMessage) => {
    setMessages((prev) => {
      if (prev.some((row) => row.id === incoming.id)) return prev;
      return [...prev, incoming].sort(byTime);
    });
  }, []);

  /* --------------------------------------------------------------- history */

  useEffect(() => {
    if (!userId) {
      if (authStatus !== "loading") setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/livechat", {
          headers: { Accept: "application/json" },
        });
        const body: unknown = await res.json().catch(() => null);
        if (!active) return;

        if (!res.ok) {
          setError("Live chat is temporarily unavailable. Please try again.");
          return;
        }
        if (!isRecord(body)) return;

        if (typeof body.pseudonym === "string") setPseudonym(body.pseudonym);

        const rows = Array.isArray(body.messages) ? body.messages : [];
        const parsed: LiveChatMessage[] = [];
        for (const raw of rows) {
          const message = asLiveMessage(raw);
          if (message) parsed.push(message);
        }
        parsed.sort(byTime);
        setMessages(parsed);
        setError(null);
      } catch {
        if (active) {
          setError("Could not reach the server. Check your connection.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [authStatus, reloadKey, userId]);

  /* -------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!socket || !userId) return;

    function handleNew(payload: unknown): void {
      const message = asLiveMessage(payload);
      if (message) mergeMessage(message);
    }
    function handleConversation(payload: unknown): void {
      if (isRecord(payload) && typeof payload.pseudonym === "string") {
        setPseudonym(payload.pseudonym);
      }
    }

    socket.on("livechat:new", handleNew);
    socket.on("livechat:conversation", handleConversation);

    // Announce interest so the server can room this socket. Safe to repeat:
    // join is idempotent and re-fires on reconnect.
    socket.emit("livechat:join", {});

    return () => {
      socket.off("livechat:new", handleNew);
      socket.off("livechat:conversation", handleConversation);
    };
  }, [mergeMessage, socket, userId]);

  /* ---------------------------------------------------------------- scroll */

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

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
      setDraft(el.value.slice(0, MAX_CONTENT));
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
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
    if (!userId || sending) return;
    const content = draft.trim();
    if (!content) return;

    setError(null);

    // Live path: the server writes the row and echoes livechat:new back.
    if (socket && online) {
      socket.emit("livechat:send", { content });
      clearComposer();
      return;
    }

    // REST path — identical row, identical persistence. The user is told
    // nothing about transport: from here a message is a message.
    setSending(true);
    try {
      const res = await fetch("/api/livechat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError("Message could not be sent. Please try again.");
        return;
      }
      const message = isRecord(body) ? asLiveMessage(body.message) : null;
      if (message) mergeMessage(message);
      clearComposer();
    } catch {
      setError("Could not reach the server. Your message was not sent.");
    } finally {
      setSending(false);
    }
  }, [clearComposer, draft, mergeMessage, online, sending, socket, userId]);

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

  /* ---------------------------------------------------------------- render */

  const canSend = Boolean(userId) && !sending && draft.trim().length > 0;

  return (
    <ChatShell
      title="Live Chat"
      subtitle="A private conversation with the Students Affairs Unit."
      badge={
        <span className="badge badge-neutral">
          <span
            className={online ? "pulse-dot" : "pulse-dot-off"}
            aria-hidden="true"
          />
          {status === "connecting" ? "Connecting…" : online ? "Live" : statusLabel(status)}
        </span>
      }
      footer={
        error ? (
          <div className="border-t border-line px-5 py-3">
            <div className="notice notice-error" role="status" aria-live="polite">
              <span aria-hidden="true">✕</span>
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setReloadKey((key) => key + 1);
                }}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          </div>
        ) : undefined
      }
      composer={
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t border-line px-5 py-4"
        >
          <label htmlFor="livechat-composer" className="sr-only">
            Message the Students Affairs Unit
          </label>
          <textarea
            id="livechat-composer"
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CONTENT}
            disabled={!userId}
            placeholder={
              userId ? "Write to the Unit…  (Enter to send)" : "Sign in to chat"
            }
            className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto disabled:cursor-not-allowed disabled:opacity-50"
          />
          <NeonButton type="submit" disabled={!canSend} loading={sending}>
            Send
          </NeonButton>
        </form>
      }
    >
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        role="log"
        aria-label="Conversation with Students Affairs"
      >
        {loading ? (
          <p className="px-1 py-10 text-center text-sm text-muted">
            Loading the conversation…
          </p>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            hint={`This is your private line to the ${STAFF_LABEL} Unit. ${
              pseudonym ? `You appear as ${pseudonym}. ` : ""
            }Say hello — a real person answers.`}
          />
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => {
              const mine = message.senderRole === "STUDENT";
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
                      {mine ? "You" : STAFF_LABEL}
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
  );
}
