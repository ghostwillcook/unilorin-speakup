import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * GET /api/admin/users/lookup?identifier=...
 *
 * "Message a User" (spec §6): the admin types EITHER the student's anonymous
 * handle ("Anonymous #42", from Live Chat) OR their matric number, and this
 * resolves the account so the console can open that student's normal DM
 * thread.
 *
 * A miss is a 404 with the spec's own copy — never a technical error — because
 * the input is a human typing from memory. Only STUDENT accounts resolve: an
 * admin typing another admin's handle has not found "a user to message".
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const caller = await requireRole(req, res, "ADMIN");
  if (!caller) return;
  if (!requireDb(res)) return;

  const raw = req.query.identifier;
  const identifier = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim();

  await guarded(res, async () => {
    if (identifier.length === 0) {
      res.status(400).json({ error: "Enter an anonymous ID or matric number." });
      return;
    }

    // Case-insensitive on both spellings: "anonymous #42" == "Anonymous #42",
    // and matric numbers are typed with and without the slash spacing.
    const normalized = identifier.toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        role: "STUDENT",
        OR: [
          { studentId: { equals: identifier, mode: "insensitive" } },
          {
            liveConversation: {
              pseudonym: { equals: normalized, mode: "insensitive" },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        studentId: true,
        isActive: true,
        liveConversation: { select: { pseudonym: true } },
      },
    });

    if (!user) {
      res.status(404).json({
        error:
          "User not found. Please check the ID or matric number and try again.",
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        studentId: user.studentId,
        isActive: user.isActive,
        anonymousId: user.liveConversation?.pseudonym ?? null,
      },
    });
  });
}
