import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * GET /api/notifications — the signed-in user's own notifications, newest
 * first, plus their unread count for the bell badge.
 *
 * The student read side of the admin→student notification channel. Every
 * query is scoped by the session's userId — never by anything in the request
 * — so one student cannot read another's notifications. The mark-read action
 * lives at /api/notifications/read (a separate file), keeping this handler a
 * single-method endpoint.
 */

/** The dropdown only ever shows the newest screenful; the count below covers
 *  the rest, so there is no reason to ship a student's full history. */
const MAX_NOTIFICATIONS = 50;

interface StudentNotification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }
  const user = await requireRole(req, res);
  if (!user) return;
  if (!requireDb(res)) return;

  await guarded(res, async () => {
    // Personal data: never store it in a shared or browser cache.
    res.setHeader("Cache-Control", "no-store, max-age=0");

    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: MAX_NOTIFICATIONS,
        select: {
          id: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);

    const notifications: StudentNotification[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      // JSON bodies must be serializable; Date objects are not.
      createdAt: row.createdAt.toISOString(),
    }));

    res.status(200).json({ notifications, unread });
  });
}
