import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { ComplaintStatus } from "@/components/StatusBadge";

/**
 * PATCH /api/complaints/[id] — the admin action that closes the loop.
 *
 * Only status and adminReply are writable. Title, description, attachments and
 * ownership stay exactly as the student submitted them, so the record of a
 * complaint cannot be edited by the office it was filed against.
 */

const MAX_REPLY = 5000;

interface Submitter {
  id: string;
  name: string;
  email: string;
  studentId: string;
}

interface AdminComplaint {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
  user: Submitter;
}

/** Prisma's row for ADMIN_COMPLAINT_FIELDS, dates not yet serialized. */
interface AdminComplaintRow {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: Date;
  updatedAt: Date;
  user: Submitter;
}

const ADMIN_COMPLAINT_FIELDS = {
  id: true,
  title: true,
  description: true,
  status: true,
  adminReply: true,
  files: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, studentId: true } },
} as const;

function toAdminComplaint(row: AdminComplaintRow): AdminComplaint {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    adminReply: row.adminReply,
    files: row.files,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      studentId: row.user.studentId,
    },
  };
}

/** Exhaustive by construction — see the same guard in ./index.ts. */
const STATUS_LOOKUP: Record<ComplaintStatus, true> = {
  PENDING: true,
  IN_REVIEW: true,
  RESOLVED: true,
  REJECTED: true,
};

const STATUS_NAMES = Object.keys(STATUS_LOOKUP).join(", ");

function isStatus(value: unknown): value is ComplaintStatus {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STATUS_LOOKUP, value)
  );
}

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  if (!requireDb(res)) return;

  const user = await requireRole(req, res, "ADMIN");
  if (!user) return;

  await guarded(res, async () => {
    const id = firstParam(req.query.id);
    if (!id) {
      res.status(400).json({ error: "Missing complaint id." });
      return;
    }

    const body = asRecord(req.body as unknown);
    // Presence, not truthiness: adminReply: "" is a deliberate instruction to
    // clear the reply, and must be distinguishable from omitting the field.
    const wantsStatus = hasKey(body, "status");
    const wantsReply = hasKey(body, "adminReply");

    if (!wantsStatus && !wantsReply) {
      res.status(400).json({
        error: "Nothing to update. Send status and/or adminReply.",
      });
      return;
    }

    const data: Prisma.ComplaintUpdateInput = {};

    if (wantsStatus) {
      const status = body.status;
      if (!isStatus(status)) {
        res.status(400).json({ error: `status must be one of ${STATUS_NAMES}.` });
        return;
      }
      data.status = status;
    }

    if (wantsReply) {
      const raw = body.adminReply;
      if (raw !== null && typeof raw !== "string") {
        res.status(400).json({ error: "adminReply must be a string or null." });
        return;
      }
      const reply = raw === null ? "" : raw.trim();
      if (reply.length > MAX_REPLY) {
        res
          .status(400)
          .json({ error: `Reply must be ${MAX_REPLY} characters or fewer.` });
        return;
      }
      data.adminReply = reply.length === 0 ? null : reply;
    }

    // Checked first so a bad id is a clean 404 rather than a Prisma P2025
    // surfacing as a 500 through `guarded`.
    const existing = await prisma.complaint.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Complaint not found." });
      return;
    }

    const row: AdminComplaintRow = await prisma.complaint.update({
      where: { id },
      data,
      select: ADMIN_COMPLAINT_FIELDS,
    });

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({ complaint: toAdminComplaint(row) });
  });
}
