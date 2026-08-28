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

export interface DmMessage {
  id: string;
  studentId: string;
  senderRole: "STUDENT" | "ADMIN";
  content: string;
  createdAt: string;
  /** Present only on admin payloads. */
  studentName?: string;
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
      const token = await fetchHandshakeToken();
      if (cancelled.current) return;

      if (!token) {
        setStatus("offline");
        return;
      }

      local =
        shared ??
        io(SOCKET_URL, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 6000,
        });
      shared = local;

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
