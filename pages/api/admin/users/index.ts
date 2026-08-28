import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { Role } from "@/lib/guards";

/**
 * Account roster for /admin/users.
 *
 * The per-user activity counts come from Prisma's `_count` selector rather than
 * from loading the relations, so the page can show "12 complaints / 340
 * messages" in the same single query that lists the accounts.
 */

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  studentId: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  counts: { complaints: number; messages: number };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  if (!requireDb(res)) return;
  if (!(await requireRole(req, res, "ADMIN"))) return;

  const raw = req.query.q;
  const q = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { studentId: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  await guarded(res, async () => {
    const rows = await prisma.user.findMany({
      where,
      // Role groups the list, name makes it scannable inside each group.
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        studentId: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: { select: { complaints: true, chatMessages: true } },
      },
    });

    const users: AdminUserRow[] = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      studentId: u.studentId,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      counts: { complaints: u._count.complaints, messages: u._count.chatMessages },
    }));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ users });
  });
}
