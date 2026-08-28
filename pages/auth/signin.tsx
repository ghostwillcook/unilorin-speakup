import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { signIn, getSession } from "next-auth/react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { landingFor } from "@/lib/roles";
import GlassCard from "@/components/GlassCard";
import NeonButton from "@/components/NeonButton";
import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import { Reveal } from "@/components/Motion";

/* ------------------------------------------------------------------------- */
/* Error mapping                                                              */
/* ------------------------------------------------------------------------- */

/** One user-facing failure: headline plus an optional second line. */
type Notice = { message: string; hint?: string };

const BAD_CREDENTIALS = "Incorrect email, student ID or password.";

/**
 * Failures reach this page in two shapes, and both go through here:
 *
 *   1. `res.error` from signIn({ redirect: false }) — NextAuth's own codes
 *      ("CredentialsSignin") or the messages lib/auth.ts throws from
 *      authorize() ("This account has been deactivated.").
 *   2. `?error=` on the URL, because authOptions.pages.error points at this
 *      page — including the `?error=deactivated` that lib/guards.ts sends when
 *      a blocked account still holds a valid JWT.
 */
function noticeFor(raw: string): Notice {
  const code = raw.trim();
  const lower = code.toLowerCase();

  // Substring checks first: the deactivated and unconfigured-database cases
  // arrive either as a thrown sentence or as a short token, depending on route.
  if (lower.includes("deactivat")) {
    return {
      message: "This account has been deactivated.",
      hint: "Contact the Students Affairs Unit if you believe this is a mistake.",
    };
  }
  if (lower.includes("database")) {
    return {
      message: "Database is not configured yet.",
      hint: "Sign-in starts working once the administrator sets DATABASE_URL and runs the migrations.",
    };
  }

  switch (lower) {
    case "credentialssignin":
      // Deliberately vague — the same message for an unknown email and a wrong
      // password, so the form cannot be used to enumerate accounts.
      return { message: BAD_CREDENTIALS };
    case "sessionrequired":
      return { message: "Please sign in to continue." };
    case "accessdenied":
      return { message: "You do not have access to that page." };
    case "configuration":
      return {
        message: "Sign-in is misconfigured on the server.",
        hint: "Please contact the Students Affairs Unit.",
      };
    default:
      // A thrown message reads as a sentence and is worth showing verbatim;
      // a bare unknown code is not, so it degrades to the generic failure.
      return { message: /\s/.test(code) ? code : BAD_CREDENTIALS };
  }
}

/* ------------------------------------------------------------------------- */
/* ?next= handling                                                            */
/* ------------------------------------------------------------------------- */

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `next` is attacker-controlled, so only same-origin paths are honoured.
 * A leading "/" is not sufficient on its own: "//evil.com" and "/\evil.com"
 * are protocol-relative absolute URLs and would be an open redirect. /auth/*
 * is refused as well, so a successful sign-in can never bounce back here.
 */
function safeNext(value: string | string[] | undefined): string | null {
  const next = firstParam(value)?.trim();
  if (!next || !next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next.startsWith("/auth/") || next.startsWith("/api/")) return null;
  return next;
}

/* ------------------------------------------------------------------------- */
/* Page                                                                       */
/* ------------------------------------------------------------------------- */

export default function SignInPage() {
  const router = useRouter();
  const queryError = firstParam(router.query.error);

  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(() =>
    queryError ? noticeFor(queryError) : null,
  );

  // NextAuth can redirect an error onto this page while it is already mounted,
  // so the query is watched rather than read once at mount.
  useEffect(() => {
    setNotice(queryError ? noticeFor(queryError) : null);
  }, [queryError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setNotice({ message: "Enter your email and password to continue." });
      return;
    }

    setNotice(null);
    setSubmitting(true);

    try {
      // redirect: false keeps the failure on this page so it can be rendered as
      // a notice instead of a full-page NextAuth error round trip.
      const res = await signIn("credentials", {
        email: trimmedEmail,
        studentId: studentId.trim(),
        password,
        redirect: false,
      });

      if (!res) {
        setNotice({ message: "Sign-in did not complete. Please try again." });
        setSubmitting(false);
        return;
      }
      if (res.error) {
        setNotice(noticeFor(res.error));
        setSubmitting(false);
        return;
      }

      // The role lives on the JWT, which is only readable once the cookie is
      // set — so it is read back from the session rather than guessed from the
      // form. If the read somehow comes back empty the student dashboard is the
      // safe default: requirePage() there redirects an admin onward to /admin.
      const session = await getSession();
      const destination =
        safeNext(router.query.next) ?? landingFor(session?.user?.role ?? "STUDENT");

      // `submitting` stays true on purpose: the button holds its loading state
      // until the destination takes over the page.
      await router.push(destination);
    } catch (err) {
      setNotice({
        message: "Could not reach the sign-in service.",
        hint: err instanceof Error ? err.message : "Check your connection and try again.",
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Sign in · UNILORIN SpeakUp</title>
      </Head>

      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-graphite"
          >
            <span aria-hidden="true">&larr;</span> Back to home
          </Link>

          <Reveal>
          <GlassCard className="mt-4 p-7 sm:p-8">
            <div className="flex flex-col items-center text-center">
              {/* One crest, not two: the Students Affairs Unit shield was a
                  placeholder (no real asset) and duplicated the university
                  identity the UNILORIN crest already carries — this is a Unit
                  initiative on the university's platform. */}
              <UnilorinLogo size={64} />

              <span className="mt-4 text-xl">
                <SpeakUpWordmark />
              </span>

              <h1 className="display-sm mt-3">Sign in</h1>
              <p className="mt-1.5 text-sm text-muted">
                Students Affairs Unit &middot; University of Ilorin
              </p>
            </div>

            {notice && (
              <div className="notice notice-error mt-6" role="alert">
                <WarningIcon />
                <span>
                  {notice.message}
                  {notice.hint && (
                    <span className="mt-1 block text-xs opacity-80">
                      {notice.hint}
                    </span>
                  )}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="field-label">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  inputMode="email"
                  className="field"
                  placeholder="you@students.unilorin.edu.ng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="studentId" className="field-label">
                    Student ID
                  </label>
                  <span
                    id="studentId-scope"
                    className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted"
                  >
                    Students only
                  </span>
                </div>
                <input
                  id="studentId"
                  name="studentId"
                  type="text"
                  autoComplete="username"
                  aria-describedby="studentId-scope studentId-hint"
                  className="field"
                  placeholder="19/52HL123"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={submitting}
                />
                <p id="studentId-hint" className="mt-1.5 text-xs text-muted">
                  Administrators can leave this blank.
                </p>
              </div>

              <div>
                <label htmlFor="password" className="field-label">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="field"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <NeonButton
                type="submit"
                className="w-full"
                loading={submitting}
                disabled={submitting}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </NeonButton>
            </form>

            <p className="mt-6 border-t border-line pt-5 text-center text-xs leading-relaxed text-muted">
              Accounts are issued by the Students Affairs Unit. Your name is
              never shown to other students in the live chat.
            </p>
          </GlassCard>
          </Reveal>
        </div>
      </main>
    </>
  );
}

function WarningIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <path
        d="M12 4.5 21 20H3L12 4.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v4.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.4" r="1" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------------- */
/* Server guard                                                               */
/* ------------------------------------------------------------------------- */

export const getServerSideProps: GetServerSideProps<
  Record<string, never>
> = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  const user = session?.user;

  // A signed-in, active user never sees the form. Deactivated sessions are
  // deliberately excluded: requirePage() sends those straight back here with
  // ?error=deactivated, so redirecting them onward would loop forever.
  if (user?.isActive) {
    return {
      redirect: {
        destination: safeNext(ctx.query.next) ?? landingFor(user.role),
        permanent: false,
      },
    };
  }

  return { props: {} };
};
