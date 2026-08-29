import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * DELETE /api/complaints/[id]/messages/[messageId] — soft-delete one message
 * from a complaint's thread.
 *
 * The socket server (server/socket.mjs) handles the live path — soft delete
 * plus a `complaint:delete` broadcast to the room. THIS route is the REST
 * fallback: same persistence, no broadcast. A client whose socket is cold
 * still gets the delete honoured; the next GET of the thread just stops
 * including the row.
 *
 * Authorization mirrors pages/api/complaints/[id]/messages.ts exactly: the
 * complaint is fetched with `userId` in the WHERE for a student (absent for
 * an admin), and a student may only retract their OWN message in that
 * thread. Note the two dynamic segments — req.query.id is the COMPLAINT,
 * req.query.messageId the message.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Any signed-in user; the student/admin split is resolved below, per thread.
  const caller = await requireRole(req, res);
  if (!caller) return;
  if (!requireDb(res)) return;

  const complaintId = String(req.query.id ?? "").trim();
  const messageId = String(req.query.messageId ?? "").trim();
  if (!complaintId) {
    res.status(400).json({ error: "Missing complaint id." });
    return;
  }
  if (!messageId) {
    res.status(400).json({ error: "Missing message id." });
    return;
  }

  await guarded(res, async () => {
    // Ownership resolved in the query, the same `where` pattern as the GET/POST
    // route: for a student the clause is `userId = caller`; for an admin it is
    // absent. Fetching first and comparing after would be the same answer with
    // a race window.
    const complaintWhere =
      caller.role === "ADMIN"
        ? { id: complaintId }
        : { id: complaintId, userId: caller.id };

    const complaint = await prisma.complaint.findFirst({
      where: complaintWhere,
      select: { id: true },
    });
    if (!complaint) {
      // Same answer for "does not exist" and "not yours": the distinction is
      // exactly what an ID-probing student must not learn.
      res.status(404).json({ error: "Complaint not found." });
      return;
    }

    // The message must belong to THIS thread, and a student must be its
    // sender. Admins may retract anything in the thread (moderation).
    const messageWhere =
      caller.role === "ADMIN"
        ? { id: messageId, complaintId }
        : { id: messageId, complaintId, senderId: caller.id };

    const message = await prisma.complaintMessage.findFirst({
      where: messageWhere,
      select: { id: true },
    });
    if (!message) {
      // Covers "no such message", "another thread's message", and "not the
      // sender" identically — no oracle for which.
      res.status(404).json({ error: "Message not available." });
      return;
    }

    if (req.method === "DELETE") {
      // Soft delete, with the same ownership clause riding on the write: if
      // the row was deleted or re-homed between the reads above and this
      // update, count comes back 0 and the caller gets the same 404 — never a
      // wrong delete.
      const studentClause =
        caller.role === "ADMIN" ? {} : { senderId: caller.id };

      const result = await prisma.complaintMessage.updateMany({
        where: { id: messageId, complaintId, deletedAt: null, ...studentClause },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        // Already deleted (or raced out from under us) — indistinguishable
        // from never having existed, which is the point of soft delete.
        res.status(404).json({ error: "Message not available." });
        return;
      }

      res.status(200).json({ id: messageId });
      return;
    }

    methodNotAllowed(res, ["DELETE"]);
  });
}
