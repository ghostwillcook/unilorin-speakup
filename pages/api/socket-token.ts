import type { NextApiRequest, NextApiResponse } from "next";
import { getToken } from "next-auth/jwt";
import { methodNotAllowed } from "@/lib/guards";

/**
 * Hands the caller its own raw NextAuth session token for the Socket.io
 * handshake.
 *
 * The socket server runs on a different origin (:4000), where the session
 * cookie is not dependably sent. Returning the already-encrypted token — never
 * a newly minted credential — lets the socket server verify it with the shared
 * NEXTAUTH_SECRET while granting nothing the caller did not already hold.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  const secret =
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "dev-only-insecure-secret-change-me"
      : undefined);

  const token = await getToken({ req, secret, raw: true });

  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  // Never cached: it is a per-user credential.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({ token });
}
