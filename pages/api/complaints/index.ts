import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import type { SessionUser } from "@/lib/guards";
import { getSettings } from "@/lib/settings";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getSupabaseAdmin,
  isStorageConfigured,
  ownsStorageKey,
  STORAGE_BUCKET,
  UPLOAD_LIMITS,
} from "@/lib/supabase";
import type { ComplaintStatus } from "@/components/StatusBadge";

/**
 * GET  /api/complaints   list — students see only their own, admins see all
 * POST /api/complaints   students file a new complaint
 *
 * The single most important rule in this file: a student response is assembled
 * field by field from an explicit list. `userId` is never selected on the
 * student path and never mapped on either path, so the column that links a
 * complaint to a person cannot escape through this endpoint by accident — not
 * even if the Prisma model grows new fields later.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
/** Matches the ceiling enforced in lib/supabase.ts, so both agree on a key. */
const MAX_KEY = 400;
/** Widened from the readonly tuple so `.includes(string)` type-checks. */
const ALLOWED_MIME: readonly string[] = UPLOAD_LIMITS.allowedMime;
/** The byte ceiling phrased for caller-facing error messages. */
const MAX_FILE_MB = Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024));

/* ------------------------------------------------------------------ shapes */

interface StudentComplaint {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: string;
  updatedAt: string;
  /** Newest thread message, for the My Complaints list preview. Absent on the
   *  admin list, which reads the thread itself when a complaint is opened. */
  lastMessage?: { content: string; senderRole: string; createdAt: string } | null;
  /** Unread replies from the Unit — the list's unread dot (student list only). */
  unread?: number;
}

interface Submitter {
  id: string;
  name: string;
  email: string;
  studentId: string;
}

interface AdminComplaint extends StudentComplaint {
  user: Submitter;
}

/** What Prisma hands back for COMPLAINT_FIELDS — dates still Date objects. */
interface ComplaintRow {
  id: string;
  title: string;
  description: string;
  status: ComplaintStatus;
  adminReply: string | null;
  files: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface AdminComplaintRow extends ComplaintRow {
  user: Submitter;
}

/* ------------------------------------------------------- explicit selection */

const COMPLAINT_FIELDS = {
  id: true,
  title: true,
  description: true,
  status: true,
  adminReply: true,
  files: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

function toStudentComplaint(row: ComplaintRow): StudentComplaint {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    adminReply: row.adminReply,
    files: row.files,
    // Props and JSON bodies must be serializable; Date objects are not.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAdminComplaint(row: AdminComplaintRow): AdminComplaint {
  return {
    ...toStudentComplaint(row),
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      studentId: row.user.studentId,
    },
  };
}

/* -------------------------------------------------------------- validation */

/**
 * Exhaustive by construction: if ComplaintStatus ever gains a member this
 * object stops compiling, so the filter whitelist cannot silently drift out of
 * step with the schema.
 */
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

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a filter boundary. A bare `YYYY-MM-DD` is widened to cover the whole
 * UTC day so `from=to=today` returns today's complaints instead of nothing,
 * which is what "inclusive" has to mean for a date input. A full ISO timestamp
 * is honoured exactly as sent.
 */
function parseBoundary(raw: string, endOfDay: boolean): Date | null {
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type FilesResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string };

function clip(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

/**
 * Attachments arrive as Supabase Storage object keys already issued by
 * /api/upload — the bucket is private, so there is no public URL to store.
 *
 * Every key must sit in the caller's own namespace. That is the check which
 * stops a student from attaching, and thereby gaining a route to read, another
 * student's evidence: `ownsStorageKey` also rejects `..` and absolute paths.
 *
 * This is also the second layer of upload enforcement, and the only one that
 * sees real bytes. /api/upload checks the size and MIME type the client
 * *declared* and then mints a signed upload URL, which binds no restriction
 * (storage-js createSignedUploadUrl options are upsert-only) — the PUT that
 * follows carries its own headers and any byte length, and Supabase stores it.
 * By the time a key reaches here the object exists, so its stored metadata is
 * finally checkable against UPLOAD_LIMITS: a submission whose stored size or
 * content-type breaks the rules is rejected whole, because the offending file
 * is already sitting in the bucket and silently attaching a clean subset would
 * hide the problem from the student instead of telling them what to re-upload.
 */
async function readFiles(value: unknown, userId: string): Promise<FilesResult> {
  if (value === undefined || value === null) return { ok: true, files: [] };

  if (!Array.isArray(value)) {
    return { ok: false, error: "files must be an array of upload keys." };
  }
  const entries: unknown[] = value;

  if (entries.length > UPLOAD_LIMITS.maxFiles) {
    return {
      ok: false,
      error: `A complaint may include at most ${UPLOAD_LIMITS.maxFiles} attachments.`,
    };
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      return { ok: false, error: "Every attachment must be an upload key string." };
    }
    const key = entry.trim();
    if (key.length === 0) {
      return { ok: false, error: "Attachment keys cannot be empty." };
    }
    if (key.length > MAX_KEY || !ownsStorageKey(key, userId)) {
      return {
        ok: false,
        error: `Attachment "${clip(key)}" is not one of your uploads.`,
      };
    }
    files.push(key);
  }

  // Storage must be reachable to verify anything. When it is not configured,
  // /api/upload never minted a credential, so no submitted key can be a real
  // attachment — reject rather than attach unverifiable keys to a complaint.
  if (files.length > 0 && !isStorageConfigured()) {
    return {
      ok: false,
      error: "Attachment uploads are not configured on this deployment.",
    };
  }

  for (const key of files) {
    const problem = await verifyStoredAttachment(key);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, files };
}

/**
 * Stats one stored object with the service-role client and compares the REAL
 * metadata against UPLOAD_LIMITS. Returns null when the object passes, or a
 * caller-facing error message when it does not — the wording mirrors
 * /api/upload's so the same mistake reads the same at both layers.
 */
async function verifyStoredAttachment(key: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .info(key);

  // A key that passed the namespace check but matches no object was never
  // uploaded through this app, or was deleted since — either way there is
  // nothing to attach. Anything else (network error, 5xx) is a transient
  // outage on Supabase's side, not the caller's mistake, so it gets copy
  // that says "try again" rather than accusing the file of not existing.
  if (error || !data) {
    const status =
      (error as { statusCode?: number } | null)?.statusCode ??
      (typeof (error as { status?: number } | null)?.status === "number"
        ? (error as { status?: number }).status
        : 0);
    if (status === 404 || status === 400) {
      return `Attachment "${clip(key)}" could not be found in storage.`;
    }
    return `Attachment storage could not be reached — please try again in a moment.`;
  }

  const { size, contentType } = data;
  if (typeof size !== "number" || typeof contentType !== "string") {
    return `Attachment "${clip(key)}" could not be verified against storage.`;
  }
  if (size > UPLOAD_LIMITS.maxBytes) {
    return `Attachment "${clip(key)}" is larger than the ${MAX_FILE_MB} MB limit.`;
  }

  // The stored content-type can carry parameters ("text/plain; charset=utf-8")
  // exactly like the browser-declared header /api/upload normalizes.
  const mime = contentType.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIME.includes(mime)) {
    return `Files of type "${mime || "unknown"}" are not accepted.`;
  }
  return null;
}

/* ------------------------------------------------------------------- routes */

async function listOwn(res: NextApiResponse, userId: string): Promise<void> {
  // The list is the My Complaints inbox, so each row carries its newest thread
  // message (for the preview) and a filtered count of unread Unit replies (for
  // the dot). One query, no N+1. Both message reads filter `deletedAt`: a
  // soft-deleted message must not leak its text into the preview nor keep the
  // unread dot lit — the student asked for it gone, and the thread page
  // already hides it, so the list agreeing with the thread is what stops a
  // "deleted" message from living on in the preview.
  const rows = await prisma.complaint.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      ...COMPLAINT_FIELDS,
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, senderRole: true, createdAt: true },
      },
      _count: {
        select: {
          messages: {
            where: { senderRole: "ADMIN", readAt: null, deletedAt: null },
          },
        },
      },
    },
  });

  res.status(200).json({
    complaints: rows.map((row) => {
      const last = row.messages[0] ?? null;
      return {
        ...toStudentComplaint(row),
        lastMessage: last
          ? {
              content: last.content,
              senderRole: last.senderRole,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
        unread: row._count.messages,
      };
    }),
  });
}

async function listAll(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  const filters: Prisma.ComplaintWhereInput[] = [];

  const status = firstParam(req.query.status);
  if (status) {
    if (!isStatus(status)) {
      res.status(400).json({ error: `status must be one of ${STATUS_NAMES}.` });
      return;
    }
    filters.push({ status });
  }

  const q = firstParam(req.query.q);
  if (q) {
    // Admins search by what they have in front of them: a phrase from the
    // complaint, or the student's name, email or matric number.
    filters.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { studentId: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const from = firstParam(req.query.from);
  const to = firstParam(req.query.to);
  const createdAt: { gte?: Date; lte?: Date } = {};

  if (from) {
    const start = parseBoundary(from, false);
    if (!start) {
      res.status(400).json({ error: "from must be an ISO date, e.g. 2026-01-31." });
      return;
    }
    createdAt.gte = start;
  }
  if (to) {
    const end = parseBoundary(to, true);
    if (!end) {
      res.status(400).json({ error: "to must be an ISO date, e.g. 2026-01-31." });
      return;
    }
    createdAt.lte = end;
  }
  if (createdAt.gte || createdAt.lte) filters.push({ createdAt });

  const rows: AdminComplaintRow[] = await prisma.complaint.findMany({
    where: filters.length > 0 ? { AND: filters } : {},
    orderBy: { createdAt: "desc" },
    select: ADMIN_COMPLAINT_FIELDS,
  });
  res.status(200).json({ complaints: rows.map(toAdminComplaint) });
}

async function create(
  req: NextApiRequest,
  res: NextApiResponse,
  user: SessionUser,
): Promise<void> {
  if (user.role !== "STUDENT") {
    res.status(403).json({ error: "Only students can file complaints." });
    return;
  }

  // Rate limit first: complaint creation was the one write path without one.
  // Each submission costs several DB round trips plus optional uploads, and
  // an unthrottled scripted loop could flood the complaints queue and the
  // admin dashboard stats.
  const verdict = checkRateLimit(user.id);
  if (!verdict.ok) {
    res.status(429).json({
      error: `You are submitting complaints too quickly. Try again in ${verdict.retryInSeconds}s.`,
    });
    return;
  }

  // Submission limit: the admin sets a ceiling on how many complaints a
  // student may have OPEN (PENDING or IN_REVIEW) at once. 0 = unlimited.
  // Checked BEFORE validation so a limit-blocked student gets the limit
  // message rather than a title-length complaint they can never submit.
  //
  // NOTE: there is a theoretical TOCTOU race — two requests submitted in
  // the same instant can both read openCount < limit and both create. The
  // worst case is one extra complaint over the limit, which self-corrects
  // when either complaint is resolved. Closing it properly requires a
  // serializable transaction or a DB-level constraint that doesn't exist
  // here (the "open" count depends on status, not a counter column), and
  // the cost of that machinery far outweighs a single over-limit complaint
  // on a platform whose rate limit already prevents rapid-fire submissions.
  const { complaintSubmissionLimit } = await getSettings();
  if (complaintSubmissionLimit > 0) {
    const openCount = await prisma.complaint.count({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "IN_REVIEW"] },
      },
    });
    if (openCount >= complaintSubmissionLimit) {
      res.status(429).json({
        error: `You already have ${openCount} complaint${
          openCount === 1 ? "" : "s"
        } under review. The current limit is ${complaintSubmissionLimit}. ` +
          "Please wait for a response before submitting more.",
      });
      return;
    }
  }

  const body = asRecord(req.body as unknown);
  const title = readString(body.title);
  const description = readString(body.description);

  if (title.length === 0) {
    res.status(400).json({ error: "A title is required." });
    return;
  }
  if (title.length > MAX_TITLE) {
    res
      .status(400)
      .json({ error: `Title must be ${MAX_TITLE} characters or fewer.` });
    return;
  }
  if (description.length === 0) {
    res.status(400).json({ error: "A description is required." });
    return;
  }
  if (description.length > MAX_DESCRIPTION) {
    res.status(400).json({
      error: `Description must be ${MAX_DESCRIPTION} characters or fewer.`,
    });
    return;
  }

  const files = await readFiles(body.files, user.id);
  if (!files.ok) {
    res.status(400).json({ error: files.error });
    return;
  }

  const row: ComplaintRow = await prisma.complaint.create({
    // The owner comes from the verified session. A `userId` in the body is
    // ignored outright, so one student cannot file under another's name.
    data: {
      userId: user.id,
      title,
      description,
      files: files.files,
    },
    select: COMPLAINT_FIELDS,
  });

  res.status(201).json({ complaint: toStudentComplaint(row) });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return methodNotAllowed(res, ["GET", "POST"]);
  }
  if (!requireDb(res)) return;

  const user = await requireRole(req, res);
  if (!user) return;

  await guarded(res, async () => {
    if (req.method === "GET") {
      // Personal data: never store it in a shared or browser cache.
      res.setHeader("Cache-Control", "no-store, max-age=0");
      if (user.role === "STUDENT") {
        await listOwn(res, user.id);
      } else {
        await listAll(req, res);
      }
      return;
    }
    await create(req, res, user);
  });
}
