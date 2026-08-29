import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * DELETE /api/livechat/messages/[id] — soft-delete one Live Chat message.
 *
 * The socket server (server/socket.mjs) is the primary path for this gesture
 * when it is warm: it persists the soft delete AND broadcasts the
 * `livechat:delete` event to the room so every open client drops the bubble
 * immediately. THIS route is the fallback: same persistence, no broadcast —
 * a client that cannot reach the socket still gets its delete honoured, and
 * the next GET rehydration simply no longer returns the row.
 *
 * Authorization mirrors the read routes' shape: an admin may retract anything
 * (moderation), a student only their own message inside their own
 * conversation. There is no id parameter to guess on /api/livechat itself,
 * but this route has one, so the not-found answer must not reveal whether a
 * message exists — "not available" covers not-found, someone else's
 * conversation, and someone else's message identically.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Any signed-in user; the student/admin split is resolved below, per message.
  const caller = await requireRole(req, res);
  if (!caller) return;
  if (!requireDb(res)) return;

  const messageId = String(req.query.id ?? "").trim();
  if (!messageId) {
    res.status(400).json({ error: "Missing message id." });
    return;
  }

  await guarded(res, async () => {
    // Ownership resolved in the query, not fetched-then-compared: a student's
    // clause reaches through to the conversation's owner AND pins the sender,
    // so the lookup itself can only ever land on a row they may delete. An
    // admin gets the bare id. Fetch-first-compare-after would give the same
    // answer with a race window.
    const messageWhere =
      caller.role === "ADMIN"
        ? { id: messageId }
        : {
            id: messageId,
            senderId: caller.id,
            conversation: { userId: caller.id },
          };

    const message = await prisma.liveMessage.findFirst({
      where: messageWhere,
      select: { id: true },
    });
    if (!message) {
      // Same answer for "does not exist" and "not yours": which one it was is
      // exactly what an ID-probing student must not learn.
      res.status(404).json({ error: "Message not available." });
      return;
    }

    if (req.method === "DELETE") {
      // Soft delete, and the same ownership clause rides along on the write:
      // between the read above and this update nothing else should have moved
      // the row, but if it did (deleted already, ownership changed) the count
      // comes back 0 and the caller gets the same 404 — never a wrong delete.
      const studentClause =
        caller.role === "ADMIN"
          ? {}
          : { senderId: caller.id, conversation: { userId: caller.id } };

      const result = await prisma.liveMessage.updateMany({
        where: { id: messageId, deletedAt: null, ...studentClause },
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
