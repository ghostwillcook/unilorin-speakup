import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { AdminUserRow } from "./index";

/**
 * Activate / deactivate an account.
 *
 * Deactivation is the Unit's only moderation lever: `authorize()` in lib/auth.ts
 * refuses a sign-in when `isActive` is false, and requireRole/requirePage evict
 * anyone already holding a token. Because that lever is real, this route refuses
 * to point it at an ADMIN — otherwise one careless click could leave the Students
 * Affairs Unit with no way back into its own dashboard.
 *
 * The response reuses the roster row shape so the client can swap the updated
 * user straight into the list it already rendered.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  if (!requireDb(res)) return;
  if (!(await requireRole(req, res, "ADMIN"))) return;

  const rawId = req.query.id;
  const id = ((Array.isArray(rawId) ? rawId[0] : rawId) ?? "").trim();
  if (!id) return res.status(400).json({ error: "Missing user id." });

  const body = readJsonBody(req.body);
  if (!body) {
    return res.status(400).json({ error: "Body must be a JSON object." });
  }

  const { isActive } = body;
  if (typeof isActive !== "boolean") {
    return res
      .status(400)
      .json({ error: "`isActive` must be true or false." });
  }

  await guarded(res, async () => {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (target.role === "ADMIN" && !isActive) {
      res.status(400).json({
        error:
          "Administrator accounts cannot be deactivated. Change the role first " +
          "if this account should lose access.",
      });
      return;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive },
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

    const user: AdminUserRow = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      studentId: updated.studentId,
      role: updated.role,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      counts: {
        complaints: updated._count.complaints,
        messages: updated._count.chatMessages,
      },
    };

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ user });
  });
}

/**
 * Next parses `application/json` for us, but a client that posts a raw string
 * body should get a 400 rather than being read as an empty patch.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
