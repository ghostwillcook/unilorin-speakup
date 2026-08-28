import type { NextApiRequest, NextApiResponse } from "next";
import { guarded, methodNotAllowed, requireRole } from "@/lib/guards";
import {
  createSignedDownloadUrl,
  isStorageConfigured,
  isValidStorageKey,
  ownsStorageKey,
  STORAGE_BUCKET,
} from "@/lib/supabase";

/**
 * GET /api/attachments/<object key> — authorizes a viewer, then redirects to a
 * short-lived signed URL for the object.
 *
 * The bucket is private, so this route is the only way to read an attachment.
 * Authorization is by namespace: `storageKeyFor` prefixes every upload with the
 * owner's user id, so a student may read anything under `<their id>/` and
 * nothing else, while the Students Affairs Unit may read any attachment in
 * order to assess the complaint it belongs to.
 *
 * Deliberately no requireDb: ownership is provable from the key and the session
 * alone, so evidence stays viewable during a database outage — the same
 * reasoning as /api/upload.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  // Authenticated first, so an anonymous caller learns nothing about which keys
  // exist or how storage is configured.
  const user = await requireRole(req, res);
  if (!user) return;

  if (!isStorageConfigured()) {
    return res.status(503).json({
      error: "File storage is not configured on this deployment.",
      hint:
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in " +
        `.env.local, then create a private "${STORAGE_BUCKET}" storage bucket.`,
    });
  }

  await guarded(res, async () => {
    // A catch-all route hands back the segments; rejoin them into the key that
    // was originally issued. Next has already percent-decoded each segment.
    const segments = req.query.path;
    const key = Array.isArray(segments) ? segments.join("/") : String(segments ?? "");

    if (!isValidStorageKey(key)) {
      res.status(400).json({ error: "Not a valid attachment reference." });
      return;
    }

    // 404 rather than 403: a student probing another student's namespace should
    // not be able to tell an existing attachment from a missing one.
    if (user.role !== "ADMIN" && !ownsStorageKey(key, user.id)) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }

    const url = await createSignedDownloadUrl(key);

    // The signed URL is a bearer capability with a TTL: never let a shared cache
    // hold on to the redirect. 302 keeps this a plain <a href> or <img src>.
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Location", url);
    res.status(302).end();
  });
}
