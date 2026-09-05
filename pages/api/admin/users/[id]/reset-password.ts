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
 * POST /api/admin/users/[id]/reset-password — email one student a reset link.
 *
 * The Unit's fallback for a student who cannot receive email at the address on
 * file... except here the email is still the delivery channel; what this adds
 * over the public route is the ADMIN trigger: an admin who has verified the
 * student's identity in person can start the flow, and the admin's own bell
 * gets the record of it.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!requireDb(res)) return;
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;

  const rawId = req.query.id;
  const id = ((Array.isArray(rawId) ? rawId[0] : rawId) ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing user id." });

  await guarded(res, async () => {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    // Same reasoning as the deactivation guard in pages/api/admin/users/[id].ts:
    // an admin triggering resets for other admins is an escalation path we
    // don't open. A reset link for an admin account is effectively a password
    // change on that account controlled by whoever holds the email inbox —
    // route admin recovery through the Unit's own process instead.
    if (target.role === "ADMIN") {
      res.status(400).json({
        error:
          "Administrator accounts cannot be reset this way. Administrator " +
          "passwords are reset through the Unit's own process.",
      });
      return;
    }

    // Mints a token and (usually) sends an email per call, so a runaway
    // script must not hammer it — same ceiling the notification composer has.
    const verdict = checkRateLimit(caller.id);
    if (!verdict.ok) {
      res.status(429).json({
        error: `Sending too quickly. Try again in ${verdict.retryInSeconds}s.`,
      });
      return;
    }

    const token = await createResetToken(target.id);
    const resetUrl = `${appBaseUrl()}/auth/reset-password?token=${token}`;

    // Awaited, unlike the public route's detached send: the admin needs the
    // delivery result in the response, and a serverless function can afford
    // one email's latency (the push fan-out it can't is a per-device loop).
    const sent = await sendEmail({
      ...resetRequestEmail(target.name, resetUrl, TOKEN_TTL_MINUTES),
      to: target.email,
    });

    // In-app record for the admin's existing bell: the token was minted
    // regardless of email delivery, so the admin can tell the two outcomes
    // apart. Delivery failure is surfaced in the body text (and emailSent in
    // the response) rather than failing the request — the side effect stands.
    await prisma.notification.create({
      data: {
        userId: caller.id,
        title: "Password reset sent",
        body:
          `A password reset link was emailed to ${target.name} (${target.email}).` +
          (sent.ok ? "" : " (The email could not be delivered — check the email configuration.)"),
      },
    });

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({ ok: true, emailSent: sent.ok });
  });
}
