import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";

import AdminLayout from "@/components/AdminLayout";
import GlassCard, { EmptyState, PanelHeader } from "@/components/GlassCard";
import { Stagger } from "@/components/Motion";
import NeonButton, { NeonLink } from "@/components/NeonButton";
import StatusBadge from "@/components/StatusBadge";
import type { ComplaintStatus } from "@/components/StatusBadge";
import { isRedirect, requirePage } from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
import { dateTimeLabel } from "@/lib/pseudonym";
import { useSocket } from "@/lib/socket-client";
import type { PresencePayload } from "@/lib/socket-client";

/**
 * Admin dashboard.
 *
 * Two independent sources feed this screen and neither may take the other down:
 * GET /api/admin/stats supplies the durable tallies, while the socket supplies
 * the live presence count. A socket server that is not running therefore leaves
 * the tiles intact and only mutes the presence pill, and a database that is not
 * configured (503) surfaces the route's own hint instead of an empty page.
 */

interface RecentComplaint {
  id: string;
  title: string;
  status: ComplaintStatus;
  createdAt: string;
  studentName: string;
}

interface AdminStats {
  total: number;
  pending: number;
  inReview: number;
  resolved: number;
  rejected: number;
  students: number;
  recent: RecentComplaint[];
}

interface Props {
  user: SessionUser;
}

const ZERO: AdminStats = {
  total: 0,
  pending: 0,
  inReview: 0,
  resolved: 0,
  rejected: 0,
  students: 0,
  recent: [],
};

/* ------------------------------------------------------------------------- */
/* Response narrowing — the payload is untrusted input like any other.        */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Unknown statuses degrade to PENDING rather than crashing StatusBadge. */
function asStatus(value: unknown): ComplaintStatus {
  return value === "IN_REVIEW" || value === "RESOLVED" || value === "REJECTED"
    ? value
    : "PENDING";
}

function asStats(value: unknown): AdminStats {
  if (!isRecord(value)) return ZERO;
  const rows = Array.isArray(value.recent) ? value.recent : [];
  const recent: RecentComplaint[] = [];

  for (const raw of rows) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    recent.push({
      id: raw.id,
      title: asText(raw.title) || "Untitled complaint",
      status: asStatus(raw.status),
      createdAt: asText(raw.createdAt),
      studentName: asText(raw.studentName) || "Unknown student",
    });
  }

  return {
    total: asCount(value.total),
    pending: asCount(value.pending),
    inReview: asCount(value.inReview),
    resolved: asCount(value.resolved),
    rejected: asCount(value.rejected),
    students: asCount(value.students),
    recent,
  };
}

function readField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

/* ------------------------------------------------------------------------- */

export default function AdminDashboard({ user }: Props) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set only for the 503 database-not-configured case. */
  const [setupHint, setSetupHint] = useState<string | null>(null);

  const { socket, status } = useSocket(true);
  const [presence, setPresence] = useState<PresencePayload | null>(null);

  const online = status === "online";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSetupHint(null);

    try {
      const res = await fetch("/api/admin/stats");
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setStats(null);
        setError(
          readField(body, "error") ?? `Could not load stats (${res.status}).`,
        );
        // The route ships an actionable hint with its 503; show it verbatim.
        if (res.status === 503) setSetupHint(readField(body, "hint"));
        return;
      }

      setStats(asStats(body));
    } catch {
      setStats(null);
      setError("Could not reach the server. Check that `npm run dev` is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!socket) return;

    // Named handler: socket.off() can only detach a reference it was given, so
    // an inline arrow would leave a listener behind on every re-render.
    function handlePresence(payload: unknown): void {
      if (!isRecord(payload)) return;
      const { onlineStudents, onlineAdmins } = payload;
      if (
        typeof onlineStudents !== "number" ||
        typeof onlineAdmins !== "number"
      ) {
        return;
      }
      setPresence({ onlineStudents, onlineAdmins });
    }

    socket.on("presence", handlePresence);
    return () => {
      socket.off("presence", handlePresence);
    };
  }, [socket]);

  const view = stats ?? ZERO;
  const hasStats = stats !== null;

  /* Semantic hues only — warn/info/danger are the tokens status already uses in
     badges, so a tile and its badge never disagree. Everything neutral stays
     paper; the ember is reserved for the live indicator. */
  const tiles: Array<{ label: string; value: number; tone: string }> = [
    { label: "Total", value: view.total, tone: "text-graphite" },
    { label: "Pending", value: view.pending, tone: "text-warn" },
    { label: "In review", value: view.inReview, tone: "text-info" },
    { label: "Resolved", value: view.resolved, tone: "text-graphite" },
    { label: "Rejected", value: view.rejected, tone: "text-danger" },
    { label: "Students", value: view.students, tone: "text-graphite" },
  ];

  return (
    <AdminLayout
      title="Dashboard"
      subtitle={`Signed in as ${user.name} — complaint volume, student count and live activity.`}
      right={
        <>
          <span
            className={online ? "badge" : "badge text-muted"}
            title={
              online
                ? `${presence?.onlineAdmins ?? 0} admin(s) also connected`
                : "Start the chat server with `npm run socket` to see live presence."
            }
            aria-live="polite"
          >
            <span
              className={online ? "pulse-dot" : "pulse-dot-off"}
              aria-hidden="true"
            />
            {online
              ? `${presence?.onlineStudents ?? 0} student${
                  (presence?.onlineStudents ?? 0) === 1 ? "" : "s"
                } online`
              : "socket offline"}
          </span>
          <NeonButton
            variant="ghost"
            onClick={() => void load()}
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

      {/* Stagger assembles the row one tile at a time; each child becomes the
          grid item, so the tiles need h-full to fill a stretched cell. */}
      <section aria-label="Complaint totals">
        <Stagger
          step={60}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          {tiles.map((tile) => (
            <GlassCard key={tile.label} hover className="h-full px-4 py-5">
              <p
                className={`font-display text-[2rem] font-bold leading-none tracking-tight tabular-nums sm:text-[2.5rem] ${
                  hasStats ? tile.tone : "text-muted/40"
                }`}
              >
                {hasStats ? tile.value.toLocaleString() : "—"}
              </p>
              <p className="mt-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-muted">
                {tile.label}
              </p>
            </GlassCard>
          ))}
        </Stagger>
      </section>

      <GlassCard className="mt-6 overflow-hidden">
        <PanelHeader
          title="Recent activity"
          subtitle="The eight newest complaints across every student."
          right={
            <NeonLink href="/admin/complaints" variant="ghost">
              Open queue
            </NeonLink>
          }
        />

        {view.recent.length === 0 ? (
          <EmptyState
            title={
              loading && !hasStats ? "Loading activity…" : "No complaints yet"
            }
            hint={
              hasStats
                ? "Submissions from students will appear here as they arrive."
                : "Nothing to show until the dashboard stats load."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {view.recent.map((complaint) => (
              <li key={complaint.id}>
                <Link
                  href="/admin/complaints"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-veil"
                >
                  <span className="w-full truncate text-sm font-medium text-graphite sm:w-auto sm:min-w-0 sm:flex-1">
                    {complaint.title}
                  </span>
                  <StatusBadge status={complaint.status} />
                  <span className="text-xs text-muted">
                    {complaint.studentName}
                  </span>
                  <time
                    dateTime={complaint.createdAt}
                    className="text-xs text-muted/70"
                  >
                    {dateTimeLabel(complaint.createdAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </AdminLayout>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const gate = await requirePage(ctx, "ADMIN");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
