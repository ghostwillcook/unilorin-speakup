import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { useSession } from "next-auth/react";

import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { timeLabel } from "@/lib/pseudonym";
import { statusLabel, useSocket } from "@/lib/socket-client";
import type { DmMessage } from "@/lib/socket-client";

/**
 * The student's private thread with the Students Affairs Unit.
 *
 * Deliberately dual-path: the socket server carries live delivery, but it is a
 * separate process that may simply not be running, and a student in distress
 * must never be told to come back later. When the socket is down the same
 * message goes out over POST /api/dm/[studentId] and persists identically, so
 * nothing is lost — only the instant echo is.
 */

/** Mirrors MAX_DM_LENGTH in server/socket.mjs and the REST route. */
const MAX_DM_LENGTH = 4000;

const NEAR_BOTTOM_PX = 96;
const COMPOSER_MAX_PX = 132;

const STAFF_LABEL = "Students Affairs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Both the REST body and the socket payload are untrusted until narrowed. */
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

function readApiError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === "string" && value.error.trim()) {
    return value.error;
  }
  return fallback;
}

/** ISO timestamps sort lexicographically, so id only breaks exact ties. */
function byTime(a: DmMessage, b: DmMessage): number {
  if (a.createdAt === b.createdAt) return a.id.localeCompare(b.id);
  return a.createdAt < b.createdAt ? -1 : 1;
}

export default function DMPanel() {
  const { data: session, status: authStatus } = useSession();
  const { socket, status } = useSocket(true);

  const [messages, setMessages] = useState<DmMessage[]>([]);
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
  /** "connecting" is not a failure yet, so the fallback notice waits it out. */
  const liveOff = status === "offline" || status === "idle";

  /** Single merge point, so a REST insert and a socket echo of the same row
   *  collapse into one bubble instead of two. */
  const mergeMessage = useCallback((incoming: DmMessage) => {
    setMessages((prev) => {
      if (prev.some((row) => row.id === incoming.id)) return prev;
      return [...prev, incoming].sort(byTime);
    });
  }, []);

  /* --------------------------------------------------------------- history */

  useEffect(() => {
    if (!userId) {
      // Still resolving the session, or signed out; nothing to fetch yet.
      if (authStatus !== "loading") setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(`/api/dm/${encodeURIComponent(userId)}`, {
          headers: { Accept: "application/json" },
        });
        const body: unknown = await res.json().catch(() => null);
        if (!active) return;

        if (!res.ok) {
          setError(readApiError(body, "Could not load your conversation."));
          return;
        }

        const rows =
          isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
        const parsed: DmMessage[] = [];
        for (const raw of rows) {
          const message = asDmMessage(raw);
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

  /* ------------------------------------------------------------- listeners */

  useEffect(() => {
    if (!socket || !userId) return;

    // Named handler so the cleanup below can actually detach it — an anonymous
    // function would accumulate one live listener per re-render.
    function handleDmNew(payload: unknown): void {
      const message = asDmMessage(payload);
      // The admin room receives every thread; only ours belongs in this panel.
      if (!message || message.studentId !== userId) return;
      mergeMessage(message);
    }

    socket.on("dm:new", handleDmNew);

    return () => {
      socket.off("dm:new", handleDmNew);
    };
  }, [mergeMessage, socket, userId]);

  /* ---------------------------------------------------------------- scroll */

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Never yank the view out from under someone reading back through the
    // thread; only follow when they are already at the end.
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

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
    if (!userId || sending) return;
    const content = draft.trim();
    if (!content) return;

    setError(null);

    // Live path: the server writes the row and echoes "dm:new" back to this
    // student's room, so the bubble arrives through the listener above.
    if (socket && online) {
      socket.emit("dm:send", { content });
      clearComposer();
      return;
    }

    // Fallback path: same row, same shape, over plain HTTP.
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setError(readApiError(body, "Message could not be sent."));
        return;
      }

      const message = isRecord(body) ? asDmMessage(body.message) : null;
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

  /* ----------------------------------------------------------------- render */

  const canSend = Boolean(userId) && !sending && draft.trim().length > 0;

  return (
    <GlassCard className="flex h-[34rem] max-h-[78vh] flex-col overflow-hidden">
      <PanelHeader
        title="Direct Message"
        subtitle={`A private thread between you and the ${STAFF_LABEL} Unit.`}
        right={
          <span className="badge badge-neutral">
            <span
              className={online ? "pulse-dot" : "pulse-dot-off"}
              aria-hidden="true"
            />
            {liveOff ? "Delivering over the web app" : statusLabel(status)}
          </span>
        }
      />

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        aria-label="Conversation with Students Affairs"
        role="log"
      >
        {loading ? (
          <p className="px-1 py-10 text-center text-sm text-muted">
            Loading your conversation…
          </p>
        ) : messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            hint={`Anything you write here goes only to the ${STAFF_LABEL} Unit — never to other students.`}
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
                    {/* Staff carry the thread's only accent, matching the amber
                        edge on .bubble-staff. */}
                    <span
                      className={
                        mine
                          ? "font-semibold text-graphite/75"
                          : "font-semibold text-accent"
                      }
                    >
                      {mine ? "You" : STAFF_LABEL}
                    </span>
                    <time dateTime={message.createdAt} className="text-muted/60">
                      {timeLabel(message.createdAt)}
                    </time>
                  </p>
                  <div
                    className={`bubble whitespace-pre-wrap ${
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

      <div className="border-t border-line px-5 py-4">
        {liveOff && (
          <div className="notice mb-3">
            <span aria-hidden="true">ℹ</span>
            <span>
              Live delivery is off, so replies will not pop in on their own —
              messages you send are still saved and read by the Unit. Reload to
              check for a reply, or start the live server with{" "}
              <code className="rounded border border-line bg-white/5 px-1.5 py-0.5 font-mono text-[0.8125rem] text-graphite">
                npm run socket
              </code>
              .
            </span>
          </div>
        )}

        {error && (
          <div className="notice notice-error mb-3" role="status" aria-live="polite">
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
        )}

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <label htmlFor="dm-composer" className="sr-only">
            Message the Students Affairs Unit
          </label>
          {/* .field rather than .textarea: the latter's 8rem min-height would
              fight a one-row composer that grows with the draft. */}
          <textarea
            id="dm-composer"
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            maxLength={MAX_DM_LENGTH}
            disabled={!userId}
            placeholder="Write to the Students Affairs Unit…  (Enter to send, Shift+Enter for a new line)"
            className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto disabled:cursor-not-allowed disabled:opacity-50"
          />
          <NeonButton type="submit" disabled={!canSend} loading={sending}>
            Send
          </NeonButton>
        </form>

        {draft.length > MAX_DM_LENGTH - 500 && (
          <p className="mt-2 text-right text-xs text-muted/70">
            {draft.length}/{MAX_DM_LENGTH}
          </p>
        )}
      </div>
    </GlassCard>
  );
}
