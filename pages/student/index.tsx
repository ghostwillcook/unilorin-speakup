import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import { signOut } from "next-auth/react";
import { requirePage, isRedirect, type SessionUser } from "@/lib/guards";
import { SpeakUpWordmark, UnilorinLogo } from "@/components/Logo";
import { EmptyState } from "@/components/GlassCard";
import StatusBadge, { type ComplaintStatus } from "@/components/StatusBadge";
import { SlideSwitch } from "@/components/Motion";
import { dateTimeLabel } from "@/lib/pseudonym";
import { useHeaderFold } from "@/lib/useHeaderFold";
import StudentDock from "@/components/StudentDock";
import ComplaintThread from "@/components/ComplaintThread";
import ComplaintForm from "@/components/ComplaintForm";
import MessagesPanel from "@/components/MessagesPanel";
import NotificationBell from "@/components/NotificationBell";
import AnonymousRoomPanel from "@/components/AnonymousRoomPanel";
import NeonButton from "@/components/NeonButton";

interface StudentComplaint {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
  lastMessage: { content: string; senderRole: string; createdAt: string } | null;
  unread: number;
}

/**
 * The student console.
 *
 * Four sections — My Complaints (the default, per the spec: a signed-in
 * student lands on their complaints), Lodge Complaint, Messages, and the
 * Anonymous Room — reached through a desktop side rail that mirrors the admin
 * console's, and through the mobile bottom dock. Each complaint opens its own
 * dedicated two-way thread (ComplaintThread), entirely separate from Messages.
 *
 * Messages is the one private channel with the Unit that used to be split
 * across Direct Messages and Live Chat; the histories were merged, so there
 * is a single panel (MessagesPanel) over the livechat model and API.
 *
 * Messages vs Anonymous Room: Messages is the student's private conversation
 * with the Unit; the Anonymous Room is the public student-to-student square
 * under a pseudonym. Same socket, different tables, different promises — kept
 * as separate sections so neither leaks into the other's expectations.
 */

type SectionKey = "complaints" | "lodge" | "messages" | "room";

const SECTIONS: Array<{
  key: SectionKey;
  label: string;
}> = [
  { key: "complaints", label: "My Complaints" },
  { key: "lodge", label: "Lodge Complaint" },
  { key: "messages", label: "Messages" },
  { key: "room", label: "Anonymous Room" },
];

/** Dock destinations. The first three are the dock bar's slots (the fourth
 *  bar slot is always Menu); the account sheet lists ALL entries, which is why
 *  Lodge Complaint rides along here as sheet-only — it never fits on the bar.
 *  The Messages icon is the envelope ("dm"), not the chat bubble — the private
 *  thread must never read as the Anonymous Room's square. */
const DOCK_TABS = [
  { key: "complaints", label: "Complaints", icon: "complaint" as const },
  { key: "messages", label: "Messages", icon: "dm" as const },
  { key: "room", label: "Room", icon: "room" as const },
  { key: "lodge", label: "Lodge Complaint", icon: "complaint" as const },
];

export default function StudentDashboard({ user }: { user: SessionUser }) {
  // Complaints open first after login — the spec's default landing view.
  const [section, setSection] = useState<SectionKey>("complaints");
  const [complaints, setComplaints] = useState<StudentComplaint[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: string } | null>(null);

  // Fold the header away on scroll, but only below md — above that the
  // header is the roomier desktop bar and stays put. `pinned` while the
  // notification dropdown is open: the panel hangs off the header, so the
  // header must not fold away mid-read.
  const [bellOpen, setBellOpen] = useState(false);
  const folded = useHeaderFold({ pinned: bellOpen });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/complaints");
      if (res.status === 503) {
        const body = (await res.json()) as { hint?: string };
        setWarning(body.hint ?? "The database is not configured yet.");
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { complaints: StudentComplaint[] };
      setComplaints(body.complaints);
      setWarning(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The submission toast: non-blocking, tappable to open the new thread,
  // self-dismissing. It never interrupts what the student was doing.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = complaints.find((c) => c.id === selectedId) ?? null;

  const openComplaint = useCallback((id: string) => {
    setSelectedId(id);
    setSection("complaints");
  }, []);

  const activeIndex = SECTIONS.findIndex((s) => s.key === section);
  // The slide key folds in the selected complaint id too: tapping a toast (or
  // any other path) to open a different complaint while a detail is already
  // open must remount ComplaintThread, not reuse it with stale state.
  const slideKey =
    section + (section === "complaints" && selectedId ? `:detail:${selectedId}` : "");

  return (
    <>
      <Head>
        <title>Student dashboard · UNILORIN SpeakUp</title>
      </Head>

      <div className="min-h-screen">
        {/* z-20 normally; z-40 while a notification dropdown is open. The
            dropdown lives INSIDE this header, so it is capped by the header's
            own stacking context — its z-40 alone cannot clear the mobile dock
            (z-30) or the dock's account sheet (z-31). Lifting the whole
            header while the bell's menu is up (onOpenChange below) puts every
            descendant, dropdown included, above them. */}
        <header
          className={`fold-header sticky top-0 ${
            bellOpen ? "z-40" : "z-20"
          } border-b border-line bg-canvas/85 backdrop-blur-md ${
            folded ? "fold-header-hidden" : ""
          }`}
        >
          {/* Mobile: the spec's primary home header (greeting + avatar). The
              wl-scope wrapper carries the --wl-* custom properties that
              .wl-greet-name, .wl-greet-sub and .wl-avatar consume. The bell
              sits between the greeting and the avatar — outside the wl-*
              vocabulary, plain app classes (btn-icon/badge) instead. */}
          <div className="wl-scope mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 md:hidden">
            <div className="min-w-0">
              <p className="wl-greet-name truncate">Hello, {firstName(user.name)}</p>
              <p className="wl-greet-sub truncate">{user.studentId} · Student</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <NotificationBell onOpenChange={setBellOpen} />
              <span className="wl-avatar" aria-hidden="true">
                {initialsFor(user.name)}
              </span>
            </div>
          </div>

          {/* Desktop header: brand + identity + sign out, with the
              notification bell beside the sign-out control. */}
          <div className="mx-auto hidden w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 md:flex">
            <div className="flex items-center gap-3">
              <UnilorinLogo size={34} />
              <SpeakUpWordmark />
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-graphite">{user.name}</p>
                <p className="font-mono text-xs text-muted">{user.studentId}</p>
              </div>
              <NotificationBell onOpenChange={setBellOpen} />
              <button
                className="btn-ghost"
                onClick={() => void signOut({ callbackUrl: "/" })}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-5xl">
          {/* Desktop side rail — the same vocabulary as the admin console's
              sidebar (nav-link / nav-link-active), per the spec's "side
              navigation similar to the admin console". */}
          <aside className="sticky top-[3.75rem] hidden h-fit w-56 shrink-0 flex-col px-3 py-6 lg:flex">
            <p className="field-label px-3">Communication</p>
            <nav aria-label="Dashboard sections">
              <ul className="space-y-0.5">
                {SECTIONS.map((s) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      className={`nav-link relative w-full ${
                        section === s.key ? "nav-link-active" : ""
                      }`}
                      aria-current={section === s.key ? "page" : undefined}
                      onClick={() => {
                        setSection(s.key);
                        setSelectedId(null);
                      }}
                    >
                      {section === s.key && (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent"
                          aria-hidden="true"
                        />
                      )}
                      <SectionIcon kind={s.key} />
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <main className="w-full min-w-0 px-5 pb-32 pt-6 md:pb-6 lg:pl-2">
            {warning && (
              <div className="notice notice-warn mb-5" role="status">
                {warning}
              </div>
            )}

            <SlideSwitch activeKey={slideKey} index={activeIndex}>
              {section === "complaints" &&
                (selected ? (
                  <ComplaintDetail
                    complaint={selected}
                    onBack={() => {
                      setSelectedId(null);
                      void load();
                    }}
                  />
                ) : (
                  <MyComplaints
                    complaints={complaints}
                    loaded={loaded}
                    onOpen={openComplaint}
                    onLodge={() => setSection("lodge")}
                  />
                ))}

              {section === "lodge" && (
                <ComplaintForm
                  onSubmitted={(id) => {
                    void load();
                    if (id) setToast({ id });
                  }}
                />
              )}

              {section === "messages" && <MessagesPanel />}
              {section === "room" && <AnonymousRoomPanel />}
            </SlideSwitch>
          </main>
        </div>

        {/* Submission confirmation: a card above the dock, tap to open the
            new thread, dismiss to keep going. Non-blocking by construction —
            it times itself out. z-10 keeps it below the mobile full-screen
            chat shells (z-20) and the dock, so it can never float over a chat
            composer or swallow a tap meant for one, while still sitting above
            normal page content. */}
        {toast && (
          <div
            className="wl-scope fixed inset-x-4 z-10 md:inset-x-auto md:left-1/2 md:w-[26rem] md:-translate-x-1/2"
            style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}
            role="status"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-[rgb(16_2_111/0.1)] bg-white px-4 py-3.5 shadow-[0_24px_48px_rgb(16_2_111/0.18)]">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--wl-violet)] text-white"
                aria-hidden="true"
              >
                <svg width="17" height="17" viewBox="0 0 24 24">
                  <path
                    d="m5 13 4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  openComplaint(toast.id);
                  setToast(null);
                }}
              >
                <p className="text-sm font-bold text-[var(--wl-ink)]">
                  Complaint Submitted
                </p>
                <p className="truncate text-xs text-[var(--wl-slate)]">
                  Tap to open the conversation with the Unit
                </p>
              </button>
              <button
                type="button"
                className="btn-icon h-8 w-8 shrink-0 rounded-full"
                aria-label="Dismiss"
                onClick={() => setToast(null)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Mobile navigation dock. */}
        <div className="wl-scope md:hidden">
          <StudentDock
            tabs={DOCK_TABS}
            active={section}
            onChange={(k) => {
              setSection(k as SectionKey);
              setSelectedId(null);
            }}
            user={user}
            onSignOut={() => void signOut({ callbackUrl: "/" })}
          />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* My Complaints list                                                         */
/* ------------------------------------------------------------------------- */

function MyComplaints({
  complaints,
  loaded,
  onOpen,
  onLodge,
}: {
  complaints: StudentComplaint[];
  loaded: boolean;
  onOpen: (id: string) => void;
  onLodge: () => void;
}) {
  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-graphite">My Complaints</h2>
            <p className="mt-0.5 text-sm text-muted">
              Each complaint has its own conversation with the Unit.
            </p>
          </div>
          <NeonButton onClick={onLodge}>Lodge a complaint</NeonButton>
        </div>
      </div>

      {complaints.length === 0 ? (
        <EmptyState
          title={loaded ? "You have not lodged any complaints yet." : "Loading…"}
          hint={
            loaded
              ? "When you submit one, it appears here with its own thread you and the Unit can talk in."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {complaints.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-veil"
                onClick={() => onOpen(c.id)}
                aria-label={`Open complaint: ${c.title}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-graphite">
                      {c.title}
                    </h3>
                    {c.unread > 0 && (
                      <span className="badge badge-pending">{c.unread} new</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {dateTimeLabel(c.updatedAt)}
                  </p>
                  {c.lastMessage && (
                    <p className="mt-1.5 truncate text-sm text-muted">
                      <span
                        className={
                          c.lastMessage.senderRole === "ADMIN"
                            ? "font-semibold text-accent"
                            : ""
                        }
                      >
                        {c.lastMessage.senderRole === "ADMIN" ? "Unit: " : "You: "}
                      </span>
                      {c.lastMessage.content}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <StatusBadge status={c.status} />
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    className="text-muted/50"
                    aria-hidden="true"
                  >
                    <path
                      d="m9 6 6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Complaint detail = the record + its dedicated thread                        */
/* ------------------------------------------------------------------------- */

/**
 * The complaint's record is the opening entry of its own thread — opening the
 * conversation visibly refers to the message it is about, on every screen
 * size, instead of a separate card floating outside the conversation.
 */
function ComplaintDetail({
  complaint,
  onBack,
}: {
  complaint: StudentComplaint;
  onBack: () => void;
}) {
  return (
    <ComplaintThread
      complaintId={complaint.id}
      viewerRole="STUDENT"
      title={complaint.title}
      subtitle={`Lodged ${dateTimeLabel(complaint.createdAt)} · conversation with the Unit`}
      badge={<StatusBadge status={complaint.status} />}
      context={
        <div className="mb-5 rounded-xl border border-line bg-veil px-4 py-3.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-accent/70">
            Original complaint
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-graphite/85">
            {complaint.description}
          </p>
          {complaint.files.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {complaint.files.map((f, i) => (
                <li key={f}>
                  {/* The bucket is private: `f` is a storage object key, so it
                      has to be fetched through the authorising route rather
                      than linked to directly. */}
                  <a
                    href={`/api/attachments/${f}`}
                    target="_blank"
                    rel="noreferrer"
                    className="badge border border-line bg-canvas text-accent"
                  >
                    Attachment {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      onBack={onBack}
    />
  );
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0).toUpperCase() ?? "";
  const last =
    parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : "";
  return first + last || "S";
}

function SectionIcon({ kind }: { kind: SectionKey }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-[1.15rem] w-[1.15rem] shrink-0",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (kind === "complaints") {
    return (
      <svg {...common}>
        <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.25L13.5 3Z" />
        <path d="M13.25 3.25V8.5h5.25" />
        <path d="M8.75 13h6.5M8.75 16.5h4" />
      </svg>
    );
  }
  if (kind === "lodge") {
    return (
      <svg {...common}>
        <path d="M12 4.5 21 19.5H3L12 4.5Z" />
        <path d="M12 10v4" />
        <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "messages") {
    // The envelope: Messages is the private line to the Unit, distinct from
    // the Anonymous Room's crowd icon below.
    return (
      <svg {...common}>
        <rect x="3.5" y="5.5" width="17" height="11" rx="3" />
        <path d="m4.5 7 7.5 5 7.5-5" />
      </svg>
    );
  }
  if (kind === "room") {
    // A crowd: the anonymous room is students among students.
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
        <path d="M15.5 5.6a3 3 0 0 1 0 5.8" />
        <path d="M17.4 14.3a5.5 5.5 0 0 1 3.1 4.7" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4c-.5.4-1.3 0-1.3-.6V6.5Z" />
    </svg>
  );
}

export const getServerSideProps: GetServerSideProps<{
  user: SessionUser;
}> = async (ctx) => {
  const gate = await requirePage(ctx, "STUDENT");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
