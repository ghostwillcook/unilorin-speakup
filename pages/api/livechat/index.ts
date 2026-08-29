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
 * GET  /api/livechat — the caller's own Live Chat conversation (created on
 *                      first touch) with its messages.
 * POST /api/livechat — append to that conversation.
 *
 * This is the REST spine of Live Chat. The socket server carries the realtime
 * echo, but THIS route is the source of truth: a message sent while the socket
 * is cold (Render free tier starts in ~25s) is written here exactly as it
 * would be live, and a page refresh rehydrates from here. The old global
 * anonymous room never had this path — that is why its messages seemed to
 * vanish whenever the socket was unreachable.
 *
 * GET also marks the Unit's messages read (the student is looking at the
 * thread) and zeroes userUnread, mirroring what /api/dm/[studentId] does for
 * DMs.
 */

const MAX_CONTENT = 4000;

interface LiveChatMessage {
  id: string;
  conversationId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
}

interface LiveChatConversation {
  id: string;
  pseudonym: string;
  status: "OPEN" | "WAITING" | "CLOSED";
  createdAt: string;
  messages: LiveChatMessage[];
}

const MESSAGE_FIELDS = {
  id: true,
  conversationId: true,
  senderRole: true,
  content: true,
  createdAt: true,
} as const;

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

function readContent(body: Record<string, unknown>): string | null {
  if (typeof body.content !== "string") return null;
  const trimmed = body.content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The stable "Anonymous #N" handle for this student's conversation. Chosen
 * once, at creation, so the inbox and logs always agree on who is who.
 *
 * Uniqueness is checked against the DB rather than left to luck: the handle
 * is what admins resolve lookups by, so two students sharing one would make
 * "Message a User" deliver to the wrong person. Ten attempts over 990 slots
 * keeps the collision odds near zero at any realistic scale; past that, a
 * duplicate beats a hang (mirrors pickLivePseudonym in server/socket.mjs —
 * keep the two behaviourally identical).
 */
async function pickPseudonym(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `Anonymous #${10 + Math.floor(Math.random() * 990)}`;
    const taken = await prisma.liveConversation.findFirst({
      where: { pseudonym: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `Anonymous #${10 + Math.floor(Math.random() * 990)}`;
}

/**
 * Finds or creates the caller's conversation. Every read and write goes
 * through this, so a student cannot address anyone else's conversation —
 * there is no id parameter on this route at all.
 */
async function ensureConversation(userId: string) {
  return prisma.liveConversation.upsert({
    where: { userId },
    update: {},
    create: { userId, pseudonym: await pickPseudonym() },
    select: { id: true, pseudonym: true, status: true, createdAt: true },
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const caller = await requireRole(req, res, "STUDENT");
  if (!caller) return;
  if (!requireDb(res)) return;

  await guarded(res, async () => {
    const conversation = await ensureConversation(caller.id);

    if (req.method === "GET") {
      // The student is reading the thread: everything the Unit sent is now
      // seen, by definition. One write on load beats a write per message.
      await prisma.liveMessage.updateMany({
        where: {
          conversationId: conversation.id,
          senderRole: "ADMIN",
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      if (conversation.status !== "CLOSED") {
        await prisma.liveConversation.update({
          where: { id: conversation.id },
          data: { userUnread: 0 },
        });
      }

      const rows = await prisma.liveMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: MESSAGE_FIELDS,
      });

      const body: LiveChatConversation = {
        id: conversation.id,
        pseudonym: conversation.pseudonym,
        status: conversation.status,
        createdAt: conversation.createdAt.toISOString(),
        messages: rows.map(toMessage),
      };
      res.status(200).json(body);
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

      // Same allowance as the socket twin of this write path.
      const verdict = checkRateLimit(caller.id);
      if (!verdict.ok) {
        res.status(429).json({
          error: `You are sending messages too quickly. Try again in ${verdict.retryInSeconds}s.`,
        });
        return;
      }

      if (conversation.status === "CLOSED") {
        // A closed conversation is re-opened by the student writing again —
        // the natural gesture, rather than a separate "reopen" button nobody
        // would find.
        await prisma.liveConversation.update({
          where: { id: conversation.id },
          data: { status: "OPEN" },
        });
      }

      const row = await prisma.liveMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: caller.id,
          senderRole: "STUDENT",
          content,
        },
        select: MESSAGE_FIELDS,
      });

      await prisma.liveConversation.update({
        where: { id: conversation.id },
        data: { adminUnread: { increment: 1 }, updatedAt: new Date() },
      });

      res.status(201).json({ message: toMessage(row) });
      return;
    }

    methodNotAllowed(res, ["GET", "POST"]);
  });
}
