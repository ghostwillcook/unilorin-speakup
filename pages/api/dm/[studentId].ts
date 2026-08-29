import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { Role, SessionUser } from "@/lib/guards";
import { checkRateLimit } from "@/lib/rate-limit";
// Type-only import: erased at compile time, so pulling the wire shape from the
// client module costs the API bundle nothing and keeps one definition of DmMessage.
import type { DmMessage } from "@/lib/socket-client";

/**
 * GET  /api/dm/[studentId]   read a thread (and mark the other side read)
 * POST /api/dm/[studentId]   send into a thread
 *
 * `[studentId]` is a **User.id**, not a matriculation number — see the naming
 * note in ./index.ts.
 *
 * This is also the REST fallback for direct messages. The socket server owns the
 * live path, but it is a separate process that may simply not be running; a
 * student in distress should not be told to come back later, so the same two
 * operations exist over plain HTTP. Persisted rows are identical either way,
 * which is what lets a client poll this route and lose nothing.
 *
 * Authorization is the whole point of this file. A student's DM thread is the
 * most sensitive surface in the app, so ownership is checked against the session
 * *before* any query runs: a hostile request never reaches the database at all.
 */

const MAX_CONTENT = 4000;

const DM_FIELDS = {
  id: true,
  studentId: true,
  senderRole: true,
  content: true,
  createdAt: true,
} as const;

/** What DM_FIELDS returns — createdAt is still a Date. */
interface DmRow {
  id: string;
  studentId: string;
  senderRole: Role;
  content: string;
  createdAt: Date;
}

/**
 * Pass `studentName` only for admin callers. Student clients already know whose
 * thread they are in, and the contract marks the field admin-only, so it is
 * omitted rather than sent and ignored.
 */
function toDmMessage(row: DmRow, studentName: string | null): DmMessage {
  const message: DmMessage = {
    id: row.id,
    studentId: row.studentId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
  if (studentName !== null) message.studentName = studentName;
  return message;
}

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Next parses `application/json` for us, but a client that posts a raw string
 * body should get a 400 rather than being read as an empty message.
 */
function readJsonBody(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

/* ------------------------------------------------------------------- routes */

async function readThread(
  res: NextApiResponse,
  user: SessionUser,
  studentId: string,
  studentName: string,
): Promise<void> {
  const rows: DmRow[] = await prisma.directMessage.findMany({
    where: { studentId },
    // Oldest first: a conversation is read top to bottom.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: DM_FIELDS,
  });

  const isAdmin = user.role === "ADMIN";

  // Opening a thread is the read receipt, and it only ever clears the *other*
  // side's messages: an admin reading marks the student's, a student reading
  // marks the Unit's. Marking your own would zero the recipient's badge.
  const otherSide: Role = isAdmin ? "STUDENT" : "ADMIN";
  await prisma.directMessage.updateMany({
    where: { studentId, senderRole: otherSide, readAt: null },
    data: { readAt: new Date() },
  });

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json({
    messages: rows.map((row) => toDmMessage(row, isAdmin ? studentName : null)),
  });
}

async function sendMessage(
  req: NextApiRequest,
  res: NextApiResponse,
  user: SessionUser,
  studentId: string,
  studentName: string,
): Promise<void> {
  const body = readJsonBody(req.body as unknown);
  if (!body) {
    res.status(400).json({ error: "Body must be a JSON object." });
    return;
  }

  const raw = body.content;
  if (typeof raw !== "string") {
    res.status(400).json({ error: "`content` must be a string." });
    return;
  }

  const content = raw.trim();
  if (content.length === 0) {
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }
  if (content.length > MAX_CONTENT) {
    res.status(400).json({
      error: `Message must be ${MAX_CONTENT} characters or fewer.`,
    });
    return;
  }

  // Same allowance as the socket twin of this write path.
  const verdict = checkRateLimit(user.id);
  if (!verdict.ok) {
    res.status(429).json({
      error: `You are sending messages too quickly. Try again in ${verdict.retryInSeconds}s.`,
    });
    return;
  }

  const row: DmRow = await prisma.directMessage.create({
    // Author and role come from the verified session; the thread comes from the
    // URL, which authorize() has already confirmed this caller may write to.
    // Nothing about identity is read from the body.
    data: {
      studentId,
      senderId: user.id,
      senderRole: user.role,
      content,
    },
    select: DM_FIELDS,
  });

  res.status(201).json({
    message: toDmMessage(row, user.role === "ADMIN" ? studentName : null),
  });
}

/* ------------------------------------------------------------------ handler */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }
  if (!requireDb(res)) return;

  // Any signed-in role may reach this route; which *thread* they may touch is
  // decided immediately below.
  const user = await requireRole(req, res);
  if (!user) return;

  const studentId = firstParam(req.query.studentId);
  if (!studentId) {
    return res.status(400).json({ error: "Missing student id." });
  }

  // The ownership gate. Admins moderate every thread; a student is confined to
  // the one keyed by their own User.id. Checked before any query so an attempt
  // to read someone else's messages cannot even probe for existence — a
  // stranger's id and a nonexistent id both answer 403.
  if (user.role !== "ADMIN" && studentId !== user.id) {
    return res
      .status(403)
      .json({ error: "You can only view your own conversation." });
  }

  await guarded(res, async () => {
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, role: true },
    });

    // Also covers "admin opened a thread keyed to another admin", which the
    // schema permits but the product does not.
    if (!student || student.role !== "STUDENT") {
      res.status(404).json({ error: "Student not found." });
      return;
    }

    if (req.method === "GET") {
      await readThread(res, user, studentId, student.name);
      return;
    }
    await sendMessage(req, res, user, studentId, student.name);
  });
}
