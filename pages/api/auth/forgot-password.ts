import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { guarded, methodNotAllowed, requireDb } from "@/lib/guards";
import { appBaseUrl, isEmailConfigured, sendEmail } from "@/lib/email";
import { resetRequestEmail } from "@/lib/email-templates";
import {
  RESET_REQUEST_LIMIT,
  TOKEN_TTL_MINUTES,
  countRecentResetRequests,
  createResetToken,
} from "@/lib/password-reset";

/**
 * POST /api/auth/forgot-password — public entry point of the reset flow.
 *
 * Standalone (not NextAuth): NextAuth owns sign-in, but "email me a link" is
 * for people who CANNOT sign in, so this route must work without a session —
 * and with anyone's email in the body, which is why every decision below is
 * shaped to leak nothing about which addresses have accounts.
 */

// The owner's test accounts — they need unlimited resets while testing;
// production students are not exempt from the daily limit. Read from
// RESET_EXEMPT_EMAILS (comma-separated) so deploy-time overrides don't need a
// code change; the two seed addresses stay as the fallback so behavior is
// unchanged where the env var is unset. Lowercased to match the normalized
// email the route compares against.
const RESET_LIMIT_EXEMPT_EMAILS = new Set(
  (process.env.RESET_EXEMPT_EMAILS ??
    "iyanuoluwaotaro@gmail.com,mutmainnahtope@gmail.com")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * The caller's address, lowercased and trimmed exactly like the email key
 * above so both limiter keys get identical normalization treatment. Prefers
 * Netlify's x-nf-client-connection-ip, which the platform injects itself
 * (not client-overridable like x-forwarded-for, so it cannot be spoofed to
 * bypass the limiter); falls back to the socket address anywhere else
 * (local dev, other hosts). Same per-process caveat lib/rate-limit.ts
 * already documents.
 */
function clientIp(req: NextApiRequest): string {
  const header = req.headers["x-nf-client-connection-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value?.trim() || req.socket.remoteAddress || "unknown")
    .trim()
    .toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!requireDb(res)) return;

  // Checked before anything touches the request body, so the feature degrades
  // to a clear error instead of minting tokens nobody can receive — same
  // contract as /api/upload's storage check.
  if (!isEmailConfigured()) {
    return res.status(503).json({
      error: "Email delivery is not configured on this deployment.",
      hint:
        "Set RESEND_API_KEY (and optionally EMAIL_FROM and APP_URL) in the " +
        "environment to enable password reset emails.",
    });
  }

  await guarded(res, async () => {
    const body = asRecord(req.body as unknown);
    const email = readString(body.email).toLowerCase();

    // Keyed by the (lowercased) email rather than a userId because the caller
    // is anonymous — there is no session to key on. Same in-process limitation
    // lib/rate-limit.ts documents for its userId keys. This fires BEFORE the
    // account lookup, so known and unknown addresses are throttled equally —
    // no oracle here.
    const verdict = checkRateLimit(email);
    if (!verdict.ok) {
      res.status(429).json({
        error: `Too many requests. Try again in ${verdict.retryInSeconds}s.`,
      });
      return;
    }

    // IP-keyed limiter on top of the email-keyed one: the daily cap counts
    // attacker-minted rows against the victim (6 anonymous requests lock the
    // real owner out AND email-bomb them), so the blast radius has to be cut
    // off at the source address. Tighter than the default 20/min — one
    // legitimate person forgets a password a couple of times a minute at
    // most. Trips as the SAME generic 200 as everything else: a distinct 429
    // here would tell a prober which responses mean "an account exists".
    const ip = clientIp(req);
    const ipVerdict = checkRateLimit(ip, 10);
    if (!ipVerdict.ok) {
      console.error(
        "[student-connect:forgot-password] IP rate limit tripped — returning generic 200",
        { ip, retryInSeconds: ipVerdict.retryInSeconds },
      );
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(200).json({
        message: "If that email has an account, a reset link has been sent.",
      });
      return;
    }

    // Normalize exactly like authorize() in lib/auth.ts (trim + lowercase) so
    // a reset request for the address someone signs in with always matches.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    // Same generic 200 whether or not the account was found — this route must
    // not be usable to enumerate valid emails, the same reasoning as
    // authorize()'s identical failure for a missing account and a wrong
    // password in lib/auth.ts. An unknown address returns immediately, having
    // done nothing else.
    if (!user) {
      res.status(200).json({
        message: "If that email has an account, a reset link has been sent.",
      });
      return;
    }

    // Daily limiter (max 5 requests per account per rolling 24h). Runs after
    // the per-minute checkRateLimit above so the minute limiter still fires
    // first, and only for KNOWN accounts — unknown emails return the generic
    // 200 above untouched.
    //
    // The limit is enforced silently: this branch returns the SAME generic
    // 200 as the success path, not a distinct 429. A 429 told a prober "this
    // address has an account once its cap is hit" — an enumeration oracle the
    // old in-code mitigation comment dismissed by claiming probing takes
    // minutes, which was wrong (the per-minute limiter allows 20 per 60s, so
    // 5 probes against one address fit comfortably inside a single window).
    // The rate-limit hit is logged server-side instead so operators can still
    // see a locked-out real user; the user themselves gets the same "link
    // sent" copy everyone gets, which is the price of not leaking existence.
    if (
      !RESET_LIMIT_EXEMPT_EMAILS.has(email) &&
      (await countRecentResetRequests(user.id)) >= RESET_REQUEST_LIMIT
    ) {
      console.error(
        "[student-connect:forgot-password] daily reset limit reached for known account — returning generic 200",
        { userId: user.id },
      );
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(200).json({
        message: "If that email has an account, a reset link has been sent.",
      });
      return;
    }

    const token = await createResetToken(user.id);
    const resetUrl = `${appBaseUrl()}/auth/reset-password?token=${token}`;

    // AWAITED, not detached: on serverless (Netlify Functions / Lambda) the
    // execution environment freezes as soon as the response is returned, so a
    // setImmediate send is a race it sometimes loses — the token row lands but
    // the email never goes out (seen in production: first test delivered, a
    // later identical request silently dropped). Awaiting costs one Resend
    // round-trip (~500ms) and guarantees the send happens inside the
    // invocation. sendEmail never throws and reports { ok: false, error }
    // instead; the failure is logged (a dead Resend key otherwise looks like
    // "students aren't getting links" with zero trace in the function logs)
    // but must not change the response: the client contract stays "link sent"
    // so a transient Resend hiccup doesn't read as "request failed" and
    // trigger a retry that invalidates this link — the token row is the
    // source of truth.
    const sent = await sendEmail({
      ...resetRequestEmail(user.name, resetUrl, TOKEN_TTL_MINUTES),
      to: user.email,
    }).catch(() => ({ ok: false as const, error: "sendEmail threw unexpectedly." }));
    if (!sent.ok) {
      console.error(
        "[student-connect:forgot-password] reset email failed to send",
        { to: user.email, error: sent.error },
      );
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      message: "If that email has an account, a reset link has been sent.",
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
