import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";

import ChatShell from "@/components/ChatShell";
import { EmptyState } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { pseudonymInitials, timeLabel } from "@/lib/pseudonym";
import { statusLabel, useSocket } from "@/lib/socket-client";
import type { PublicChatMessage } from "@/lib/socket-client";

/**
 * The global anonymous room — students talking to students.
 *
 * This is the original public square, kept deliberately separate from Live
 * Chat (the student's private conversation with the Unit): different purpose,
 * different table (ChatMessage), different promise. Identity here is a
 * pseudonym and nothing else — PublicChatMessage carries no userId by design,
 * so this component cannot leak an author even by accident. "Which bubble is
 * mine?" is answered by comparing the message pseudonym against the one the
 * server announced for this connection.
 *
 * Socket-only by nature: the room has no write REST route (its messages are
 * persisted by the socket server on chat:send and history reloads from the
 * same table), so when the connection is cold the room is read-only — stated
 * in one calm sentence, never a terminal command.
 */

/** Mirrors MAX_CHAT_LENGTH in server/socket.mjs so the UI refuses first. */
const MAX_CHAT_LENGTH = 2000;

/** How close to the end still counts as "following the conversation". */
const NEAR_BOTTOM_PX = 96;

/** Composer grows with the draft, up to this many pixels. */
const COMPOSER_MAX_PX = 132;

/**
 * The socket is shared app-wide and "session"/"chat:history" are only emitted
 * once per connection, so a panel that remounts (tab switch) would otherwise
 * come back not knowing its own pseudonym — and would render every past bubble
 * as somebody else's. Caching at module scope keeps a remount continuous.
 */
let cachedPseudonym: string | null = null;
let cachedMessages: PublicChatMessage[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wire payloads are untrusted input; a malformed row is dropped, not rendered. */
function asChatMessage(value: unknown): PublicChatMessage | null {
  if (!isRecord(value)) return null;
  const { id, pseudonym, content, timestamp } = value;
  if (
    typeof id !== "string" ||
    typeof pseudonym !== "string" ||
    typeof content !== "string" ||
    typeof timestamp !== "string"
  ) {
    return null;
  }
  return { id, pseudonym, content, timestamp };
}

function readErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
    return value.message;
  }
  return "Message could not be delivered. Please try again.";
}

export default function ChatPanel() {
  const { socket, status } = useSocket(true);

  const [pseudonym, setPseudonym] = useState<string | null>(() => cachedPseudonym);
  const [messages, setMessages] = useState<PublicChatMessage[]>(() => cachedMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);

  const online = status === "online";

  /* ------------------------------------------------------------- listeners */

  useEffect(() => {
    if (!socket) return;

    // Named handlers, held for the lifetime of this effect: socket.off() only
    // detaches a reference it was given, so anonymous functions here would
    // leave a listener behind on every re-render and duplicate every message.
    function handleSession(payload: unknown): void {
      if (isRecord(payload) && typeof payload.pseudonym === "string") {
        setPseudonym(payload.pseudonym);
      }
    }

    function handleHistory(payload: unknown): void {
      if (!Array.isArray(payload)) return;
      const rows: PublicChatMessage[] = [];
      for (const raw of payload) {
        const message = asChatMessage(raw);
        if (message) rows.push(message);
      }
      setMessages(rows);
    }

    function handleMessage(payload: unknown): void {
      const message = asChatMessage(payload);
      if (!message) return;
      // The server broadcasts to everyone including the sender, so your own
      // message arrives the same way — de-duplicated by id in case a reconnect
      // replays it inside the history window.
      setMessages((prev) =>
        prev.some((row) => row.id === message.id) ? prev : [...prev, message],
      );
    }

    function handleError(payload: unknown): void {
      setError(readErrorMessage(payload));
    }

    socket.on("session", handleSession);
    socket.on("chat:history", handleHistory);
    socket.on("chat:message", handleMessage);
    socket.on("chat:error", handleError);

    // A socket that connected before this panel mounted has already sent its
    // one-shot history, so ask again rather than showing an empty room.
    if (socket.connected) socket.emit("chat:history:request", {});

    return () => {
      socket.off("session", handleSession);
      socket.off("chat:history", handleHistory);
      socket.off("chat:message", handleMessage);
      socket.off("chat:error", handleError);
    };
  }, [socket]);

  // Only ever write real values back to the cache — a fresh mount starts with
  // pseudonym null and must not blank out what the last mount learned.
  useEffect(() => {
    if (pseudonym !== null) cachedPseudonym = pseudonym;
    if (messages.length > 0) cachedMessages = messages;
  }, [pseudonym, messages]);

  /* ---------------------------------------------------------------- scroll */

  const scrollToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  }, []);

  // Auto-follow only while the reader is already at the end. Someone scrolled
  // up reading history keeps their place and gets a counter instead.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((count) => count + 1);
    }
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottom.current = near;
    if (near) setUnseen(0);
  }, []);

  /* -------------------------------------------------------------- composer */

  const resizeComposer = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, []);

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.target.value.slice(0, MAX_CHAT_LENGTH));
      resizeComposer(event.target);
    },
    [resizeComposer],
  );

  const send = useCallback(() => {
    if (!socket || !online) return;
    const content = draft.trim();
    if (!content) return;

    // The previous failure is stale the moment a new attempt goes out.
    setError(null);
    socket.emit("chat:send", { content });

    setDraft("");
    const el = composerRef.current;
    if (el) {
      el.style.height = "auto";
      el.focus();
    }
    // Sending is an act of participation: rejoin the tail of the room.
    scrollToLatest();
  }, [draft, online, scrollToLatest, socket]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      send();
    },
    [send],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter is a deliberate newline.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    [send],
  );

  /* ----------------------------------------------------------------- render */

  const canSend = online && draft.trim().length > 0;

  return (
    <ChatShell
      title="Anonymous Room"
      subtitle="Students talking to students. Your real name is never shown."
      badge={
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-neutral">
            <span
              className={online ? "pulse-dot" : "pulse-dot-off"}
              aria-hidden="true"
            />
            {status === "connecting" ? "Connecting…" : statusLabel(status)}
          </span>
          {pseudonym && (
            <span
              className="badge badge-neutral hidden text-graphite sm:inline-flex"
              title="Your pseudonym for this session"
            >
              You are {pseudonym}
            </span>
          )}
        </div>
      }
      footer={
        (error || !online) && (
          <div className="border-t border-line px-5 py-3">
            {!online && (
              <div className="notice mb-2" role="status">
                <span aria-hidden="true">ℹ</span>
                <span>
                  {status === "connecting"
                    ? "Connecting…"
                    : "The anonymous room is temporarily unavailable. Your saved conversations are unaffected."}
                </span>
              </div>
            )}
            {error && (
              <div className="notice notice-error" role="status" aria-live="polite">
                <span aria-hidden="true">✕</span>
                <span>{error}</span>
              </div>
            )}
          </div>
        )
      }
      composer={
        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-line px-5 py-4">
          <label htmlFor="chat-composer" className="sr-only">
            Message the room
          </label>
          {/* .field rather than .textarea: the latter's 8rem min-height would
              fight a one-row composer that grows with the draft. */}
          <textarea
            id="chat-composer"
            ref={composerRef}
            rows={1}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CHAT_LENGTH}
            disabled={!online}
            placeholder={
              online
                ? "Write anonymously…  (Enter to send, Shift+Enter for a new line)"
                : "Room offline"
            }
            className="field max-h-[8.25rem] flex-1 resize-none overflow-y-auto disabled:cursor-not-allowed disabled:opacity-50"
          />
          <NeonButton type="submit" disabled={!canSend}>
            Send
          </NeonButton>
        </form>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-5 py-4"
          aria-label="Chat messages"
          role="log"
        >
          {messages.length === 0 ? (
            <EmptyState
              title="No messages yet"
              hint={
                online
                  ? "Say something — everyone in here is anonymous."
                  : "Messages will appear here once the room is back."
              }
            />
          ) : (
            <ul className="space-y-3">
              {messages.map((message) => {
                const mine =
                  pseudonym !== null && message.pseudonym === pseudonym;

                return (
                  <li
                    key={message.id}
                    className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}
                  >
                    {/* No per-pseudonym hue: the palette carries exactly one
                        accent, so "which bubble is mine?" is answered by
                        brightness and the label, not by colour-coding. */}
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[0.6875rem] font-semibold ${
                        mine
                          ? "border-line bg-veil text-graphite"
                          : "border-line bg-veil text-muted"
                      }`}
                      aria-hidden="true"
                    >
                      {pseudonymInitials(message.pseudonym)}
                    </span>

                    <div className="min-w-0">
                      <p
                        className={`mb-1 flex items-center gap-2 text-[0.6875rem] ${
                          mine ? "flex-row-reverse" : ""
                        }`}
                      >
                        <span
                          className={`font-semibold ${
                            mine ? "text-graphite/80" : "text-muted"
                          }`}
                        >
                          {message.pseudonym}
                          {mine && " (you)"}
                        </span>
                        <time
                          dateTime={message.timestamp}
                          className="text-muted/60"
                        >
                          {timeLabel(message.timestamp)}
                        </time>
                      </p>
                      <div
                        className={`bubble whitespace-pre-wrap ${
                          mine ? "bubble-self" : "bubble-other"
                        }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {unseen > 0 && (
          <button
            type="button"
            onClick={scrollToLatest}
            className="badge surface-hover absolute bottom-3 left-1/2 -translate-x-1/2 border-line bg-raised/90 text-graphite backdrop-blur"
          >
            {unseen} new {unseen === 1 ? "message" : "messages"} ↓
          </button>
        )}
      </div>
    </ChatShell>
  );
}
