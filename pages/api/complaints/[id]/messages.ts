import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET  /api/complaints/[id]/messages — the complaint's dedicated thread.
 * POST /api/complaints/[id]/messages — append to that thread.
 *
 * Authorization is the whole point of this route's shape: a student is served
 * their own complaint's thread and nothing else, because the complaint row is
 * fetched with `userId` in the WHERE, not fetched then compared. An admin may
 * read and write in any thread, which is the two-way conversation the spec
 * asks for: complaint → user ↔ administration.
 *
 * The complaint's own title/description/status are NOT part of this payload —
 * the clients already have the complaint; this endpoint is the conversation.
 */

/** Mirrors the DM routes' limit: a thread reply is never an essay. */
const MAX_CONTENT = 4000;

interface ThreadMessage {
  id: string;
  complaintId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

const MESSAGE_FIELDS = {
  id: true,
  complaintId: true,
  senderRole: true,
  content: true,
  createdAt: true,
} as const;

function toMessage(row: {
  id: string;
  complaintId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: Date;
}): ThreadMessage {
  return {
    id: row.id,
    complaintId: row.complaintId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

function readContent(body: Record<string, unknown>): string | null {
  if (typeof body.content !== "string") return null;
  const trimmed = body.content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const caller = await requireRole(req, res);
  if (!caller) return;
  if (!requireDb(res)) return;
  const complaintId = String(req.query.id ?? "").trim();
  if (!complaintId) {
    res.status(400).json({ error: "Missing complaint id." });
    return;
  }

  await guarded(res, async () => {
    // Ownership resolved server-side, in the query. For a student the clause
    // is `userId = caller`; for an admin it is absent. Fetching first and
    // comparing after would be the same answer with a race window.
    const where =
      caller.role === "ADMIN"
        ? { id: complaintId }
        : { id: complaintId, userId: caller.id };

    const complaint = await prisma.complaint.findFirst({
      where,
      select: { id: true, userId: true },
    });
    if (!complaint) {
      // Same answer for "does not exist" and "not yours": the distinction is
      // exactly what an ID-probing student must not learn.
      res.status(404).json({ error: "Complaint not found." });
      return;
    }

    if (req.method === "GET") {
      // Read-on-open for the student side: looking at the thread is seeing the
      // Unit's replies, so the My Complaints unread dot clears. Admins have no
      // unread tracking on complaints (the console treats the list itself as
      // the triage surface), so only the student path writes.
      if (caller.role === "STUDENT") {
        await prisma.complaintMessage.updateMany({
          where: { complaintId, senderRole: "ADMIN", readAt: null },
          data: { readAt: new Date() },
        });
      }

      const rows = await prisma.complaintMessage.findMany({
        // deletedAt: null — soft-deleted messages stay in the table (audit
        // trail) but must not render in the thread.
        where: { complaintId, deletedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: MESSAGE_FIELDS,
      });
      // Personal data: never store it in a shared or browser cache.
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(200).json({ messages: rows.map(toMessage) });
      return;
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const content = readContent(body);
      if (content === null) {
        res.status(400).json({ error: "Message cannot be empty." });
        return;
      }
      if (content.length > MAX_CONTENT) {
        res
          .status(400)
          .json({ error: `Message must be ${MAX_CONTENT} characters or fewer.` });
        return;
      }

      // Same allowance as the socket path (see lib/rate-limit.ts): validation
      // first so a rejected message never costs part of the window.
      const verdict = checkRateLimit(caller.id);
      if (!verdict.ok) {
        res.status(429).json({
          error: `You are sending messages too quickly. Try again in ${verdict.retryInSeconds}s.`,
        });
        return;
      }

      const row = await prisma.complaintMessage.create({
        data: {
          complaintId,
          senderId: caller.id,
          senderRole: caller.role,
          content,
        },
        select: MESSAGE_FIELDS,
      });

      // A thread message moves the complaint's updatedAt, so "recently active"
      // ordering in both consoles reflects the conversation, not just status
      // changes.
      await prisma.complaint.update({
        where: { id: complaintId },
        data: { updatedAt: new Date() },
      });

      res.status(201).json({ message: toMessage(row) });
      return;
    }

    methodNotAllowed(res, ["GET", "POST"]);
  });
}
