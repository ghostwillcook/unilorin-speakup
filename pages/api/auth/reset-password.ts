import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { guarded, methodNotAllowed, requireDb } from "@/lib/guards";
import { sendEmail } from "@/lib/email";
import { passwordChangedEmail } from "@/lib/email-templates";
import { consumeResetToken } from "@/lib/password-reset";

/**
 * POST /api/auth/reset-password — the landing end of the reset link.
 *
 * Public on purpose: the caller arrives from an email, not from a session
 * (they reset because they cannot sign in). The token in the URL is the only
 * credential, and consumeResetToken validates AND burns it in one step, so
 * this handler's job is to check it exactly once and then commit the change.
 */

const MIN_PASSWORD = 8;
// Matches BCRYPT_ROUNDS in prisma/seed.ts, so reset passwords verify exactly
// like seeded ones.
const BCRYPT_ROUNDS = 10;

// createResetToken mints randomBytes(32).toString("hex") — exactly 64 hex
// characters, and nothing else is ever emailed as a token. The token is
// attacker-controlled input, so it is shape-checked BEFORE it is used as a
// rate-limit Map key or hashed: an unbounded arbitrary string as a Map key is
// a memory-exhaustion vector (every distinct junk token pins an entry for a
// minute), and hashing megabytes of garbage is free CPU burn. Non-hex or
// over-length input can never be a real token, so it gets the same "not
// valid" copy as a hash miss — no hint about how far it got.
const TOKEN_HEX_PATTERN = /^[0-9a-f]+$/i;
const TOKEN_MAX_LENGTH = 64;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!requireDb(res)) return;

  const body = readJsonBody(req.body);
  if (!body) {
    return res.status(400).json({ error: "Body must be a JSON object." });
  }

  const token = readString(body.token);
  if (!token) {
    return res.status(400).json({ error: "A reset token is required." });
  }
  // Shape gate before any rate-limiting or hashing — see TOKEN_HEX_PATTERN.
  if (token.length > TOKEN_MAX_LENGTH || !TOKEN_HEX_PATTERN.test(token)) {
    return res
      .status(400)
      .json({ error: "This reset link is not valid. Request a new one." });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters." });
  }

  // Keyed by the token string: the caller is anonymous, and brute-forcing
  // tokens shouldn't be free even though each attempt is "only" a database
  // lookup. Same in-process limitation lib/rate-limit.ts documents.
  const verdict = checkRateLimit(token);
  if (!verdict.ok) {
    res.status(429).json({
      error: `Too many attempts. Try again in ${verdict.retryInSeconds}s.`,
    });
    return;
  }

  await guarded(res, async () => {
    const result = await consumeResetToken(token);

    if (result.ok === false) {
      if (result.reason === "invalid") {
        res.status(400).json({
          error: "This reset link is not valid. Request a new one.",
        });
        return;
      }
      // 410 Gone, not 400: an expired or already-used link is dead, not
      // merely malformed — the resource it pointed at no longer exists.
      // (consumeResetToken collapses used into "expired" so the response
      // doesn't hint whether the token was ever valid.)
      res.status(410).json({
        error:
          "This reset link has expired or was already used. Request a new one.",
      });
      return;
    }

    // Fetched after the token is consumed so its name/email are current at
    // send time; a user deleted between email and click simply 404s here.
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      res.status(404).json({ error: "This account no longer exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // The consumed token was only marked used; delete the rest so no sibling
    // link survives the change (createResetToken normally guarantees one live
    // token, but this sweep also clears any stragglers from older flows).
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // The password change is committed; the confirmation email is advisory —
    // it exists so a stolen reset link doesn't go silently. AWAITED rather
    // than detached (see the matching comment in forgot-password.ts): the
    // serverless runtime freezes on response, so a setImmediate send is a
    // race it sometimes loses. sendEmail never throws; the .catch keeps an
    // advisory email from failing an already-committed password change.
    await sendEmail({
      ...passwordChangedEmail(user.name),
      to: user.email,
    }).catch(() => {});

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({ message: "Your password has been changed." });
  });
}

/**
 * readJsonBody/isRecord are duplicated from pages/api/admin/users/[id].ts
 * rather than extracted — they are local helpers there, and duplicating two
 * five-line functions follows that file's precedent of keeping route-local
 * validation next to the route that uses it.
 *
 * Next parses `application/json` for us, but a client that posts a raw string
 * body should get a 400 rather than being read as an empty request.
 */
function readJsonBody(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trimmed string or empty — empty then fails the required check above. */
function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
