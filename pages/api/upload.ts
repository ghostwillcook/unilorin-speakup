import type { NextApiRequest, NextApiResponse } from "next";
import { guarded, methodNotAllowed, requireRole } from "@/lib/guards";
import {
  getSupabaseAdmin,
  isStorageConfigured,
  storageKeyFor,
  STORAGE_BUCKET,
  UPLOAD_LIMITS,
} from "@/lib/supabase";

/**
 * POST /api/upload — mints a one-shot signed upload URL for one attachment.
 *
 * The file itself never passes through Next.js: the browser gets a scoped token
 * and PUTs straight to Supabase Storage. That keeps the service-role key on the
 * server, avoids the 4 MB API body limit, and means the size/type rules are
 * enforced here, before any credential is issued.
 *
 * No requireDb: session state lives in the JWT and nothing here queries
 * Postgres, so uploads keep working during a database outage.
 */

const MAX_FILENAME = 255;

/** Widened from the readonly tuple so `.includes(string)` type-checks. */
const ALLOWED_MIME: readonly string[] = UPLOAD_LIMITS.allowedMime;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  // Authenticated before anything else, so an anonymous caller learns nothing
  // about how storage is configured.
  const user = await requireRole(req, res, "STUDENT");
  if (!user) return;

  if (!isStorageConfigured()) {
    return res.status(503).json({
      error: "File uploads are not configured on this deployment.",
      hint:
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in " +
        `.env.local, then create a private "${STORAGE_BUCKET}" storage bucket.`,
    });
  }

  await guarded(res, async () => {
    const body = asRecord(req.body as unknown);

    const filename = readString(body.filename);
    if (filename.length === 0) {
      res.status(400).json({ error: "A filename is required." });
      return;
    }
    // Distinct from the missing case: "required" would be misleading advice for
    // a name that was supplied and merely too long.
    if (filename.length > MAX_FILENAME) {
      res.status(400).json({
        error: `Filename must be ${MAX_FILENAME} characters or fewer.`,
      });
      return;
    }

    // Browsers sometimes append parameters, e.g. "text/plain; charset=utf-8".
    const contentType = readString(body.contentType)
      .toLowerCase()
      .split(";")[0]
      .trim();
    if (!ALLOWED_MIME.includes(contentType)) {
      res.status(400).json({
        error: `Files of type "${contentType || "unknown"}" are not accepted.`,
        hint: `Allowed types: ${ALLOWED_MIME.join(", ")}.`,
      });
      return;
    }

    const size = body.size;
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size <= 0
    ) {
      res
        .status(400)
        .json({ error: "size must be the file's length in bytes." });
      return;
    }
    if (size > UPLOAD_LIMITS.maxBytes) {
      res.status(400).json({
        error: `File is too large. The limit is ${megabytes(
          UPLOAD_LIMITS.maxBytes,
        )}.`,
      });
      return;
    }

    // Namespaced under the student's id, so one student's token can never be
    // aimed at another student's object.
    const path = storageKeyFor(user.id, filename);
    const bucket = getSupabaseAdmin().storage.from(STORAGE_BUCKET);

    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      res.status(502).json({
        error: error?.message ?? "Could not create an upload URL.",
        hint: `Confirm the "${STORAGE_BUCKET}" bucket exists in Supabase Storage.`,
      });
      return;
    }

    // No public URL is returned: the bucket is private. The client stores
    // `path` on the complaint, and every read goes through /api/attachments,
    // which authorizes the viewer before signing a link.
    // The token is a short-lived write credential: never cache this response.
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      path,
      token: data.token,
      bucket: STORAGE_BUCKET,
    });  });
}
