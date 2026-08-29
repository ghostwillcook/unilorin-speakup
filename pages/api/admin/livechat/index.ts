import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * GET /api/admin/livechat — the Live Chat inbox: every conversation with its
 * last message, unread count and status, newest activity first.
 *
 * The admin sees the student's real name and matric number here (they are the
 * Unit; the anonymity promise is toward *other students*), alongside the
 * pseudonym the conversation is known by. A `?id=` filter narrows to one row
 * for cheap refreshes of the open thread.
 */

interface InboxConversation {
  id: string;
  pseudonym: string;
  status: "OPEN" | "WAITING" | "CLOSED";
  adminUnread: number;
  userUnread: number;
  student: { id: string; name: string; studentId: string };
  lastMessage: { content: string; senderRole: string; createdAt: string } | null;
  updatedAt: string;
}

const CONVERSATION_FIELDS = {
  id: true,
  pseudonym: true,
  status: true,
  adminUnread: true,
  userUnread: true,
  updatedAt: true,
  user: { select: { id: true, name: true, studentId: true } },
  messages: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { content: true, senderRole: true, createdAt: true },
  },
} as const;

type ConversationRow = {
  id: string;
  pseudonym: string;
  status: "OPEN" | "WAITING" | "CLOSED";
  adminUnread: number;
  userUnread: number;
  updatedAt: Date;
  user: { id: string; name: string; studentId: string };
  messages: Array<{ content: string; senderRole: string; createdAt: Date }>;
};

function toInbox(row: ConversationRow): InboxConversation {
  const last = row.messages[0] ?? null;
  return {
    id: row.id,
    pseudonym: row.pseudonym,
    status: row.status,
    adminUnread: row.adminUnread,
    userUnread: row.userUnread,
    student: row.user,
    lastMessage: last
      ? {
          content: last.content,
          senderRole: last.senderRole,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;
  if (!requireDb(res)) return;

  await guarded(res, async () => {
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return;
    }

    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    const rows = await prisma.liveConversation.findMany({
      where: id ? { id } : undefined,
      orderBy: { updatedAt: "desc" },
      select: CONVERSATION_FIELDS,
    });

    res.status(200).json({ conversations: rows.map(toInbox) });
  });
}
