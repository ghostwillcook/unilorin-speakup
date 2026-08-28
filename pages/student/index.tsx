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
import ChatPanel from "@/components/ChatPanel";
import DMPanel from "@/components/DMPanel";
import ComplaintForm from "@/components/ComplaintForm";
import StudentDock from "@/components/StudentDock";
import { useHeaderFold } from "@/lib/useHeaderFold";

interface StudentComplaint {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
}

const TABS = [
  { key: "chat", label: "Live Chat" },
  { key: "dm", label: "Direct Message" },
  { key: "complaint", label: "Lodge Complaint" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// The mobile dock mirrors the desktop tab bar but with the spec's shorter
// labels ("Chat"/"Messages"/"Lodge") and an icon per slot. Keys are shared
// with TABS so the two navigations stay in lockstep.
const DOCK_TABS = [
  { key: "chat", label: "Chat", icon: "chat" as const },
  { key: "dm", label: "Messages", icon: "dm" as const },
  { key: "complaint", label: "Lodge", icon: "complaint" as const },
];

export default function StudentDashboard({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState<TabKey>("chat");
  const [complaints, setComplaints] = useState<StudentComplaint[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  const activeIndex = TABS.findIndex((t) => t.key === tab);

  // Fold the header away on scroll, but only below md — above that the
  // header is the roomier desktop bar and stays put. Defaults match this
  // breakpoint, so no options are needed.
  const folded = useHeaderFold();

  // Greeting pieces for the mobile header row: the first word of the name,
  // plus a two-letter monogram (first initial of first AND last name).
  const nameParts = user.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? user.name;
  const initials = (
    firstName.charAt(0) + (nameParts[nameParts.length - 1] ?? "").charAt(0)
  ).toUpperCase();

  return (
    <>
      <Head>
        <title>Student dashboard · UNILORIN SpeakUp</title>
      </Head>

      <div className="min-h-screen">
        {/* fold-header[-hidden] carries the translateY transition (globals.css);
            useHeaderFold only decides WHEN, because only this component knows
            the bar is sticky and mobile-only. */}
        <header
          className={`sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md fold-header ${folded ? "fold-header-hidden" : ""}`}
        >
          {/* Mobile greeting row — the spec's "primary home header". wl-scope
              supplies the --wl-* custom properties that .wl-greet-name,
              .wl-greet-sub and .wl-avatar consume in globals.css. */}
          <div className="wl-scope mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 md:hidden">
            <div className="min-w-0">
              <p className="wl-greet-name truncate">Hello, {firstName}</p>
              <p className="wl-greet-sub truncate">
                {user.studentId} · Student
              </p>
            </div>
            <span className="wl-avatar" aria-hidden="true">
              {initials}
            </span>
          </div>

          {/* Desktop row — the original header contents, untouched, just
              hidden on mobile where the greeting row takes over. */}
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
              <button
                className="btn-ghost"
                onClick={() => void signOut({ callbackUrl: "/" })}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* pb-32 keeps the last of the content clear of the floating dock on
            mobile; desktop has no dock and keeps the original spacing. */}
        <main className="mx-auto w-full max-w-5xl px-5 py-6 pb-32 md:pb-6">
          {/* Desktop-only tab bar — on phones the StudentDock below replaces
              it (same tab keys, plus the account sheet via Menu). */}
          <nav className="hidden flex-wrap gap-2 md:flex" aria-label="Dashboard sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${tab === t.key ? "tab-active" : ""}`}
                aria-current={tab === t.key ? "page" : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {warning && (
            <div className="notice notice-warn mt-5" role="status">
              {warning}
            </div>
          )}

          <div className="mt-5">
            <SlideSwitch activeKey={tab} index={activeIndex}>
              {tab === "chat" && <ChatPanel />}
              {tab === "dm" && <DMPanel />}
              {tab === "complaint" && (
                <div className="space-y-6">
                  <ComplaintForm onSubmitted={() => void load()} />
                  <section className="surface overflow-hidden">
                    <div className="border-b border-line px-5 py-4">
                      <h2 className="text-graphite text-lg font-semibold">
                        Your complaints
                      </h2>
                      <p className="mt-0.5 text-sm text-muted">
                        Status updates and replies from the Unit appear here.
                      </p>
                    </div>

                    {complaints.length === 0 ? (
                      <EmptyState
                        title={
                          loaded
                            ? "You have not lodged any complaints yet."
                            : "Loading…"
                        }
                        hint={
                          loaded
                            ? "Anything you submit above will show up here with its status."
                            : undefined
                        }
                      />
                    ) : (
                      <ul className="divide-y divide-line">
                        {complaints.map((c) => (
                          <li key={c.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="font-semibold text-graphite">
                                {c.title}
                              </h3>
                              <StatusBadge status={c.status} />
                            </div>
                            <p className="mt-1 text-xs text-muted">
                              {dateTimeLabel(c.createdAt)}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                              {c.description}
                            </p>

                            {c.files.length > 0 && (
                              <ul className="mt-3 flex flex-wrap gap-2">
                                {c.files.map((f, i) => (
                                  <li key={f}>
                                    {/* The bucket is private: `f` is a storage
                                        object key, so it has to be fetched
                                        through the authorising route rather
                                        than linked to directly. */}
                                    <a
                                      href={`/api/attachments/${f}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="badge border border-line bg-veil text-accent"
                                    >
                                      Attachment {i + 1}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {c.adminReply && (
                              <div className="bubble bubble-staff mt-3 max-w-none">
                                <p className="text-xs font-semibold uppercase tracking-wider text-accent/80">
                                  Students Affairs Unit
                                </p>
                                <p className="mt-1 whitespace-pre-wrap">
                                  {c.adminReply}
                                </p>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </SlideSwitch>
          </div>
        </main>

        {/* The floating bottom dock, mobile only — wl-scope for the --wl-*
            vars its pill/sheet classes need. Sign-out lands back on the
            landing page, same as the desktop header button. */}
        <div className="wl-scope md:hidden">
          <StudentDock
            tabs={DOCK_TABS}
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
            user={user}
            onSignOut={() => void signOut({ callbackUrl: "/" })}
          />
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<{
  user: SessionUser;
}> = async (ctx) => {
  const gate = await requirePage(ctx, "STUDENT");
  if (isRedirect(gate)) return gate;
  return { props: { user: gate.user } };
};
