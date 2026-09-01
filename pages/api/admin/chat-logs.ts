import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * The admin chat log — the one place where a pseudonymous message is tied back
 * to the student who sent it.
 *
 * Anonymity in Student Connect is anonymity *between students*: `PublicChatMessage`
 * deliberately carries no userId to the chat clients, while `ChatMessage.userId`
 * is persisted so the Student Affairs Unit can still act on abuse. This route
 * is the only reader of that link, which is why it is ADMIN-gated and never
 * cached.
 */

const DEFAULT_TAKE = 200;
const MAX_TAKE = 500;

interface ChatLogEntry {
  id: string;
  pseudonym: string;
  content: string;
  timestamp: string;
  user: { id: string; name: string; email: string; studentId: string };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!requireDb(res)) return;
  if (!(await requireRole(req, res, "ADMIN"))) return;

  const q = firstParam(req.query.q);
  const userId = firstParam(req.query.userId);
  const from = parseBoundary(firstParam(req.query.from), "start");
  const to = parseBoundary(firstParam(req.query.to), "end");
  const take = parseTake(firstParam(req.query.take));

  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = from;
  if (to) range.lte = to;

  const where: Prisma.ChatMessageWhereInput = {
    ...(userId ? { userId } : {}),
    ...(q
      ? {
          OR: [
            { content: { contains: q, mode: "insensitive" as const } },
            { pseudonym: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(from || to ? { timestamp: range } : {}),
  };

  await guarded(res, async () => {
    const rows = await prisma.chatMessage.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take,
      select: {
        id: true,
        pseudonym: true,
        content: true,
        timestamp: true,
        user: {
          select: { id: true, name: true, email: true, studentId: true },
        },
      },
    });

    const messages: ChatLogEntry[] = rows.map((m) => ({
      id: m.id,
      pseudonym: m.pseudonym,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      user: {
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        studentId: m.user.studentId,
      },
    }));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ messages });
  });
}

/** Query values arrive as `string | string[]`; the filters are all single-valued. */
function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

/**
 * Accepts a full ISO timestamp or the bare `YYYY-MM-DD` an `<input type="date">`
 * submits. A bare day is widened to cover the whole day (UTC), so a from/to pair
 * of the same date returns that date's messages instead of nothing.
 */
function parseBoundary(raw: string, edge: "start" | "end"): Date | undefined {
  if (!raw) return undefined;

  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = dayOnly
    ? `${raw}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
    : raw;

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Clamped so a hand-edited URL cannot ask for the entire table. */
function parseTake(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_TAKE;
  return Math.max(1, Math.min(MAX_TAKE, n));
}
