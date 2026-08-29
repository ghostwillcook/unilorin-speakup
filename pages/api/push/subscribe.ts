import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import {
  guarded,
  methodNotAllowed,
  requireDb,
  requireRole,
} from "@/lib/guards";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST   /api/push/subscribe — register (or refresh) this browser's Web Push
 *         subscription so notifications reach it while the tab is closed.
 * DELETE /api/push/subscribe — remove it (the student turned notifications
 *         off; the browser also calls this automatically when a subscription
 *         expires, if it fires the pushsubscriptionchange event).
 *
 * A user may hold several rows — one per device/browser — and the endpoint is
 * globally unique per browser, so it is the natural upsert key. Re-subscribing
 * from the same browser updates the keys and re-binds the row to the current
 * user: push endpoints outlive sessions on shared lab machines, and a stale
 * row pointed at the previous user would deliver their notifications to the
 * next one.
 *
 * The userId never comes from the body; it comes from the verified session,
 * which is what stops a student from subscribing someone else's browser to
 * their notifications — or pointing their own subscription spam at another
 * student's device.
 */

/** Cap on each stored string: real push endpoints/keys are ~100-200 chars;
 *  anything larger is garbage a scripted client is storing to bloat rows. */
const MAX_FIELD = 2048;

interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Reads one member of the subscription's `keys` object, trimmed. */
function readKey(raw: unknown, key: "p256dh" | "auth"): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "";
  const keys = (raw as Record<string, unknown>).keys;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) {
    return "";
  }
  const value = (keys as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Extracts just the endpoint — all DELETE needs to identify the row.
 */
function readEndpoint(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "";
  const body = raw as Record<string, unknown>;
  return typeof body.endpoint === "string" ? body.endpoint.trim() : "";
}

/**
 * Extracts and validates the full subscription payload. The three strings are
 * what sendNotification needs to encrypt a payload for this browser; any of
 * them empty/garbled means the push would fail later anyway, so it is rejected
 * here with copy a human can act on.
 *
 * The endpoint must parse as an https:// URL: real push services are always
 * https, and an unvalidated endpoint would let a signed-in user register any
 * internal URL and have the server POST to it on the next notification send
 * (blind SSRF — fixed body, no readback, but a server-side request to a
 * chosen target all the same).
 */
function readSubscription(raw: unknown): SubscriptionInput | null {
  const endpoint = readEndpoint(raw);
  const p256dh = readKey(raw, "p256dh");
  const auth = readKey(raw, "auth");

  if (!endpoint || !p256dh || !auth) return null;
  if (endpoint.length > MAX_FIELD || p256dh.length > MAX_FIELD || auth.length > MAX_FIELD) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return methodNotAllowed(res, ["POST", "DELETE"]);
  }
  const user = await requireRole(req, res);
  if (!user) return;
  if (!requireDb(res)) return;

  await guarded(res, async () => {
    if (req.method === "POST") {
      // Subscription rows are cheap to mint but live forever — a scripted
      // client could otherwise fill the table with garbage endpoints.
      const verdict = checkRateLimit(user.id);
      if (!verdict.ok) {
        res.status(429).json({
          error: `Too many subscription changes. Try again in ${verdict.retryInSeconds}s.`,
        });
        return;
      }

      const input = readSubscription(req.body as unknown);
      if (!input) {
        res.status(400).json({
          error:
            "A subscription needs a non-empty endpoint and p256dh and auth keys.",
        });
        return;
      }

      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: { p256dh: input.p256dh, auth: input.auth, userId: user.id },
        create: {
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userId: user.id,
        },
      });

      res.status(201).json({ ok: true });
      return;
    }

    // DELETE: deleteMany rather than delete so removing an already-gone
    // subscription is a plain success, not a P2025 error — the outcome the
    // caller wants ("it is no longer registered") holds either way. Only the
    // endpoint is needed; turning notifications off should not also require
    // the client to still hold valid encryption keys.
    const endpoint = readEndpoint(req.body as unknown);
    if (!endpoint) {
      res.status(400).json({ error: "A subscription endpoint is required." });
      return;
    }
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: user.id },
    });
    res.status(200).json({ ok: true });
  });
}
