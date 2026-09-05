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

/** SHA-256 hex digest — fast is correct here; this is not a password. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issues a new reset token for `userId` and returns the RAW token (the part
 * that goes into the email link, never the stored hash).
 *
 * Existing rows for the user are deleted first so each request invalidates
 * all prior links: there is at most one live token per user, which means a
 * user who requests twice is not protected by the first (possibly stolen)
 * email still working.
 */
export async function createResetToken(userId: string): Promise<string> {
  await prisma.passwordResetToken.deleteMany({ where: { userId } });

  const token = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
    },
  });

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

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Validates a raw token and burns it if usable. Marking `usedAt` inside the
 * same call makes the token single-use: a second attempt with the same link
 * finds a used row and fails.
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

  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt !== null || row.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }

  await prisma.passwordResetToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });

  return { ok: true, userId: row.userId };
}
