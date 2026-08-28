import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { isRedirect, requirePage } from "@/lib/guards";
import type { Role, SessionUser } from "@/lib/guards";
import { dateTimeLabel } from "@/lib/pseudonym";

/**
 * Admin account roster.
 *
 * Deactivation is the Students Affairs Unit's only moderation lever, and it is a
 * real one: lib/auth.ts refuses a sign-in when `isActive` is false and the
 * guards evict anyone already holding a token. So the destructive direction is
 * confirmed before it fires, while reactivation — which only restores access —
 * is a single click.
 *
 * Administrator rows render the control disabled rather than letting a click
 * discover the API's refusal, because the one account that can lock everyone out
 * of the console is the console's own.
 */

const DEBOUNCE_MS = 350;

const ADMIN_LOCK =
  "Administrator accounts cannot be deactivated — this is the account that " +
  "keeps the Students Affairs console reachable. Change the role first if it " +
  "should lose access.";

interface UserRow {
  id: string;
  name: string;
  email: string;
  studentId: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  counts: { complaints: number; messages: number };
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

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Unknown roles degrade to STUDENT, the least privileged reading. */
function asRole(value: unknown): Role {
  return value === "ADMIN" ? "ADMIN" : "STUDENT";
}

function asUser(value: unknown): UserRow | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  const counts: Record<string, unknown> = isRecord(value.counts)
    ? value.counts
    : {};

  return {
    id: value.id,
    name: asText(value.name) || "Unnamed account",
    email: asText(value.email),
    studentId: asText(value.studentId),
    role: asRole(value.role),
    // A missing flag means a malformed payload, not a locked account; the API
    // is the authority either way, so the row shows the optimistic reading.
    isActive: typeof value.isActive === "boolean" ? value.isActive : true,
    createdAt: asText(value.createdAt),
    counts: {
      complaints: asCount(counts.complaints),
      messages: asCount(counts.messages),
    },
  };
}

function asUsers(value: unknown): UserRow[] {
  const list: unknown[] =
    isRecord(value) && Array.isArray(value.users) ? value.users : [];
  const rows: UserRow[] = [];
  for (const raw of list) {
    const row = asUser(raw);
    if (row) rows.push(row);
  }
  return rows;
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

/* ------------------------------------------------------------------------- */

export default function AdminUsers({ user }: Props) {
  /** What the search box shows — updates on every keystroke. */
  const [search, setSearch] = useState("");
  /** The debounced term actually sent to the server. */
  const [q, setQ] = useState("");

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);
  /** The row whose PATCH is in flight, so only its button shows a spinner. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Bumped by Refresh to re-run the load effect without changing the search. */
  const [nonce, setNonce] = useState(0);

  // Debounce the search so typing a matric number is one query, not ten.
  useEffect(() => {
    const handle = window.setTimeout(() => setQ(search.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    async function run(): Promise<void> {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      const suffix = params.toString();

      try {
        const res = await fetch(
          suffix ? `/api/admin/users?${suffix}` : "/api/admin/users",
          { signal: controller.signal },
        );
        const body: unknown = await res.json().catch(() => null);

        if (!res.ok) {
          setUsers([]);
          setLoaded(false);
          setError(
            readField(body, "error") ??
              `Could not load accounts (${res.status}).`,
          );
          // The route ships an actionable hint with its 503; show it verbatim.
          setSetupHint(res.status === 503 ? readField(body, "hint") : null);
          return;
        }

        setUsers(asUsers(body));
        setLoaded(true);
        setError(null);
        setSetupHint(null);
      } catch {
        // An aborted request is a superseded keystroke, not a failure.
        if (controller.signal.aborted) return;
        setUsers([]);
        setLoaded(false);
        setSetupHint(null);
        setError(
          "Could not reach the server. Check that `npm run dev` is running.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void run();
    return () => controller.abort();
  }, [q, nonce]);

  const setActive = useCallback(async (row: UserRow, next: boolean) => {
    // Defensive: the button is disabled for admins, and the API refuses too.
    if (row.role === "ADMIN" && !next) return;

    if (
      !next &&
      !window.confirm(
        `Deactivate ${row.name}?\n\n` +
          `${row.email}\n\n` +
          "They will be blocked from signing in — and signed out of any live " +
          "session — until you reactivate the account. Their complaints and " +
          "chat history are kept.",
      )
    ) {
      return;
    }

    setPendingId(row.id);
    setActionError(null);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setActionError(
          readField(body, "error") ??
            `Could not update ${row.name} (${res.status}).`,
        );
        return;
      }

      const updated = asUser(isRecord(body) ? body.user : null);
      if (!updated) {
        setActionError(
          `${row.name} may not have been updated — the server returned an unexpected response. Refresh to confirm.`,
        );
        return;
      }

      // Swap in the server's row rather than flipping the local flag, so the
      // list always shows what was actually persisted.
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      setActionError(
        `Could not reach the server to update ${row.name}. Check that \`npm run dev\` is running.`,
      );
    } finally {
      setPendingId(null);
    }
  }, []);

  const inactive = users.filter((row) => !row.isActive).length;

  return (
    <AdminLayout
      title="Users"
      subtitle={`Accounts, activity and access. Signed in as ${user.name}.`}
      right={
        <>
          {loaded && inactive > 0 && (
            <span className="badge border border-danger/30 bg-danger/8 text-danger">
              {inactive} deactivated
            </span>
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

      {actionError && (
        <div className="notice notice-error mb-5" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{actionError}</span>
        </div>
      )}

      <GlassCard className="mb-5 px-5 py-4">
        <label className="field-label" htmlFor="user-q">
          Search accounts
        </label>
        <input
          id="user-q"
          type="search"
          className="field"
          placeholder="Name, email or matric number…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
        />
      </GlassCard>

      <GlassCard className="overflow-hidden">
        <PanelHeader
          title="Accounts"
          subtitle="Administrators first, then students by name."
          right={
            <span className="badge border border-line bg-veil text-muted">
              {loaded
                ? `${users.length.toLocaleString()} account${
                    users.length === 1 ? "" : "s"
                  }`
                : loading
                  ? "loading…"
                  : "—"}
            </span>
          }
        />

        {users.length === 0 ? (
          <EmptyState
            title={
              error
                ? "Roster unavailable"
                : loading && !loaded
                  ? "Loading accounts…"
                  : q
                    ? `No account matches “${q}”`
                    : "No accounts yet"
            }
            hint={
              error
                ? "Resolve the problem above, then use Refresh."
                : loading && !loaded
                  ? undefined
                  : q
                    ? "Search runs over name, email and matric number."
                    : "Run `npm run seed` to create the demo administrator and students."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {users.map((row) => (
              <UserListRow
                key={row.id}
                row={row}
                pending={pendingId === row.id}
                busy={pendingId !== null}
                onSetActive={setActive}
              />
            ))}
          </ul>
        )}
      </GlassCard>
    </AdminLayout>
  );
}

/* ------------------------------------------------------------------------- */

function UserListRow({
  row,
  pending,
  busy,
  onSetActive,
}: {
  row: UserRow;
  /** This row's own PATCH is in flight. */
  pending: boolean;
  /** Some row's PATCH is in flight; others lock to avoid overlapping writes. */
  busy: boolean;
  onSetActive: (row: UserRow, next: boolean) => void;
}) {
  const isAdmin = row.role === "ADMIN";

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span
            className={`truncate text-sm font-semibold ${
              row.isActive ? "text-graphite" : "text-muted line-through"
            }`}
          >
            {row.name}
          </span>
          <RoleBadge role={row.role} />
          <StateBadge active={row.isActive} />
        </div>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-muted">
          {row.email && <span className="truncate">{row.email}</span>}
          {row.studentId && (
            <span className="font-mono text-muted">{row.studentId}</span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="tabular-nums">
            <strong className="font-semibold text-muted">
              {row.counts.complaints.toLocaleString()}
            </strong>{" "}
            complaint{row.counts.complaints === 1 ? "" : "s"}
          </span>
          <span className="tabular-nums">
            <strong className="font-semibold text-muted">
              {row.counts.messages.toLocaleString()}
            </strong>{" "}
            chat message{row.counts.messages === 1 ? "" : "s"}
          </span>
          {row.createdAt && (
            <span>
              Joined{" "}
              <time dateTime={row.createdAt}>
                {dateTimeLabel(row.createdAt)}
              </time>
            </span>
          )}
        </div>
      </div>

      {/* The span carries the title too: browsers skip tooltips on some
          disabled controls, and this explanation is the whole point. */}
      {isAdmin ? (
        <span className="inline-flex shrink-0" title={ADMIN_LOCK}>
          <NeonButton variant="danger" disabled title={ADMIN_LOCK}>
            Deactivate
          </NeonButton>
        </span>
      ) : row.isActive ? (
        <NeonButton
          variant="danger"
          className="shrink-0"
          loading={pending}
          disabled={busy && !pending}
          onClick={() => onSetActive(row, false)}
          title={`Block ${row.name} from signing in`}
        >
          Deactivate
        </NeonButton>
      ) : (
        <NeonButton
          variant="ghost"
          className="shrink-0"
          loading={pending}
          disabled={busy && !pending}
          onClick={() => onSetActive(row, true)}
          title={`Restore sign-in for ${row.name}`}
        >
          Reactivate
        </NeonButton>
      )}
    </li>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return role === "ADMIN" ? (
    <span className="badge border border-line bg-veil text-accent">
      Admin
    </span>
  ) : (
    <span className="badge border border-line bg-canvas/85 text-muted">
      Student
    </span>
  );
}

function StateBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="badge badge-resolved">Active</span>
  ) : (
    <span className="badge border border-danger/30 bg-danger/8 text-danger">
      Inactive
    </span>
  );
}

/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
