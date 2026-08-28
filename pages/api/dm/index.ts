import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { Role } from "@/lib/guards";

/**
 * GET /api/dm — the Students Affairs Unit's inbox.
 *
 * A DM "thread" is not a row anywhere: the schema keys messages by the student
 * who owns the conversation, because a student always writes to the Unit
 * collectively and any admin may answer. So the inbox is derived — read the
 * messages newest first and fold them down to one entry per student.
 *
 * Folding in JS rather than in SQL is deliberate. Postgres can group these, but
 * "newest message per group" plus "unread count per group" is two aggregates
 * over the same rows, which through Prisma means either two round trips or raw
 * SQL. One ordered scan gives both, and the volume here is one unit's mailbox.
 *
 * Naming trap, called out because two different values are both spelled
 * "student id" in this codebase:
 *   - `studentId`     → User.id, the primary key (what the URL /api/dm/[id] takes)
 *   - `studentNumber` → User.studentId, the human matriculation number
 * The API contract fixes those names; do not swap them.
 */

export interface DmThread {
  /** User.id of the thread owner. */
  studentId: string;
  studentName: string;
  studentEmail: string;
  /** Matriculation number, i.e. User.studentId. */
  studentNumber: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

/** What the query below returns — createdAt/readAt are still Date objects. */
interface ThreadScanRow {
  studentId: string;
  senderRole: Role;
  content: string;
  readAt: Date | null;
  createdAt: Date;
  student: {
    id: string;
    name: string;
    email: string;
    studentId: string;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!requireDb(res)) return;

  // The whole inbox is admin-only; there is no student view of this route.
  if (!(await requireRole(req, res, "ADMIN"))) return;

  await guarded(res, async () => {
    const rows: ThreadScanRow[] = await prisma.directMessage.findMany({
      // `id` breaks ties so two messages sharing a timestamp still order
      // deterministically — otherwise the inbox could reshuffle between loads.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        studentId: true,
        senderRole: true,
        content: true,
        readAt: true,
        createdAt: true,
        student: {
          select: { id: true, name: true, email: true, studentId: true },
        },
      },
    });

    // Rows arrive newest first, so the first row seen for a student is that
    // thread's latest message — and push order is already newest-thread-first.
    const threads: DmThread[] = [];
    const byStudent = new Map<string, DmThread>();

    for (const row of rows) {
      let thread = byStudent.get(row.studentId);

      if (!thread) {
        thread = {
          studentId: row.studentId,
          studentName: row.student.name,
          studentEmail: row.student.email,
          studentNumber: row.student.studentId,
          lastMessage: row.content,
          lastAt: row.createdAt.toISOString(),
          unread: 0,
        };
        byStudent.set(row.studentId, thread);
        threads.push(thread);
      }

      // Unread, from the Unit's point of view: what students sent that no admin
      // has opened yet. Admin replies are never counted here.
      if (row.senderRole === "STUDENT" && row.readAt === null) {
        thread.unread += 1;
      }
    }

    // Private correspondence: never let a proxy or the browser keep a copy.
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({ threads });
  });
}
