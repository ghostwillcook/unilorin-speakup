import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { UnilorinLogo, SpeakUpWordmark } from "@/components/Logo";
import { wlBody, wlDisplay } from "@/lib/fonts";

/** One user-facing failure: headline plus an optional second line. */
type Notice = { message: string; hint?: string };

/**
 * The "choose a new password" half of password reset.
 *
 * Flow: /auth/forgot-password → email → HERE (?token=…) → new password →
 * /auth/signin.
 *
 * The token is read client-side because this is a static page: router.query
 * only settles after hydration, so the missing-token state is a render pass,
 * not a server redirect.
 */
export default function ResetPasswordPage() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [changed, setChanged] = useState(false);

  // router.query is empty during the first render of a static page, so the
  // token is picked up in an effect once the query settles (same pattern as
  // the admin pages' ?status= filters).
  useEffect(() => {
    const raw = router.query.token;
    const value = Array.isArray(raw) ? raw[0] : raw;
    setToken(value?.trim() || null);
    setTokenReady(true);
  }, [router.query.token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    if (password.length < 8) {
      setNotice({ message: "Your new password must be at least 8 characters." });
      return;
    }
    if (password !== confirmPassword) {
      setNotice({ message: "The two passwords do not match." });
      return;
    }

    setNotice(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        // `submitting` stays true on purpose: the form is replaced by the
        // success panel, so the loading state never has to unwind.
        setChanged(true);
        return;
      }

      const data = (await res.json().catch(() => null)) as {
        error?: string;
        hint?: string;
      } | null;

      if (res.status === 410) {
        setNotice({
          message: "This reset link has expired or was already used.",
          hint: "Request a new one below.",
        });
      } else if (res.status === 429) {
        setNotice({
          message: data?.error ?? "Too many requests. Please wait a moment and try again.",
        });
      } else if (data?.error) {
        // 400s carry a server-written sentence (invalid token, weak password).
        setNotice({ message: data.error });
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
        <title>Reset Password — UNILORIN Student Connect</title>
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
            <DioramaKey />

            <div className="text-center">
              <h1 className="wl-auth-title">Reset your password</h1>
              <p className="wl-auth-sub mt-1.5">
                Choose a new password for your account
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

            {tokenReady && !token ? (
              /* A link without a token can never succeed — offer the way back
                  to a fresh request instead of a form that would only 400. */
              <div className="mt-7 text-center">
                <p className="text-sm leading-relaxed text-[var(--wl-slate)]">
                  This reset link is incomplete. Request a new one.
                </p>
                <Link href="/auth/forgot-password" className="wl-auth-submit mt-5">
                  Request a new link
                </Link>
              </div>
            ) : changed ? (
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
                  <span>Your password has been changed.</span>
                </div>
                <Link href="/auth/signin" className="wl-auth-submit mt-5">
                  Back to sign in
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-7 space-y-5">
                <div>
                  <label htmlFor="password" className="wl-label">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="wl-input pr-12"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting || !tokenReady}
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

                <div>
                  <label htmlFor="confirmPassword" className="wl-label">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirm ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      className="wl-input pr-12"
                      placeholder="Re-enter your new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={submitting || !tokenReady}
                    />
                    <button
                      type="button"
                      className="wl-input-eye"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      aria-pressed={showConfirm}
                      onClick={() => setShowConfirm((v) => !v)}
                      tabIndex={0}
                    >
                      {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="wl-auth-submit"
                  disabled={submitting || !tokenReady}
                  aria-busy={submitting}
                >
                  {submitting ? "Changing…" : "Change Password"}
                </button>
              </form>
            )}

            <p className="mt-6 border-t border-[var(--wl-rule)] pt-5 text-center text-xs leading-relaxed text-[var(--wl-slate)]">
              Reset links expire after a short time and can only be used once.
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
/* Diorama graphic — the spec's floating clay key                             */
/* ------------------------------------------------------------------------- */

/**
 * A matte clay key breaking the card's top border, the same recipe as the
 * sign-in page's lock: soft gradient "clay" fills wrapped in .wl-shape,
 * whose ::after lays the grain that kills the plastic gloss.
 */
function DioramaKey() {
  return (
    <div
      className="absolute -top-9 left-1/2 w-[4.5rem] -translate-x-1/2"
      aria-hidden="true"
    >
      <span className="wl-float block" style={{ "--wl-tilt": "0deg" } as React.CSSProperties}>
        <span className="wl-shape block h-auto w-full drop-shadow-[0_16px_32px_rgba(16,2,111,0.35)]">
          <svg viewBox="0 0 96 96" width="100%" height="auto">
            <defs>
              <linearGradient id="wl-key-head" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#8fd0ff" />
                <stop offset="1" stopColor="#4a7dff" />
              </linearGradient>
              <linearGradient id="wl-key-shaft" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9deff" />
                <stop offset="1" stopColor="#ac2ebc" />
              </linearGradient>
            </defs>
            <circle cx="30" cy="34" r="18" fill="url(#wl-key-head)" />
            <circle cx="30" cy="34" r="7" fill="#10026f" />
            <path
              d="M42 46 76 80"
              stroke="url(#wl-key-shaft)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M64 68l8 8M56 60l8 8"
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
