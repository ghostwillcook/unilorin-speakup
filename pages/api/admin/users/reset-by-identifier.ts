import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { resetRequestEmail } from "@/lib/email-templates";
import { TOKEN_TTL_MINUTES, createResetToken } from "@/lib/password-reset";

/**
 * POST /api/admin/users/reset-by-identifier — the Settings-page variant of
 * /api/admin/users/[id]/reset-password.
 *
 * The Unit's real-world entry point is "the student is standing at the desk
 * (or on the phone) and reads out their email or matric number" — an admin
 * perk the public flow deliberately does not have: the public route accepts
 * only the account's own email, while an admin may identify the student by
 * either the email or the matric number on file.
 *
 * Everything after the lookup is byte-for-byte the same flow as the [id]
 * route (token, email, admin-bell record) — deliberately duplicated rather
 * than shared, because the [id] route's doc comment explains its own gates
 * and the two inputs justify two small files over one route with a mode
 * flag.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!requireDb(res)) return;
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;

  const body = readJsonBody(req.body);
  const rawIdentifier = body ? body.identifier : undefined;
  const identifier =
    typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";
  if (!identifier) {
    return res
      .status(400)
      .json({ error: "Enter the student's email or matric number." });
  }

  await guarded(res, async () => {
    // Emails and matric numbers cannot collide (matric contains a slash,
    // emails contain @), so one OR query resolves either spelling.
    // Case-insensitive on both: the roster stores mixed case, and a matric
    // number read out loud arrives in any casing.
    const target = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: "insensitive" } },
          { studentId: { equals: identifier, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, studentId: true, role: true },
    });

    if (!target) {
      res.status(404).json({
        error:
          "No account with that email or matric number. Check the spelling and try again.",
      });
      return;
    }

    // Same guard and reasoning as the [id] route: an admin triggering resets
    // for other admins is an escalation path we don't open.
    if (target.role === "ADMIN") {
      res.status(400).json({
        error:
          "Administrator accounts cannot be reset this way. Administrator " +
          "passwords are reset through the Unit's own process.",
      });
      return;
    }

    // Mints a token and (usually) sends an email per call, so a runaway
    // script must not hammer it — same ceiling as every other admin send.
    const verdict = checkRateLimit(caller.id);
    if (!verdict.ok) {
      res.status(429).json({
        error: `Sending too quickly. Try again in ${verdict.retryInSeconds}s.`,
      });
      return;
    }

    const token = await createResetToken(target.id);
    const resetUrl = `${appBaseUrl()}/auth/reset-password?token=${token}`;

    // Awaited, not detached: the admin needs the delivery result in the
    // response, and a serverless function can afford one email's latency.
    const sent = await sendEmail({
      ...resetRequestEmail(target.name, resetUrl, TOKEN_TTL_MINUTES),
      to: target.email,
    });

    // In-app record for the admin's existing bell, identical to the [id]
    // route — the Settings card and the roster button are one workflow with
    // two entry points, and the bell should not care which was used.
    await prisma.notification.create({
      data: {
        userId: caller.id,
        title: "Password reset sent",
        body:
          `A password reset link was emailed to ${target.name} (${target.email}).` +
          (sent.ok
            ? ""
            : " (The email could not be delivered — check the email configuration.)"),
      },
    });

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      ok: true,
      emailSent: sent.ok,
      recipient: { name: target.name, email: target.email },
    });
  });
}

/**
 * Same helper as the [id] routes: Next parses application/json for us, but a
 * client posting a raw string should get a 400 rather than an empty lookup.
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
