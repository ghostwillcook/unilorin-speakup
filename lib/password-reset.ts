import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/email";

/**
 * Password-reset tokens: issue, store, and consume.
 *
 * Security property: only the SHA-256 hash of a token is stored. A database
 * leak therefore cannot be replayed as reset links — an attacker with the
 * full PasswordResetToken table still cannot produce a raw token that hashes
 * to a stored row, exactly like password hashing. The raw token exists only
 * in the email link and (briefly) in the consume request.
 */

export const TOKEN_TTL_MINUTES = 60;

/** Max reset requests per user per rolling 24h window (owner spec). */
export const RESET_REQUEST_LIMIT = 5;

/** Length of the rolling window the request limiter counts over. */
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000;

/** SHA-256 hex digest — fast is correct here; this is not a password. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issues a new reset token for `userId` and returns the RAW token (the part
 * that goes into the email link, never the stored hash).
 *
 * The user's existing UNUSED tokens are marked used rather than deleted:
 * consumeResetToken rejects any row with a `usedAt`, so the old links die
 * just as they did under deleteMany (at most one live token per user — a
 * user who requests twice is not protected by the first, possibly stolen,
 * email still working), but the rows survive as the request history the
 * 24h limiter counts.
 *
 * Rows older than 24h are pruned: only the last 24h is needed for the
 * limiter's rolling window, so older rows are dead weight.
 *
 * The three writes are wrapped in a $transaction: the invalidate-prior-tokens
 * step and the create are only meaningful together (at most one live token
 * per user is the invariant the consume side relies on), and the daily
 * limiter counts rows — a create racing a request that already minted its
 * 5th token would let both through, exceeding the 5/day intent and leaving
 * two live tokens at once.
 */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RESET_WINDOW_MS) } },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  // Local and preview environments cannot receive real email (Resend only
  // delivers to the account owner's own address on the test key), so log the
  // link to make the flow testable. Production never prints tokens.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[dev] password reset link: ${appBaseUrl()}/auth/reset-password?token=${token}`,
    );
  }

  return token;
}

/**
 * How many reset requests `userId` has made in the last 24h — used by the
 * daily limiter. Counts ALL rows (used or not): every row is one issued
 * token, which is exactly the limiter's unit.
 */
export async function countRecentResetRequests(
  userId: string,
): Promise<number> {
  return prisma.passwordResetToken.count({
    where: { userId, createdAt: { gte: new Date(Date.now() - RESET_WINDOW_MS) } },
  });
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Validates a raw token and burns it if usable. Marking `usedAt` inside the
 * same call makes the token single-use: a second attempt with the same link
 * finds a used row and fails.
 *
 * The burn is a compare-and-swap, not a read-then-update: the plain update
 * matched only on `id`, so two concurrent consumes of the same link both
 * read an unused row and both succeeded — the token was effectively
 * multi-use under a race. updateMany re-asserts `usedAt: null` (and still
 * unexpired) in the WHERE clause, so exactly one of the racing calls can
 * win; the loser sees count === 0 and reports "expired", the same outcome
 * as any second use of a spent link.
 *
 * A used token is reported as "expired" rather than a distinct reason — the
 * client outcome is identical ("this link no longer works, request a new
 * one"), and collapsing the two avoids hinting an attacker whether the token
 * they hold was ever valid.
 */
export async function consumeResetToken(
  rawToken: string,
): Promise<ConsumeResult> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });

  // findUnique exists only to distinguish invalid (no row) from expired
  // (used/past TTL) for the response copy; the CAS below is what actually
  // decides burn rights.
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt !== null || row.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }

  const burn = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (burn.count === 0) return { ok: false, reason: "expired" };

  return { ok: true, userId: row.userId };
}
