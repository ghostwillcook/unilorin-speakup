import { useState } from "react";
import type { FormEvent } from "react";
import Head from "next/head";
import Link from "next/link";
import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import { wlBody, wlDisplay } from "@/lib/fonts";

/** One user-facing failure: headline plus an optional second line. */
type Notice = { message: string; hint?: string };

/**
 * The "I can't get in" half of password reset.
 *
 * Flow: /auth/signin ("Forgot password?") → HERE → email → /auth/reset-password.
 *
 * The page is deliberately as dumb as the landing page: it only posts the
 * email and shows a generic acknowledgement, so nothing here can fail on a
 * missing backend beyond the fetch itself.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setNotice({ message: "Enter your email address to continue." });
      return;
    }

    setNotice(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      if (res.ok) {
        // `submitting` stays true on purpose: the form is replaced by the
        // acknowledgement below, so the loading state never has to unwind.
        setSent(true);
        return;
      }

      const data = (await res.json().catch(() => null)) as {
        error?: string;
        hint?: string;
      } | null;

      if (res.status === 503) {
        // Email sending is not configured on the server. This one failure is
        // worth naming instead of hiding behind the generic message, because
        // "check your inbox" would be a lie — no link is coming.
        setNotice({
          message: data?.error ?? "Password reset emails are not available right now.",
          hint: data?.hint ?? "The administrator needs to configure email sending first.",
        });
      } else if (res.status === 429) {
        setNotice({
          message: data?.error ?? "Too many requests. Please wait a moment and try again.",
        });
      } else {
        setNotice({ message: "Something went wrong. Try again." });
      }
      setSubmitting(false);
    } catch {
      setNotice({ message: "Something went wrong. Try again." });
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Forgot Password — UNILORIN Student Connect</title>
      </Head>

      {/* Same canvas as /auth/signin: soft off-white, the 480px elevated card
          centered on desktop, full-height with margins on mobile. */}
      <main
        className={`wl-page flex min-h-screen flex-col items-center px-6 py-10 sm:py-14 ${wlDisplay.variable} ${wlBody.variable}`}
      >
        <div className="w-full max-w-[480px]">
          <div className="flex items-center justify-between">
            <Link href="/auth/signin" className="wl-orb" aria-label="Back to sign in">
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

          <div className="wl-auth-card relative mt-8 px-6 pb-8 pt-14 sm:px-8">
            <DioramaEnvelope />

            <div className="text-center">
              <h1 className="wl-auth-title">Forgot your password</h1>
              <p className="wl-auth-sub mt-1.5">
                Enter your UNILORIN email and we&apos;ll send you a reset link.
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

            {sent ? (
              // Deliberately generic, in both directions: the server never
              // confirms whether the email has an account, and this page shows
              // the same acknowledgement either way, so the form cannot be
              // used to enumerate accounts.
              <div className="mt-7">
                <div
                  className="flex gap-2.5 rounded-2xl border border-emerald-600/25 bg-emerald-500/5 p-4 text-sm leading-relaxed text-[var(--wl-ink)]"
                  role="status"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-emerald-600"
                  >
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
                    <path
                      d="M8 12.5l2.7 2.7L16 9.5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>
                    If that email has an account, a reset link is on its way.
                    Check your inbox (and spam folder).
                  </span>
                </div>
                <Link href="/auth/signin" className="wl-auth-submit mt-5">
                  Back to sign in
                </Link>
              </div>
            ) : (
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

                <button
                  type="submit"
                  className="wl-auth-submit"
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting ? "Sending…" : "Send Reset Link"}
                </button>
              </form>
            )}

            <p className="mt-6 border-t border-[var(--wl-rule)] pt-5 text-center text-xs leading-relaxed text-[var(--wl-slate)]">
              Accounts are issued by the Student Affairs Unit. If you
              don&apos;t have an account, a reset link cannot be sent.
            </p>
          </div>

          <p className="mt-6 text-center text-sm">
            <Link
              href="/auth/signin"
              className="font-semibold text-[var(--wl-violet)] hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Diorama graphic — the spec's floating clay envelope                        */
/* ------------------------------------------------------------------------- */

/**
 * A matte clay envelope breaking the card's top border, the same recipe as
 * the sign-in page's lock: soft gradient "clay" fills wrapped in .wl-shape,
 * whose ::after lays the grain that kills the plastic gloss.
 */
function DioramaEnvelope() {
  return (
    <div
      className="absolute -top-9 left-1/2 w-[4.5rem] -translate-x-1/2"
      aria-hidden="true"
    >
      <span className="wl-float block" style={{ "--wl-tilt": "0deg" } as React.CSSProperties}>
        <span className="wl-shape block h-auto w-full drop-shadow-[0_16px_32px_rgba(16,2,111,0.35)]">
          <svg viewBox="0 0 96 84" width="100%" height="auto">
            <defs>
              <linearGradient id="wl-env-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8fd0ff" />
                <stop offset="1" stopColor="#4a7dff" />
              </linearGradient>
              <linearGradient id="wl-env-flap" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9deff" />
                <stop offset="1" stopColor="#ac2ebc" />
              </linearGradient>
            </defs>
            <rect x="6" y="14" width="84" height="60" rx="14" fill="url(#wl-env-body)" />
            <path
              d="M10 24 48 52 86 24"
              fill="none"
              stroke="url(#wl-env-flap)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="48" cy="52" r="6" fill="#10026f" />
          </svg>
        </span>
      </span>
    </div>
  );
}
