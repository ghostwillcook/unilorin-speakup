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
import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import { wlBody, wlDisplay } from "@/lib/fonts";

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
      hint: "Contact the Student Affairs Unit if you believe this is a mistake.",
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
        hint: "Please contact the Student Affairs Unit.",
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
  const [showPassword, setShowPassword] = useState(false);
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
        <title>Sign in · UNILORIN Student Connect</title>
      </Head>

      {/* The auth spec's canvas: soft off-white, the 480px elevated card
          centered on desktop, full-height with 24px margins on mobile. The
          wl-page wrapper brings the Wollo tokens and fonts to exactly this
          surface and no further. */}
      <main
        className={`wl-page flex min-h-screen flex-col items-center px-6 py-10 sm:py-14 ${wlDisplay.variable} ${wlBody.variable}`}
      >
        <div className="w-full max-w-[480px]">
          {/* Back as the spec's floating circular glass orb. */}
          <div className="flex items-center justify-between">
            <Link href="/" className="wl-orb" aria-label="Back to home">
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              <UnilorinLogo size={28} />
              <span className="text-sm">
                <SpeakUpWordmark compact />
              </span>
            </div>
          </div>

          {/* The card's top padding leaves a nest for the diorama lock, which
              breaks the card's top border the way the landing hero's objects
              break its frame. */}
          <div className="wl-auth-card relative mt-8 px-6 pb-8 pt-14 sm:px-8">
            <DioramaLock />

            <div className="text-center">
              <h1 className="wl-auth-title">Welcome Back</h1>
              <p className="wl-auth-sub mt-1.5">
                Enter your credentials to access your account
              </p>
            </div>

            {notice && (
              <div className="wl-auth-notice mt-6" role="alert">
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

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label htmlFor="email" className="wl-label">
                  Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  inputMode="email"
                  className="wl-input"
                  placeholder="you@students.unilorin.edu.ng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="studentId" className="wl-label">
                    Student ID
                  </label>
                  <span className="wl-label-aux">Students only</span>
                </div>
                <input
                  id="studentId"
                  name="studentId"
                  type="text"
                  autoComplete="username"
                  aria-describedby="studentId-hint"
                  className="wl-input"
                  placeholder="19/52HL123"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  disabled={submitting}
                />
                <p id="studentId-hint" className="mt-1.5 px-4 text-xs text-[var(--wl-slate)]">
                  Administrators can leave this blank.
                </p>
              </div>

              <div>
                <label htmlFor="password" className="wl-label">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="wl-input pr-12"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    className="wl-input-eye"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={0}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="wl-auth-submit"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="mt-6 border-t border-[var(--wl-rule)] pt-5 text-center text-xs leading-relaxed text-[var(--wl-slate)]">
              Accounts are issued by the Student Affairs Unit. Your name is
              never shown to other students in the live chat.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Diorama graphic — the spec's floating clay lock                            */
/* ------------------------------------------------------------------------- */

/**
 * A matte clay lock breaking the card's top border. Same recipe as the landing
 * shapes: soft gradient "clay" fills wrapped in .wl-shape, whose ::after lays
 * the grain that kills the plastic gloss. It overlaps the card edge via the
 * negative top inset, and its idle float is the landing page's own keyframes.
 */
function DioramaLock() {
  return (
    <div
      className="absolute -top-9 left-1/2 w-[4.5rem] -translate-x-1/2"
      aria-hidden="true"
    >
      <span className="wl-float block" style={{ "--wl-tilt": "0deg" } as React.CSSProperties}>
        <span className="wl-shape block h-auto w-full drop-shadow-[0_16px_32px_rgba(16,2,111,0.35)]">
          <svg viewBox="0 0 96 104" width="100%" height="auto">
            <defs>
              <linearGradient id="wl-lock-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8fd0ff" />
                <stop offset="1" stopColor="#4a7dff" />
              </linearGradient>
              <linearGradient id="wl-lock-shackle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9deff" />
                <stop offset="1" stopColor="#ac2ebc" />
              </linearGradient>
            </defs>
            <path
              d="M28 46V34a20 20 0 0 1 40 0v12"
              fill="none"
              stroke="url(#wl-lock-shackle)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <rect x="14" y="44" width="68" height="52" rx="18" fill="url(#wl-lock-body)" />
            <circle cx="48" cy="66" r="7" fill="#10026f" />
            <path
              d="M48 71v9"
              stroke="#10026f"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </span>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
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
