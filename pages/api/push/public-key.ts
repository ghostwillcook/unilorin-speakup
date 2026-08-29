import type { NextApiRequest, NextApiResponse } from "next";

/**
 * GET /api/push/public-key — the VAPID public key for the client's
 * pushManager.subscribe call (lib/push.ts fetches it).
 *
 * No auth on purpose: the VAPID public key is public by definition — it is
 * baked into every push subscription this app creates and handed to the push
 * service in the clear. Gating it would only break subscribe flows for
 * not-yet-authenticated visitors. NEXT_PUBLIC_VAPID_PUBLIC_KEY is the
 * build-time copy (inlined at compile time by Next); VAPID_PUBLIC_KEY is the
 * runtime copy — either is fine, and an absent key yields "" so the client
 * can disable push cleanly rather than fail mid-subscribe.
 *
 * The socket server signs with VAPID_PUBLIC_KEY; this route must serve the
 * same key or the push service will reject the subscription's tokens.
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed. Use GET." });
    return;
  }

  res.status(200).json({
    publicKey:
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
      process.env.VAPID_PUBLIC_KEY ??
      "",
  });
}
