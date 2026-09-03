import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import ComplaintThread from "@/components/ComplaintThread";
import NeonButton from "@/components/NeonButton";
import StatusBadge, { STATUSES } from "@/components/StatusBadge";
import type { ComplaintStatus } from "@/components/StatusBadge";
import { isRedirect, requirePage } from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
import { dateTimeLabel } from "@/lib/pseudonym";

/**
 * The admin complaint queue — the one screen in Student Connect that deliberately
 * de-anonymises.
 *
 * Public chat is pseudonymous by design, but a complaint is a formal record the
 * Student Affairs office has to act on, so this view shows the submitter's real
 * name, email and matric number. That is why the page is gated twice: by
 * `requirePage(ctx, "ADMIN")` here and by `requireRole(..., "ADMIN")` inside
 * GET /api/complaints. A student who guesses the URL is redirected, and a
 * student who calls the API directly gets their own rows only.
 *
 * Two behaviours are worth calling out because they are easy to get wrong:
 *
 * 1. The request is owned by a single effect keyed on the filter state, so
 *    changing a filter cancels the previous fetch through an AbortController.
 *    Without that, a slow response for "pend" can land after the fast response
 *    for "pending" and leave the table showing results for a query the admin
 *    has already moved past.
 * 2. A save patches one row from the PATCH response instead of refetching the
 *    list. That keeps the open composer, the scroll position and the filter set
 *    intact — and it means a row whose new status no longer matches the active
 *    filter stays on screen, so the admin sees the outcome of their click rather
 *    than the row silently vanishing.
 */

/** Long enough to feel instant, short enough that a word costs one request. */
const DEBOUNCE_MS = 300;

interface Submitter {
  id: string;
  name: string;
  email: string;
  studentId: string;
}

interface AdminComplaint {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
  user: Submitter;
}

interface Props {
  user: SessionUser;
}

/** The two fields PATCH /api/complaints/[id] will accept. */
interface ComplaintPatch {
  adminReply?: string;
  status?: ComplaintStatus;
}

interface Draft {
  reply: string;
  status: ComplaintStatus;
}

/** An error belongs to the row that caused it — a failed quick-status click on
 *  row 7 must not paint a notice over row 1. */
interface RowError {
  id: string;
  message: string;
}

/* ------------------------------------------------------------------------- */
/* Status text                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Derived rather than tabulated. StatusBadge owns how a status *looks* and does
 * not export its label map, so duplicating one here would create a second table
 * to drift out of sync. Deriving from the enum cannot drift:
 * IN_REVIEW -> "In review".
 */
function statusText(status: ComplaintStatus): string {
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Narrows a `<select>` value without a cast. "" means "no status filter". */
function toStatus(value: string): ComplaintStatus | "" {
  for (const status of STATUSES) {
    if (status === value) return status;
  }
  return "";
}

/* ------------------------------------------------------------------------- */
/* Response narrowing — an API payload is untrusted input like any other      */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Unknown statuses degrade to PENDING rather than crashing StatusBadge. */
function asStatus(value: unknown): ComplaintStatus {
  if (typeof value !== "string") return "PENDING";
  return toStatus(value) || "PENDING";
}

function asFiles(value: unknown): string[] {
  // Annotated as unknown[] so entries stay unknown instead of widening to any.
  const entries: unknown[] = Array.isArray(value) ? value : [];
  const files: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim().length > 0) files.push(entry);
  }
  return files;
}

function asSubmitter(value: unknown): Submitter {
  if (!isRecord(value)) {
    return { id: "", name: "Unknown student", email: "", studentId: "" };
  }
  return {
    id: asText(value.id),
    name: asText(value.name) || "Unknown student",
    email: asText(value.email),
    studentId: asText(value.studentId),
  };
}

function asComplaint(value: unknown): AdminComplaint | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    title: asText(value.title) || "Untitled complaint",
    description: asText(value.description),
    status: asStatus(value.status),
    adminReply: typeof value.adminReply === "string" ? value.adminReply : null,
    files: asFiles(value.files),
    createdAt: asText(value.createdAt),
    updatedAt: asText(value.updatedAt),
    user: asSubmitter(value.user),
  };
}

function asComplaints(value: unknown): AdminComplaint[] {
  if (!isRecord(value)) return [];
  const rows: unknown[] = Array.isArray(value.complaints) ? value.complaints : [];
  const out: AdminComplaint[] = [];
  for (const raw of rows) {
    const complaint = asComplaint(raw);
    if (complaint) out.push(complaint);
  }
  return out;
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/* ------------------------------------------------------------------------- */
/* Attachments                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Attachments are stored as Supabase object keys — `<userId>/<nonce>-<name>` —
 * so the readable part is the last segment with the uniqueness nonce stripped.
 * Anything unexpected falls back to a positional label.
 */
function fileLabel(key: string, index: number): string {
  const last = key.split("/").filter(Boolean).pop();
  if (last) {
    // storageKeyFor prefixes an 8-character base-36 nonce to keep concurrent
    // uploads of the same filename distinct; it is noise to a reader.
    const name = last.replace(/^[a-z0-9]{8}-/, "");
    if (name) return name.length > 40 ? `${name.slice(0, 37)}…` : name;
  }
  return `Attachment ${index + 1}`;
}

/* ------------------------------------------------------------------------- */

export default function AdminComplaintsPage({ user }: Props) {
  const router = useRouter();

  /* Filters. `search` is what the admin is typing; `q` is what the request
     uses. They converge DEBOUNCE_MS after the last keystroke. */
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ComplaintStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  /* null = never loaded, or the last load failed. [] = genuinely no rows. */
  const [complaints, setComplaints] = useState<AdminComplaint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);
  /** Bumped by Refresh to re-run the fetch effect without touching filters. */
  const [reloadToken, setReloadToken] = useState(0);

  /* Composer. One row is open at a time; the draft is seeded when it opens. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ reply: "", status: "PENDING" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);

  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => setQ(search), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  // Deep-link the status filter: the dashboard's status cards navigate here
  // with ?status=PENDING (etc.), and this applies it on arrival — the admin
  // should land on a pre-filtered queue, not have to select the filter
  // themselves. Runs on mount and on every query change.
  //
  // The absent-param branch is as important as the present one: without it,
  // navigating from ?status=PENDING to the plain /admin/complaints (the
  // "Total" tile, the sidebar link, "Open queue") left the old filter
  // applied — the URL said unfiltered, the list stayed filtered, and a hard
  // refresh showed a different queue than the screen did. Now the URL is the
  // single source of truth in both directions.
  useEffect(() => {
    const raw = router.query.status;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) {
      // No param = unfiltered. Clear rather than preserve, so the Total
      // tile's promise (all complaints) holds after a filtered visit.
      setStatusFilter((current) => (current === "" ? current : ""));
      return;
    }
    const status = toStatus(value);
    if (status) setStatusFilter(status);
  }, [router.query.status]);

  // The select writes back to the URL (shallow — no server round trip), so
  // the URL, the list, and the select can never disagree: a filtered view is
  // refresh-proof and back/forward-safe, and changing the select updates the
  // address bar to match.
  const changeStatusFilter = useCallback(
    (next: ComplaintStatus | "") => {
      setStatusFilter(next);
      void router.replace(
        {
          pathname: "/admin/complaints",
          query: next ? { status: next } : {},
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  // Single owner of the list request. Any filter change tears down the previous
  // one, so responses can never arrive out of order.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();

    async function run(): Promise<void> {
      setLoading(true);
      setError(null);
      setSetupHint(null);

      try {
        const res = await fetch(
          query ? `/api/complaints?${query}` : "/api/complaints",
          { signal: controller.signal },
        );
        const body: unknown = await res.json().catch(() => null);
        if (!active) return;

        if (!res.ok) {
          setComplaints(null);
          setError(
            readField(body, "error") ??
              `Could not load complaints (${res.status}).`,
          );
          // The route ships an actionable hint with its 503; show it verbatim.
          if (res.status === 503) setSetupHint(readField(body, "hint"));
          return;
        }

        setComplaints(asComplaints(body));
      } catch (err) {
        if (!active || isAbort(err)) return;
        setComplaints(null);
        setError(
          "Could not reach the server. Please try again.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [statusFilter, q, from, to, reloadToken]);

  const openRow = useCallback(
    (complaint: AdminComplaint) => {
      setRowError(null);
      if (selectedId === complaint.id) {
        setSelectedId(null);
        return;
      }
      // Seed the status select from the row as it is the moment the admin
      // opened it; the reply itself lives in the thread, not a draft.
      setDraft({ reply: "", status: complaint.status });
      setSelectedId(complaint.id);
    },
    [selectedId],
  );

  const save = useCallback(
    async (id: string, patch: ComplaintPatch): Promise<void> => {
      setBusyId(id);
      setRowError(null);

      try {
        const res = await fetch(`/api/complaints/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          setRowError({
            id,
            message:
              readField(body, "error") ?? `Could not save (${res.status}).`,
          });
          return;
        }

        const updated = asComplaint(isRecord(body) ? body.complaint : null);
        if (!updated) {
          setRowError({
            id,
            message: "The server returned an unreadable complaint.",
          });
          return;
        }

        setComplaints((prev) =>
          prev === null
            ? prev
            : prev.map((row) => (row.id === updated.id ? updated : row)),
        );

        // A quick-status click can change the status of the row being edited.
        // Catch the select up, but keep whatever is in the textarea — throwing
        // away unsaved typing to echo the server would be a bug, not a sync.
        if (selectedId === updated.id) {
          setDraft((prev) => ({ reply: prev.reply, status: updated.status }));
        }
      } catch {
        setRowError({
          id,
          message: "Could not reach the server. The change was not saved.",
        });
      } finally {
        setBusyId(null);
      }
    },
    [selectedId],
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setQ("");
    setStatusFilter("");
    setFrom("");
    setTo("");
  }, []);

  /** Applies the typed search now rather than waiting out the remaining delay. */
  const flushSearch = useCallback(() => {
    setQ(search);
  }, [search]);

  const submitFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      // This form has several text/date fields and no submit button, so per the
      // HTML spec implicit submission is a no-op — Enter is handled on the input
      // itself. This stays as a guard so no browser can navigate away instead.
      event.preventDefault();
      flushSearch();
    },
    [flushSearch],
  );

  const rows = complaints ?? [];
  const loaded = complaints !== null;
  const filtersActive =
    statusFilter !== "" || search.trim() !== "" || from !== "" || to !== "";

  return (
    <AdminLayout
      title="Complaints"
      subtitle="Every complaint filed, with the submitter's identity attached. Reply and move a case through review."
      right={
        <>
          <span
            className="badge border border-line bg-veil text-muted"
            aria-live="polite"
          >
            {loaded
              ? `${rows.length} ${rows.length === 1 ? "result" : "results"}`
              : "—"}
          </span>
          <NeonButton
            type="button"
            variant="ghost"
            loading={loading}
            onClick={() => setReloadToken((token) => token + 1)}
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

      <GlassCard className="mb-5 overflow-hidden">
        <PanelHeader
          title="Filters"
          subtitle="Search matches the title, description, and the student's name, email or matric number."
          right={
            filtersActive && (
              <NeonButton
                type="button"
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={clearFilters}
              >
                Clear
              </NeonButton>
            )
          }
        />

        <form
          className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={submitFilters}
        >
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="field-label" htmlFor="filter-q">
              Search
            </label>
            <input
              id="filter-q"
              type="search"
              className="field"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  flushSearch();
                }
              }}
              placeholder="Name, matric no. or keyword"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="filter-status">
              Status
            </label>
            <select
              id="filter-status"
              className="field"
              value={statusFilter}
              onChange={(event) =>
                changeStatusFilter(toStatus(event.target.value))
              }
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusText(status)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="filter-from">
              From
            </label>
            <input
              id="filter-from"
              type="date"
              className="field"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="filter-to">
              To
            </label>
            <input
              id="filter-to"
              type="date"
              className="field"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </form>
      </GlassCard>

      {rows.length === 0 ? (
        <GlassCard>
          {!loaded && loading ? (
            <EmptyState
              title="Loading complaints…"
              hint="Fetching the queue from the database."
            />
          ) : !loaded ? (
            <EmptyState
              title="Complaints unavailable"
              hint="Nothing can be listed until the request above succeeds."
            />
          ) : filtersActive ? (
            // Rows exist, they just do not match — say so, and say what to do.
            <EmptyState
              title="Nothing matches these filters"
              hint="Try another status, widen the date range, or clear the search."
            />
          ) : (
            <EmptyState
              title="No complaints yet"
              hint="When a student files a complaint it will appear here for review."
            />
          )}
        </GlassCard>
      ) : (
        <ul
          className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}
          aria-busy={loading || undefined}
        >
          {rows.map((complaint) => {
            const expanded = selectedId === complaint.id;
            const busy = busyId === complaint.id;
            const failed = rowError?.id === complaint.id ? rowError : null;
            // Status-only: the reply is the thread's business now.
            const dirty = draft.status !== complaint.status;

            return (
              <GlassCard as="li" key={complaint.id} hover>
                <div className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-words text-base font-semibold text-muted">
                          {complaint.title}
                        </h2>
                        <StatusBadge status={complaint.status} />
                      </div>

                      {/* Admin-only by design: the office needs to know who to
                          contact and which record to open. */}
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        <span className="font-medium text-muted">
                          {complaint.user.name}
                        </span>
                        {complaint.user.email && (
                          <>
                            <span aria-hidden="true">·</span>
                            <a
                              href={`mailto:${complaint.user.email}`}
                              className="underline decoration-line underline-offset-2 transition-colors hover:text-accent"
                            >
                              {complaint.user.email}
                            </a>
                          </>
                        )}
                        {complaint.user.studentId && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tracking-tight">
                              {complaint.user.studentId}
                            </span>
                          </>
                        )}
                      </p>
                    </div>

                    <time
                      dateTime={complaint.createdAt}
                      className="whitespace-nowrap text-xs text-muted"
                    >
                      {dateTimeLabel(complaint.createdAt)}
                    </time>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
                    {complaint.description}
                  </p>

                  {complaint.files.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-muted">
                        {complaint.files.length}{" "}
                        {complaint.files.length === 1
                          ? "attachment"
                          : "attachments"}
                      </span>
                      {complaint.files.map((key, index) => (
                        <a
                          key={`${complaint.id}-file-${index}`}
                          /* Private bucket: reads go through the authorising
                             route, which signs a short-lived URL. */
                          href={`/api/attachments/${key}`}
                          target="_blank"
                          rel="noreferrer"
                          title={key}
                          className="badge border border-line bg-veil text-accent normal-case tracking-normal transition-colors hover:border-line hover:bg-veil"
                        >
                          {fileLabel(key, index)}
                          <span aria-hidden="true">↗</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Collapsed rows still show the reply, so scanning the queue
                      does not require opening every case. */}
                  {complaint.adminReply && !expanded && (
                    <div className="mt-3 rounded-xl border border-line bg-veil px-3 py-2">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-accent/70">
                        Official reply
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
                        {complaint.adminReply}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <span className="mr-1 text-[0.6875rem] font-semibold uppercase tracking-widest text-muted">
                      Move to
                    </span>
                    {STATUSES.filter((status) => status !== complaint.status).map(
                      (status) => (
                        <NeonButton
                          key={status}
                          type="button"
                          variant="ghost"
                          className="px-2.5 py-1 text-xs"
                          disabled={busy}
                          onClick={() => void save(complaint.id, { status })}
                        >
                          {statusText(status)}
                        </NeonButton>
                      ),
                    )}

                    <span className="flex-1" />

                    <NeonButton
                      type="button"
                      variant="ghost"
                      className="px-3 py-1.5 text-xs"
                      aria-expanded={expanded}
                      aria-controls={`composer-${complaint.id}`}
                      onClick={() => openRow(complaint)}
                    >
                      {expanded ? "Close thread" : "Open thread"}
                    </NeonButton>
                  </div>

                  {/* Rendered outside the composer: a quick-status click can
                      fail on a collapsed row, and that error must still show. */}
                  {failed && (
                    <div className="notice notice-error mt-3" role="status">
                      <span aria-hidden="true">✕</span>
                      <span>{failed.message}</span>
                    </div>
                  )}

                  {expanded && (
                    <div
                      id={`composer-${complaint.id}`}
                      className="mt-4 border-t border-line pt-4"
                    >
                      {/* Status control stays on the record; the REPLY now
                          lives in the dedicated thread below, where the
                          student sees it arrive in their own complaint
                          conversation (spec: tap complaint → details + thread
                          → reply). */}
                      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                        <div className="w-full sm:w-44">
                          <label
                            className="field-label"
                            htmlFor={`status-${complaint.id}`}
                          >
                            Status
                          </label>
                          <select
                            id={`status-${complaint.id}`}
                            className="field"
                            value={draft.status}
                            onChange={(event) => {
                              const next = toStatus(event.target.value);
                              if (next) {
                                setDraft((prev) => ({ ...prev, status: next }));
                              }
                            }}
                          >
                            {STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {statusText(status)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <NeonButton
                          type="button"
                          loading={busy}
                          disabled={!dirty}
                          title={dirty ? undefined : "No changes to save"}
                          onClick={() =>
                            void save(complaint.id, { status: draft.status })
                          }
                        >
                          {busy ? "Saving…" : "Save status"}
                        </NeonButton>

                        <p className="ml-auto text-xs text-muted">
                          Last updated {dateTimeLabel(complaint.updatedAt)} ·
                          reviewed by {user.name}.
                        </p>
                      </div>

                      <div className="mt-4">
                        <ComplaintThread
                          complaintId={complaint.id}
                          viewerRole="ADMIN"
                          title={`Conversation with ${complaint.user.name}`}
                          subtitle={`${complaint.user.studentId} · this complaint's thread`}
                          // The student's messages carry HER name — only the
                          // Unit's replies are labeled Student Affairs.
                          otherLabel={complaint.user.name}
                          // Below md, ChatShell goes fixed full-screen. Without
                          // a way back, "Open thread" on a phone traps the
                          // admin behind the sheet with only a reload to
                          // escape — so collapse the row (same as the desktop
                          // "Close thread" button above) on back.
                          onBack={() => setSelectedId(null)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </ul>
      )}
    </AdminLayout>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
