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

  return (
    <>
      <Head>
        <title>Student dashboard · UNILORIN SpeakUp</title>
      </Head>

      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-3">
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

        <main className="mx-auto w-full max-w-5xl px-5 py-6">
          <nav className="flex flex-wrap gap-2" aria-label="Dashboard sections">
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
