import type { NextApiRequest, NextApiResponse } from "next";
import { getSettings, saveSettings } from "@/lib/settings";
import type { StudentConnectSettings } from "@/lib/settings";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";

/**
 * Runtime settings for /admin/settings.
 *
 * GET deliberately skips requireDb: getSettings() falls back to
 * DEFAULT_SETTINGS when there is no database (or no Setting table yet), so the
 * settings page renders truthfully during setup instead of 503-ing. PUT does
 * gate on the database, because a write that cannot persist must not look like
 * a success.
 *
 * Unknown keys are rejected rather than ignored: a typo'd field would otherwise
 * return 200 with the old value, which reads as "saved" in the UI.
 */

const ALLOWED_KEYS = [
  "anonymousMode",
  "chatRateLimitPerMin",
  "complaintSubmissionLimit",
] as const;
const ALLOWED = new Set<string>(ALLOWED_KEYS);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "PUT") {
    return methodNotAllowed(res, ["GET", "PUT"]);
  }
  if (!(await requireRole(req, res, "ADMIN"))) return;

  if (req.method === "GET") {
    return guarded(res, async () => {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({ settings: await getSettings() });
    });
  }

  if (!requireDb(res)) return;

  const body = readJsonBody(req.body);
  if (!body) {
    return res.status(400).json({ error: "Body must be a JSON object." });
  }

  const unknown = Object.keys(body).filter((key) => !ALLOWED.has(key));
  if (unknown.length > 0) {
    return res.status(400).json({
      error: `Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(
        ", ",
      )}. Allowed: ${ALLOWED_KEYS.join(", ")}.`,
    });
  }

  const patch: Partial<StudentConnectSettings> = {};

  if ("anonymousMode" in body) {
    const value = body.anonymousMode;
    if (typeof value !== "boolean") {
      return res
        .status(400)
        .json({ error: "`anonymousMode` must be true or false." });
    }
    patch.anonymousMode = value;
  }

  if ("chatRateLimitPerMin" in body) {
    const value = body.chatRateLimitPerMin;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return res
        .status(400)
        .json({ error: "`chatRateLimitPerMin` must be a number." });
    }
    patch.chatRateLimitPerMin = value;
  }

  if ("complaintSubmissionLimit" in body) {
    const value = body.complaintSubmissionLimit;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return res.status(400).json({
        error: "`complaintSubmissionLimit` must be a non-negative number (0 = unlimited).",
      });
    }
    patch.complaintSubmissionLimit = value;
  }

  // An empty body is the same failure as a typo'd key: nothing would be
  // written, but a 200 with the current values reads as "saved" in the UI.
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error: `Nothing to update. Send at least one of: ${ALLOWED_KEYS.join(", ")}.`,
    });
  }

  await guarded(res, async () => {
    // saveSettings clamps the rate limit to a sane range and re-reads the rows,
    // so the response is what was actually stored — not what was asked for.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ settings: await saveSettings(patch) });
  });
}

/**
 * Next parses `application/json` for us, but a client that posts a raw string
 * body should get a 400 rather than being read as an empty patch.
 */
function readJsonBody(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "string") {
    if (!raw.trim()) return {};
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
