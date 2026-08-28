import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { ComplaintStatus } from "@/components/StatusBadge";

/**
 * Tiles and activity feed for /admin.
 *
 * The status tallies come from one grouped query instead of four counts, so the
 * dashboard costs three round trips no matter how many statuses the enum grows
 * to — and adding a status becomes a compile error here rather than a silently
 * missing tile.
 */

const RECENT_LIMIT = 8;

interface RecentComplaint {
  id: string;
  title: string;
  status: ComplaintStatus;
  createdAt: string;
  studentName: string;
}

export interface AdminStats {
  total: number;
  pending: number;
  inReview: number;
  resolved: number;
  rejected: number;
  students: number;
  recent: RecentComplaint[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!requireDb(res)) return;
  // Admin only. requireRole has already sent 401/403 when it returns null; the
  // caller's own identity is not needed past that check.
  if (!(await requireRole(req, res, "ADMIN"))) return;

  await guarded(res, async () => {
    const [grouped, students, recent] = await Promise.all([
      prisma.complaint.groupBy({ by: ["status"], _count: true }),
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.complaint.findMany({
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
    ]);

    // Statuses with no rows are absent from a groupBy result, so start at zero
    // and fill in what came back.
    const tally: Record<ComplaintStatus, number> = {
      PENDING: 0,
      IN_REVIEW: 0,
      RESOLVED: 0,
      REJECTED: 0,
    };
    for (const row of grouped) {
      // `_count: true` yields a single number per group.
      tally[row.status] = typeof row._count === "number" ? row._count : 0;
    }

    const payload: AdminStats = {
      total: tally.PENDING + tally.IN_REVIEW + tally.RESOLVED + tally.REJECTED,
      pending: tally.PENDING,
      inReview: tally.IN_REVIEW,
      resolved: tally.RESOLVED,
      rejected: tally.REJECTED,
      students,
      recent: recent.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        studentName: c.user.name,
      })),
    };

    // Per-admin data that changes constantly: never cached.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  });
}
