/**
 * Per-user sliding-window rate limiter for write-heavy REST routes.
 *
 * The socket server's checkRateLimit (server/socket.mjs) covers the realtime
 * path; this is its REST twin, because every message route accepts sends over
 * plain HTTP too, and an authenticated student scripting those POSTs could
 * otherwise flood the database unthrottled — the audit's major finding.
 *
 * Honest limitation, stated rather than hidden: this is per-process memory.
 * Netlify Functions are serverless, so a determined attacker spraying
 * concurrent invocations lands on multiple instances and each gets its own
 * window. That still collapses the trivial script loop (one warm instance
 * handles the burst) and matches what the socket limiter achieves on its
 * single process; a Redis-backed counter is the real answer if this app ever
 * faces real load. Nothing here blocks reads — only writes.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/** userId -> timestamps of accepted writes inside the window. */
const hits = new Map<string, number[]>();

export function checkRateLimit(userId: string): {
  ok: boolean;
  retryInSeconds: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter((at) => at > cutoff);

  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    // The oldest hit in the window is the one that has to age out.
    const oldest = recent[0] ?? now;
    const waitMs = oldest + WINDOW_MS - now;
    return { ok: false, retryInSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  recent.push(now);
  hits.set(userId, recent);

  // Opportunistic pruning: every call walks one user's array; the map itself
  // needs an occasional sweep or every user who ever posted stays keyed forever.
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (times.every((at) => at <= cutoff)) hits.delete(key);
    }
  }

  return { ok: true, retryInSeconds: 0 };
}
