import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * POST /api/notifications/read — mark every one of the caller's unread
 * notifications as read ("mark all read" on the bell dropdown).
 *
 * The where clause is scoped by the session's userId, so the update can only
 * ever touch the caller's own rows — a crafted body has no userId field to
 * spoof here. Idempotent by construction: re-POSTing once everything is read
 * matches zero rows, which is still a success.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }
  const user = await requireRole(req, res);
  if (!user) return;
  if (!requireDb(res)) return;

  await guarded(res, async () => {
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(200).json({ ok: true });
  });
}
