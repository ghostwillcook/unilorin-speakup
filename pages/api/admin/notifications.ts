import type { NextApiRequest, NextApiResponse } from "next";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * POST /api/admin/notifications — send an in-app + Web Push notification to
 * one student (`userId` in the body) or every active student (absent).
 * GET  /api/admin/notifications — recent sends, newest first, for the
 * composer page's history list.
 *
 * This is the REST twin of the socket server's `notification:send`
 * (server/socket.mjs): same recipients rule, same persistence, same
 * best-effort push. It exists as the fallback for an admin session whose
 * socket is down (Netlify Functions are serverless; the socket lives on
 * Render), and it deliberately emits NO realtime event — the socket path
 * owns that, so a send that went through both channels would double-notify
 * online students. Persistence is the source of truth either way: offline
 * students pick the row up from /api/notifications.
 */

/**
 * No length caps on title or body: the admin is the trusted author and the
 * Postgres TEXT column is unlimited. The only validation is non-empty —
 * a broadcast with a blank field is a mistake, not a policy decision. (An
 * earlier version capped these at 120/3500 chars; the admin asked for the
 * ceiling removed entirely, so it is gone from here, the socket twin, and
 * the composer UI.)
 */
/** History list size — the composer page only ever shows the last screenful. */
const HISTORY_LIMIT = 50;

/* ------------------------------------------------------------------ shapes */

interface AdminNotification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  /** Who received it — the admin knows recipients by name, the channel is
   *  admin→student, so there is no anonymity concern on this endpoint. */
  recipient: { id: string; name: string; studentId: string };
}

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  user: { id: string; name: string; studentId: string };
}

function toAdminNotification(row: NotificationRow): AdminNotification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    // JSON bodies must be serializable; Date objects are not.
    createdAt: row.createdAt.toISOString(),
    recipient: row.user,
  };
}

/* -------------------------------------------------------------- validation */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------- push */

/**
 * Web Push delivery, ported from the socket server's pushToUser. Best-effort
 * by design: a failing subscription (404/410 is the standard "uninstalled"
 * signal) is pruned rather than retried, and an error on one device never
 * blocks the loop or fails the send. A no-op when VAPID keys are absent — the
 * Notification rows persist regardless, so the channel degrades to in-app
 * only instead of erroring.
 *
 * Takes all recipient ids at once so a broadcast is one subscriptions query,
 * not one per student.
 *
 * The push body is truncated to PUSH_BODY_MAX characters: the Web Push
 * protocol has a ~4KB total payload ceiling (HTTP 413 above it), and since
 * the notification length caps were removed, the admin can write a message
 * that no push service will accept. The full text is always in the database
 * and the in-app overlay — only the lock-screen preview is clipped.
 */
const PUSH_TITLE_MAX = 100;
const PUSH_BODY_MAX = 3000;

async function pushToRecipients(
  userIds: string[],
  title: string,
  body: string,
): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:studentaffairs@unilorin.edu.ng",
    publicKey,
    privateKey,
  );

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: title.slice(0, PUSH_TITLE_MAX),
          body: body.slice(0, PUSH_BODY_MAX),
        }),
      );
    } catch (err) {
      // 404/410 = the subscription is dead (uninstalled, expired). Prune;
      // 413 = payload too large for this push service (already truncated —
      // some services have tighter limits); skip rather than prune, because
      // the subscription itself is healthy. Anything else is transient and
      // the next send retries it.
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => {});
      }
    }
  }
}

/* ------------------------------------------------------------------ routes */

async function send(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const body = asRecord(req.body as unknown);
  const title = readString(body.title);
  const message = readString(body.body);
  const userId = readString(body.userId);

  if (title.length === 0) {
    res.status(400).json({ error: "A title is required." });
    return;
  }
  if (message.length === 0) {
    res.status(400).json({ error: "A message is required." });
    return;
  }

  // Recipients: one named student, or every active student. The userId filter
  // is intersected with role+isActive so a complaint against an admin's id or
  // a deactivated account simply finds no recipients — the caller cannot widen
  // the audience beyond students.
  const recipients = await prisma.user.findMany({
    where: userId
      ? { id: userId, role: "STUDENT", isActive: true }
      : { role: "STUDENT", isActive: true },
    select: { id: true },
  });
  if (recipients.length === 0) {
    res.status(404).json({ error: "No active student recipients were found." });
    return;
  }

  // One row per recipient: read state and delivery are per-user by design.
  await prisma.notification.createMany({
    data: recipients.map((r) => ({ userId: r.id, title, body: message })),
  });

  // Push after persistence — the rows are the source of truth, so a push
  // outage must never make the send itself fail. Fire-and-forget (detached
  // with setImmediate so the response is sent BEFORE the push loop runs):
  // a serial push to every subscription of every recipient can easily
  // outlast a serverless function's timeout, which would yield a 504 "not
  // sent" after the rows were already committed — and an admin retrying
  // after that error would duplicate the send. The push may still be cut
  // short by a function timeout for very large broadcasts, but the in-app
  // notification is already delivered; the push is the enhancement.
  const recipientIds = recipients.map((r) => r.id);
  setImmediate(() => {
    void pushToRecipients(recipientIds, title, message).catch(() => {});
  });

  res.status(201).json({ count: recipients.length });
}

async function listRecent(res: NextApiResponse): Promise<void> {
  const rows: NotificationRow[] = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, studentId: true } },
    },
  });
  res.status(200).json({
    notifications: rows.map(toAdminNotification),
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;
  if (!requireDb(res)) return;

  if (req.method === "POST") {
    // Broadcast fan-out is expensive (a row + a push attempt per student), so
    // an admin's runaway script must not hammer it — same ceiling the socket
    // path enforces on its own sends.
    const verdict = checkRateLimit(caller.id);
    if (!verdict.ok) {
      res.status(429).json({
        error: `Sending too quickly. Try again in ${verdict.retryInSeconds}s.`,
      });
      return;
    }
  }

  await guarded(res, async () => {
    // Recipient names are personal data: never cacheable.
    res.setHeader("Cache-Control", "no-store, max-age=0");
    if (req.method === "GET") {
      await listRecent(res);
    } else {
      await send(req, res);
    }
  });
}
