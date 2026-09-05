import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/* ------------------------------------------------------------------------- */
/* Wire payloads — the contract between server/socket.mjs and the UI.         */
/* ------------------------------------------------------------------------- */

/**
 * What a student client is allowed to see for a global-room message. There is
 * deliberately no userId field: the shape itself prevents the real author
 * leaking to peers.
 */
export interface PublicChatMessage {
  id: string;
  pseudonym: string;
  content: string;
  timestamp: string;
}

export interface PresencePayload {
  onlineStudents: number;
  onlineAdmins: number;
}

export type SocketStatus = "idle" | "connecting" | "online" | "offline";

/* ------------------------------------------------------------------------- */
/* Connection                                                                 */
/* ------------------------------------------------------------------------- */

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

let shared: Socket | null = null;

// One socket acquisition in flight at a time. Without this serialization,
// concurrent useSocket() mounts each judged the shared socket independently
// and raced each other into disconnecting healthy sockets — the full
// mechanism is documented on acquireSocket() below.
let inFlight: Promise<Socket | null> | null = null;

/**
 * The socket server is a separate process on another origin, so the session
 * cookie is not reliably sent with the handshake. Instead the client fetches
 * the raw NextAuth token from an API route and presents it as handshake auth;
 * the server verifies it with the shared NEXTAUTH_SECRET.
 */
async function fetchHandshakeToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/socket-token");
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the token, judge any existing shared socket, and build a fresh one
 * only when the old one is genuinely dead. Extracted from the hook so the
 * give-up heuristic lives in exactly one place.
 */
async function createSharedSocket(): Promise<Socket | null> {
  const token = await fetchHandshakeToken();
  if (!token) return null;

  // Reconnect-give-up revival: after 5 failed attempts socket.io stops
  // trying forever, but `shared` is never discarded — so every later page
  // reused a dead socket and every panel's status pill said
  // "connecting"/"offline" permanently while REST fallbacks silently
  // carried the app. When the shared socket has given up, discard it and
  // build a fresh one: the new attempt gets a full 5-attempt budget, and
  // the token is re-fetched so an expired session token is not reused
  // either.
  //
  // Give-up used to be inferred as "not connected and not reconnecting",
  // but _reconnecting is ALSO false during a socket's first connection
  // attempt — so a second useSocket() mount resolving while the first
  // socket was mid-handshake saw it as dead, manually disconnected it
  // (which sets the manager's skipReconnect flag: permanently dead) and
  // built its own, leaving the first consumer holding a corpse forever
  // (its effect deps are [enabled] only). The Manager's _readyState is
  // "opening" during that first handshake and only settles on "closed"
  // once the manager is truly done — including after reconnect attempts
  // are exhausted — so it distinguishes the two cases cleanly.
  //
  // Both fields are private socket.io Manager state with no public
  // accessors, so they are read defensively and treated as "still
  // trying" when absent — the cost of a wrong guess is only one rebuilt
  // socket, whereas wrongly guessing "gave up" kills a healthy one.
  const existing = shared;
  const manager = existing?.io as
    | { _readyState?: string; _reconnecting?: boolean }
    | undefined;
  const gaveUp =
    existing !== null &&
    manager?._readyState === "closed" &&
    !manager?._reconnecting;
  if (gaveUp && existing) {
    existing.disconnect();
    shared = null;
  }

  // Healthy (or freshly judging) shared socket: reuse it as-is.
  if (shared) {
    return shared;
  }

  const socket = io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 6000,
  });
  shared = socket;

  // Belt-and-braces companion to the _readyState heuristic above:
  // reconnect_failed is the library's own explicit "out of attempts"
  // signal, so honor it by dropping the shared reference — the next
  // useSocket() mount then builds a fresh socket (full 5-attempt budget,
  // re-fetched token) instead of reusing a dead one. The guard keeps a
  // newer socket from being discarded by an event fired by an older,
  // already-replaced manager.
  socket.io.on("reconnect_failed", () => {
    if (shared === socket) {
      shared = null;
    }
  });

  return socket;
}

/**
 * The single door to the shared socket.
 *
 * On a hard load of /student, NotificationBell (×2) and NotificationOverlay
 * all mount within the same tick and used to each run their own token fetch
 * and then independently judge the shared socket mid-handshake — each later
 * resolver disconnected the earlier, perfectly healthy connecting socket and
 * built its own. Serializing creation behind this module-level promise makes
 * every concurrent consumer await the SAME connection attempt instead of
 * each passing sentence on it. The promise is dropped once settled so a
 * later mount (e.g. after a failed token fetch, or after reconnect_failed
 * cleared the shared reference) starts a genuinely fresh attempt rather
 * than replaying a dead result.
 */
function acquireSocket(): Promise<Socket | null> {
  if (!inFlight) {
    inFlight = createSharedSocket().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function getSocket(): Socket | null {
  return shared;
}

export function disconnectSocket(): void {
  if (shared) {
    shared.removeAllListeners();
    shared.disconnect();
    shared = null;
  }
}

/**
 * React hook owning the connection lifecycle.
 *
 * Connects lazily and only where it is used, so the landing page never opens a
 * socket — and a socket server that is simply not running surfaces as
 * status "offline" rather than an error boundary.
 */
export function useSocket(enabled = true): {
  socket: Socket | null;
  status: SocketStatus;
} {
  const [status, setStatus] = useState<SocketStatus>(
    enabled ? "connecting" : "idle",
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }
    cancelled.current = false;
    setStatus("connecting");

    let local: Socket | null = null;

    // Named, so the cleanup below can detach them. The socket itself is shared
    // and outlives this component, so anonymous listeners would leave one live
    // set behind per mount — every tab switch adding another copy that calls
    // setState on a tree that is already gone.
    const onConnect = () => {
      if (!cancelled.current) setStatus("online");
    };
    const onDisconnect = () => {
      if (!cancelled.current) setStatus("offline");
    };
    const onConnectError = () => {
      if (!cancelled.current) setStatus("offline");
    };

    void (async () => {
      // Serialized: concurrent mounts all await the same in-flight attempt
      // (see acquireSocket), so none of them disconnects another's healthy
      // connecting socket.
      const acquired = await acquireSocket();
      if (cancelled.current) return;

      if (!acquired) {
        setStatus("offline");
        return;
      }

      local = acquired;

      local.on("connect", onConnect);
      local.on("disconnect", onDisconnect);
      local.on("connect_error", onConnectError);

      if (local.connected) setStatus("online");
      setSocket(local);
    })();

    return () => {
      cancelled.current = true;
      if (local) {
        local.off("connect", onConnect);
        local.off("disconnect", onDisconnect);
        local.off("connect_error", onConnectError);
      }
    };
  }, [enabled]);

  // The connection is shared across component trees, so it is not torn down on
  // unmount — only when the whole app unloads. The listener therefore has to be
  // registered on mount; hanging it off the cleanup function, as this once did,
  // meant it was only ever attached while the panel was already going away, so
  // a real page unload closed nothing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", disconnectSocket);
    return () => window.removeEventListener("beforeunload", disconnectSocket);
  }, []);

  return { socket, status };
}

/** Human-readable connection state for the status pill in chat headers. */
export function statusLabel(status: SocketStatus): string {
  switch (status) {
    case "online":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "offline":
      return "Chat server offline";
    default:
      return "Idle";
  }
}
