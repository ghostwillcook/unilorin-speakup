import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";

import ChatShell from "@/components/ChatShell";
import { EmptyState } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { timeLabel } from "@/lib/pseudonym";
import { useSocket } from "@/lib/socket-client";

/**
 * One complaint's dedicated two-way thread — the same component on the student
 * and admin consoles, because the conversation is one conversation.
 *
 * Persistence is REST-first, socket-enhanced, exactly like LiveChatPanel:
 * history from GET /api/complaints/[id]/messages, sends over the socket when
 * connected and over POST otherwise, both writing the same ComplaintMessage
 * row. Server-side authorization (student owns the complaint; admin may reply
 * in any) is the route's job — this component only renders what it is given.
 *
 * Messages cannot cross complaints: every read and write is scoped by the
 * complaintId prop, and the socket room is complaint:<id>.
 */

const MAX_CONTENT = 4000;
const STAFF_LABEL = "Students Affairs";

export interface ThreadMessage {
  id: string;
  complaintId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asThreadMessage(value: unknown): ThreadMessage | null {
  if (!isRecord(value)) return null;
  const { id, complaintId, senderRole, content, createdAt } = value;
  if (
    typeof id !== "string" ||
    typeof complaintId !== "string" ||
    typeof content !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  if (senderRole !== "STUDENT" && senderRole !== "ADMIN") return null;
  return { id, complaintId, senderRole, content, createdAt };
}

function byTime(a: ThreadMessage, b: ThreadMessage): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

export default function ComplaintThread({
  complaintId,
  viewerRole,
  title,
  subtitle,
  badge,
  context,
  onBack,
  onDismiss,
}: {
  complaintId: string;
  /** Whose bubbles sit on the right: STUDENT right-aligns own messages. */
  viewerRole: "STUDENT" | "ADMIN";
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  /**
   * The complaint's own record, rendered as the first thing in the scroll
   * area — the conversation opens referring to the message it is about,
   * rather than the record living in a separate card outside the thread.
   */
  context?: React.ReactNode;
  onBack?: () => void;
  onDismiss?: () => void;
}) {
  const { socket, status } = useSocket(true);

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);

  const online = status === "online";

  const mergeMessage = useCallback((incoming: ThreadMessage) => {
    // Defensive by design: a malformed or foreign payload can never land in
    // this thread even if a server bug broadcast it to the wrong room.
    setMessages((prev) => {
      if (incoming.complaintId !== expectedId.current) return prev;
      if (prev.some((row) => row.id === incoming.id)) return prev;
      return [...prev, incoming].sort(byTime);
    });
  }, []);

  // The merge guard needs the current complaintId without re-creating the
  // callback per id (which would churn the socket listeners below).
  const expectedId = useRef(complaintId);
  useEffect(() => {
    expectedId.current = complaintId;
  }, [complaintId]);

  /* --------------------------------------------------------------- history */

  useEffect(() => {
    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(
          `/api/complaints/${encodeURIComponent(complaintId)}/messages`,
          { headers: { Accept: "application/json" } },
        );
        const body: unknown = await res.json().catch(() => null);
        if (!active) return;

        if (!res.ok) {
          setError("This conversation could not be loaded. Please try again.");
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
  }, [complaintId, reloadKey]);

  /* -------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!socket) return;

    function handleNew(payload: unknown): void {
      const message = asThreadMessage(payload);
      if (message) mergeMessage(message);
    }

    socket.on("complaint:new", handleNew);
    socket.emit("complaint:join", { complaintId });

    return () => {
      socket.off("complaint:new", handleNew);
    };
  }, [complaintId, mergeMessage, socket]);

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
    if (sending) return;
    const content = draft.trim();
    if (!content) return;

    setError(null);

    if (socket && online) {
      socket.emit("complaint:send", { complaintId, content });
      clearComposer();
      return;
    }

    setSending(true);
    try {
      const res = await fetch(
        `/api/complaints/${encodeURIComponent(complaintId)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ content }),
        },
      );
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError("Message could not be sent. Please try again.");
        return;
      }
      const message = isRecord(body) ? asThreadMessage(body.message) : null;
      if (message) mergeMessage(message);
      clearComposer();
    } catch {
      setError("Could not reach the server. Your message was not sent.");
    } finally {
      setSending(false);
    }
  }, [clearComposer, complaintId, draft, mergeMessage, online, sending, socket]);

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

  const canSend = !sending && draft.trim().length > 0;
  const selfLabel = viewerRole === "ADMIN" ? "Students Affairs" : "You";

  return (
    <ChatShell
      title={title}
      subtitle={subtitle}
      badge={badge}
      onBack={onBack}
      onDismiss={onDismiss}
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
          <label htmlFor={`thread-composer-${complaintId}`} className="sr-only">
            Message about this complaint
          </label>
          <textarea
            id={`thread-composer-${complaintId}`}
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CONTENT}
            placeholder="Write a reply…  (Enter to send)"
            className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto"
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
        aria-label="Complaint conversation"
      >
        {/* The record the conversation is about, first in the scroll: opening
            the thread reads as opening THAT complaint's discussion. */}
        {context}

        {loading ? (
          <p className="px-1 py-10 text-center text-sm text-muted">
            Loading the conversation…
          </p>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No replies yet"
            hint={
              viewerRole === "STUDENT"
                ? "Anything you add here goes straight to the Unit about this complaint."
                : "Reply to the student about this complaint — your message lands in their thread."
            }
          />
        ) : (
          <ul className="space-y-3">
            {messages.map((message) => {
              const mine = message.senderRole === viewerRole;
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
                      {mine ? selfLabel : STAFF_LABEL}
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
