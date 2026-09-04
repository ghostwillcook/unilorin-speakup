import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import Skeleton, { SkeletonLine, SkeletonList } from "@/components/Skeleton";
import NeonButton from "@/components/NeonButton";
import { isRedirect, requirePage } from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
import {
  dateTimeLabel,
  pseudonymColor,
  pseudonymInitials,
} from "@/lib/pseudonym";

/**
 * Admin chat logs — the de-anonymisation view.
 *
 * Public chat is anonymous *between students*: the socket never ships a userId
 * with a message, so no student can resolve "Anonymous #42". The database keeps
 * the link, and GET /api/admin/chat-logs is its only reader. This page exists to
 * present that link, which is why every row pairs the coloured pseudonym
 * directly against the real name, email and matric number rather than hiding the
 * identity behind a click.
 *
 * Because the view is capped server-side (default 200, max 500), the row count
 * and an explicit "capped" warning are part of the UI: a truncated log that
 * looks complete would be worse than no log at all for a disciplinary decision.
 */

const TAKE_OPTIONS = [50, 100, 200, 500] as const;
const DEFAULT_TAKE = 200;
const DEBOUNCE_MS = 350;

interface LogUser {
  id: string;
  name: string;
  email: string;
  studentId: string;
}

interface ChatLog {
  id: string;
  pseudonym: string;
  content: string;
  timestamp: string;
  user: LogUser;
}

interface Props {
  user: SessionUser;
}

/* ------------------------------------------------------------------------- */
/* Response narrowing — the payload is untrusted input like any other.        */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asLogs(value: unknown): ChatLog[] {
  const list: unknown[] =
    isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
  const rows: ChatLog[] = [];

  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    // A row with no joined user cannot serve this page's purpose, but it must
    // still render rather than crash, so the identity degrades to placeholders.
    const user: Record<string, unknown> = isRecord(raw.user) ? raw.user : {};
    rows.push({
      id: raw.id,
      pseudonym: asText(raw.pseudonym) || "Anonymous",
      content: asText(raw.content),
      timestamp: asText(raw.timestamp),
      user: {
        id: asText(user.id),
        name: asText(user.name) || "Unknown student",
        email: asText(user.email),
        studentId: asText(user.studentId),
      },
    });
  }

  return rows;
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

/* ------------------------------------------------------------------------- */

export default function AdminChatLogs({ user }: Props) {
  /** What the keyword box shows — updates on every keystroke. */
  const [keyword, setKeyword] = useState("");
  /** The debounced keyword actually sent to the server. */
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [take, setTake] = useState<number>(DEFAULT_TAKE);
  /**
   * The user filter, held as the whole identity rather than a bare id so the
   * clear-filter chip can name who is being singled out even before the
   * filtered request comes back.
   */
  const [focus, setFocus] = useState<LogUser | null>(null);

  const [logs, setLogs] = useState<ChatLog[]>([]);
  /** The take that produced `logs`; comparing against it is what detects a cap. */
  const [appliedTake, setAppliedTake] = useState<number>(DEFAULT_TAKE);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);
  /** Bumped by Refresh to re-run the load effect without changing a filter. */
  const [nonce, setNonce] = useState(0);

  // Debounce the keyword so typing "hostel" is one query, not six.
  useEffect(() => {
    const handle = window.setTimeout(() => setQ(keyword.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [keyword]);

  const userId = focus?.id ?? "";
  // An inverted range can never match; say so instead of showing "no messages".
  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    // Nothing to ask for, and the spinner must not be left running by whatever
    // request the previous render aborted on its way here.
    if (invalidRange) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    async function run(): Promise<void> {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (userId) params.set("userId", userId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("take", String(take));

      try {
        const res = await fetch(`/api/admin/chat-logs?${params.toString()}`, {
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          setLogs([]);
          setLoaded(false);
          setError(
            readField(body, "error") ??
              `Could not load the chat log (${res.status}).`,
          );
          // The route ships an actionable hint with its 503; show it verbatim.
          setSetupHint(res.status === 503 ? readField(body, "hint") : null);
          return;
        }

        setLogs(asLogs(body));
        setAppliedTake(take);
        setLoaded(true);
        setError(null);
        setSetupHint(null);
      } catch {
        // An aborted request is a superseded keystroke, not a failure.
        if (controller.signal.aborted) return;
        setLogs([]);
        setLoaded(false);
        setSetupHint(null);
        setError(
          "Could not reach the server. Please try again.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [q, userId, from, to, take, nonce, invalidRange]);

  /** Clicking the same student twice releases the filter. */
  const toggleFocus = useCallback((target: LogUser) => {
    setFocus((current) => (current && current.id === target.id ? null : target));
  }, []);

  const clearAll = useCallback(() => {
    setKeyword("");
    setQ("");
    setFrom("");
    setTo("");
    setFocus(null);
    setTake(DEFAULT_TAKE);
  }, []);

  const filtered = Boolean(q || userId || from || to) || take !== DEFAULT_TAKE;
  const capped = loaded && logs.length >= appliedTake;

  return (
    <AdminLayout
      title="Chat Logs"
      subtitle={`Resolve a public-chat pseudonym to the student behind it. Viewing as ${user.name}.`}
      right={
        <>
          {filtered && (
            <NeonButton variant="ghost" onClick={clearAll}>
              Clear all
            </NeonButton>
          )}
          <NeonButton
            variant="ghost"
            onClick={() => setNonce((value) => value + 1)}
            loading={loading}
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

      {error && !setupHint && (
        <div className="notice notice-error mb-5" role="status">
          <span aria-hidden="true">✕</span>
          <span>{error}</span>
        </div>
      )}

      {/* Filters ---------------------------------------------------------- */}
      <GlassCard className="mb-5 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <label className="field-label" htmlFor="log-q">
              Keyword
            </label>
            <input
              id="log-q"
              type="search"
              className="field"
              placeholder="Message text or pseudonym…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="log-from">
              From
            </label>
            <input
              id="log-from"
              type="date"
              className="field"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="log-to">
              To
            </label>
            <input
              id="log-to"
              type="date"
              className="field"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="log-take">
              Limit
            </label>
            <select
              id="log-take"
              className="field"
              value={take}
              onChange={(event) => setTake(Number(event.target.value))}
            >
              {TAKE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Newest {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </GlassCard>

      {/* The user filter is the loudest state on this page: it silently hides
          every other student's messages, so it gets its own banner. */}
      {focus && (
        <div className="surface mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-line px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">
            Filtered to one student
          </span>
          <span className="min-w-0 text-sm font-semibold text-graphite">
            {focus.name}
          </span>
          {focus.studentId && (
            <span className="font-mono text-xs text-muted">
              {focus.studentId}
            </span>
          )}
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-veil px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-veil"
          >
            <span aria-hidden="true">✕</span>
            Clear filter
          </button>
        </div>
      )}

      <GlassCard className="overflow-hidden">
        <PanelHeader
          title="Public chat messages"
          subtitle="Newest first. Every row is an identity disclosure — use it only for moderation."
          right={
            <span className="badge border border-line bg-veil text-muted">
              {loaded
                ? `${logs.length.toLocaleString()} row${logs.length === 1 ? "" : "s"}`
                : loading
                  ? "loading…"
                  : "—"}
            </span>
          }
        />

        {capped && (
          <div className="notice notice-warn m-4" role="status">
            <span aria-hidden="true">⚠</span>
            <span>
              <strong className="font-semibold">
                Showing only the newest {appliedTake.toLocaleString()} messages.
              </strong>{" "}
              The result hit the limit, so older matches are not on this page.
              Narrow the date range, search a keyword, or raise the limit before
              treating this as the full log.
            </span>
          </div>
        )}

        {invalidRange ? (
          <EmptyState
            title="That date range is inverted"
            hint="The “From” date is after the “To” date, so no message can match. Swap them to search."
          />
        ) : logs.length === 0 && loading && !loaded ? (
          /* Skeleton mirror of a log row (px-4 py-3.5 sm:px-5, pseudonym/identity
             pairing chip with h-9 w-9 avatar, timestamp, message body) so the
             swap to real rows fills in rather than jumping. */
          <SkeletonList label="Loading chat log…">
            <ul className="divide-y divide-line" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-canvas/85 py-1.5 pl-1.5 pr-3">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="space-y-1.5">
                        <div className="flex items-baseline gap-x-2">
                          <Skeleton className="h-3.5 w-20 rounded" />
                          <Skeleton className="h-3 w-2 rounded" />
                          <Skeleton className="h-3.5 w-28 rounded" />
                        </div>
                        <SkeletonLine width="w-32" className="h-3" />
                      </div>
                    </div>
                    <Skeleton className="mt-1 h-3 w-20" />
                  </div>
                  <SkeletonLine width="w-4/5" className="mt-2" />
                </li>
              ))}
            </ul>
          </SkeletonList>
        ) : logs.length === 0 ? (
          <EmptyState
            title={
              error
                ? "Chat log unavailable"
                : filtered
                  ? "No messages match these filters"
                  : "No chat messages yet"
            }
            hint={
              error
                ? "Resolve the problem above, then use Refresh."
                : filtered
                  ? "Widen the date range or clear the keyword and student filters."
                  : "Messages sent in the public chat room will be recorded here."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {logs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                focused={focus?.id === log.user.id}
                onFocus={toggleFocus}
              />
            ))}
          </ul>
        )}
      </GlassCard>
    </AdminLayout>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * One log line.
 *
 * The pseudonym chip and the real identity share a single bordered control with
 * an "=" between them, so the mapping is legible at a glance and clicking
 * anywhere on that pairing scopes the log to that student.
 */
function LogRow({
  log,
  focused,
  onFocus,
}: {
  log: ChatLog;
  focused: boolean;
  onFocus: (user: LogUser) => void;
}) {
  const color = pseudonymColor(log.pseudonym);

  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => onFocus(log.user)}
          aria-pressed={focused}
          title={
            focused
              ? `Stop filtering by ${log.user.name}`
              : `Show only messages from ${log.user.name}`
          }
          className={`flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3 text-left transition-colors ${
            focused
              ? "border-line bg-veil"
              : "border-line bg-canvas/85 hover:border-line hover:bg-veil"
          }`}
        >
          {/* Pseudonym side of the pairing. */}
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-canvas/85 text-[0.6875rem] font-bold tabular-nums"
            style={{ color, borderColor: color }}
            aria-hidden="true"
          >
            {pseudonymInitials(log.pseudonym)}
          </span>

          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span
                className="truncate text-sm font-bold"
                style={{ color }}
              >
                {log.pseudonym}
              </span>
              <span className="text-muted" aria-hidden="true">
                =
              </span>
              {/* Identity side of the pairing. */}
              <span className="truncate text-sm font-semibold text-graphite">
                {log.user.name}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted">
              {log.user.email && (
                <span className="truncate">{log.user.email}</span>
              )}
              {log.user.studentId && (
                <span className="font-mono text-muted">
                  {log.user.studentId}
                </span>
              )}
            </span>
          </span>
        </button>

        <time
          dateTime={log.timestamp}
          className="shrink-0 pt-1 text-xs tabular-nums text-muted"
        >
          {dateTimeLabel(log.timestamp)}
        </time>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
        {log.content}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
