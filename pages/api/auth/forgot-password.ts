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
// production students are not exempt from the daily limit.
const RESET_LIMIT_EXEMPT_EMAILS = new Set([
  "iyanuoluwaotaro@gmail.com",
  "mutmainnahtope@gmail.com",
]);

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
    // lib/rate-limit.ts documents for its userId keys.
    const verdict = checkRateLimit(email);
    if (!verdict.ok) {
      res.status(429).json({
        error: `Too many requests. Try again in ${verdict.retryInSeconds}s.`,
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
    // Trade-off: returning a distinct 429 here reveals the account exists
    // once 5 requests have been made. Accepted because the per-minute limiter
    // already blunts enumeration (probing 5+ times per address takes minutes),
    // a real user locked out of their account needs this specific message,
    // and the owner spec'd the behavior.
    if (
      !RESET_LIMIT_EXEMPT_EMAILS.has(email) &&
      (await countRecentResetRequests(user.id)) >= RESET_REQUEST_LIMIT
    ) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(429).json({
        error:
          "You've reached the daily limit for password reset requests. " +
          "Please try again tomorrow.",
      });
      return;
    }

    const token = await createResetToken(user.id);
    const resetUrl = `${appBaseUrl()}/auth/reset-password?token=${token}`;

    // Detached, mirroring the push fan-out in pages/api/admin/notifications.ts:
    // by this point the token row is committed, so a Resend failure must not
    // turn into a 500 the client would read as "request failed" (and retry,
    // invalidating this link). sendEmail itself never throws; the .catch is
    // safety symmetry with that file, not an expectation.
    setImmediate(() => {
      void sendEmail({
        ...resetRequestEmail(user.name, resetUrl, TOKEN_TTL_MINUTES),
        to: user.email,
      }).catch(() => {});
    });

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
