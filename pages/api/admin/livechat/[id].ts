import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * GET   /api/admin/livechat/[id] — one conversation's full message history.
 * POST  /api/admin/livechat/[id] — the Unit's reply, persisted first and
 *                                  broadcast by the socket server if it is up.
 * PATCH /api/admin/livechat/[id] — change conversation status (OPEN / WAITING /
 *                                  CLOSED).
 *
 * GET marks the conversation's adminUnread read (the admin is looking at it),
 * the same read-on-open the DM routes give the student side.
 */

const MAX_CONTENT = 4000;

interface LiveChatMessage {
  id: string;
  conversationId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

const MESSAGE_FIELDS = {
  id: true,
  conversationId: true,
  senderRole: true,
  content: true,
  createdAt: true,
} as const;

const STATUS_VALUES = ["OPEN", "WAITING", "CLOSED"] as const;
type LiveStatusValue = (typeof STATUS_VALUES)[number];

function toMessage(row: {
  id: string;
  conversationId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: Date;
}): LiveChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;
  if (!requireDb(res)) return;

  const conversationId = String(req.query.id ?? "").trim();
  if (!conversationId) {
    res.status(400).json({ error: "Missing conversation id." });
    return;
  }

  await guarded(res, async () => {
    const conversation = await prisma.liveConversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    if (req.method === "GET") {
      const rows = await prisma.liveMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: MESSAGE_FIELDS,
      });

      // Read-on-open: the admin has seen these, so the inbox badge clears.
      await prisma.liveMessage.updateMany({
        where: { conversationId, senderRole: "STUDENT", readAt: null },
        data: { readAt: new Date() },
      });
      await prisma.liveConversation.update({
        where: { id: conversationId },
        data: { adminUnread: 0 },
      });

      res.status(200).json({ messages: rows.map(toMessage) });
      return;
    }

    if (req.method === "POST") {
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      if (typeof body.content !== "string" || body.content.trim().length === 0) {
        res.status(400).json({ error: "Message cannot be empty." });
        return;
      }
      const content = body.content.trim();
      if (content.length > MAX_CONTENT) {
        res
          .status(400)
          .json({ error: `Message must be ${MAX_CONTENT} characters or fewer.` });
        return;
      }

      const row = await prisma.liveMessage.create({
        data: {
          conversationId,
          senderId: caller.id,
          senderRole: "ADMIN",
          content,
        },
        select: MESSAGE_FIELDS,
      });

      await prisma.liveConversation.update({
        where: { id: conversationId },
        data: { userUnread: { increment: 1 }, updatedAt: new Date() },
      });

      res.status(201).json({ message: toMessage(row) });
      return;
    }

    if (req.method === "PATCH") {
      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const status = body.status;
      if (
        typeof status !== "string" ||
        !STATUS_VALUES.includes(status as LiveStatusValue)
      ) {
        res.status(400).json({
          error: `status must be one of ${STATUS_VALUES.join(", ")}.`,
        });
        return;
      }

      const row = await prisma.liveConversation.update({
        where: { id: conversationId },
        data: { status: status as LiveStatusValue },
        select: { id: true, status: true },
      });
      res.status(200).json({ conversation: row });
      return;
    }

    methodNotAllowed(res, ["GET", "POST", "PATCH"]);
  });
}
