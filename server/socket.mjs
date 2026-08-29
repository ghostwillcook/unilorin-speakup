/**
 * UNILORIN SpeakUp — standalone realtime server.
 *
 * Socket.io needs a long-lived connection, which Vercel's serverless functions
 * cannot hold, so the realtime layer is its own process: `npm run socket`.
 * That independence is the source of most of the decisions in this file.
 *
 *   - It gets no help from Next: no `@/` alias, no automatic .env.local load,
 *     and no access to anything in lib/ (those are TypeScript). The small
 *     duplications below — env parsing, settings reading, the DM wire shape —
 *     are deliberate copies of lib/ logic, kept behaviourally identical rather
 *     than imported.
 *   - It shares exactly one thing with the web app: NEXTAUTH_SECRET. Clients
 *     hand over the raw NextAuth session token they fetched from
 *     /api/socket-token and this process decrypts it. No second credential
 *     system, no session table.
 *
 * Wire contract (mirrored by lib/socket-client.ts):
 *
 *   in    chat:send             { content }
 *         dm:send               { studentId?, content }
 *         chat:history:request  {}
 *         complaint:join        { complaintId }
 *         complaint:send        { complaintId, content }
 *         livechat:join         { conversationId? }
 *         livechat:send         { content }
 *         livechat:reply        { conversationId, content }
 *   out   chat:history          PublicChatMessage[]   last 50, oldest first
 *         chat:message          PublicChatMessage     broadcast to everyone
 *         chat:error            { message }           to the one sender
 *         dm:new                DmMessage             to user:<id> and "admins"
 *         complaint:new         ComplaintMessage      to complaint:<id>
 *         livechat:new          LiveMessage           to live:<conversationId>
 *         livechat:inbox        InboxSummary          to "admins" (unread bump)
 *         presence              { onlineStudents, onlineAdmins }
 *         session               { pseudonym }         on connect
 *
 * The three new families are thin realtime skins over REST-backed tables:
 * ComplaintMessage and LiveMessage. Every socket write is a plain
 * prisma.*.create — the same rows /api/complaints/[id]/messages and
 * /api/livechat write — so the database is the source of truth and a socket
 * that is down only costs the instant echo, never the message. Authorization
 * is per-room and per-write: joining complaint:<id> requires owning the
 * complaint or being an admin, and a student's livechat:send can only ever
 * address their own conversation because the conversation row is looked up BY
 * their user id, never by a client-supplied conversation id.
 *
 * PublicChatMessage carries no userId, ever. That is enforced here by the
 * `select` on every ChatMessage query rather than by remembering to strip a
 * field before emitting.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { decode } from "next-auth/jwt";

/* ------------------------------------------------------------------ env load */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimal .env reader.
 *
 * `dotenv` is not a dependency and this process starts outside Next, which is
 * what normally loads .env.local. Without this the socket server would come up
 * with no DATABASE_URL and no NEXTAUTH_SECRET and reject every handshake, while
 * `npm run dev` alongside it worked fine — a genuinely confusing failure.
 *
 * Real environment variables always win, so a deployment that injects config
 * (Railway, Fly.io) is never overridden by a stray checked-out file. Values may
 * be quoted; unquoted values may carry a trailing `# comment`. Multi-line
 * values are not supported — nothing this app needs uses them.
 */
function loadEnvFile(filename) {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, filename), "utf8");
  } catch {
    // Absent is the normal case for at least one of the two files.
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const body = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const eq = body.indexOf("=");
    if (eq <= 0) continue;

    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = cleanValue(body.slice(eq + 1).trim());
  }
}

function cleanValue(input) {
  const quote = input.charAt(0);
  const isQuoted =
    input.length >= 2 &&
    (quote === '"' || quote === "'") &&
    input.endsWith(quote);

  if (isQuoted) {
    const inner = input.slice(1, -1);
    // Only double quotes get escape expansion, matching dotenv. A `#` inside
    // quotes is data — Postgres passwords legitimately contain one.
    return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r") : inner;
  }

  const comment = input.indexOf(" #");
  return (comment === -1 ? input : input.slice(0, comment)).trim();
}

// .env.local first: it is the file the README tells people to create, and the
// `!== undefined` guard above means whichever is read first wins.
loadEnvFile(".env.local");
loadEnvFile(".env");

/* -------------------------------------------------------------------- config */

/**
 * SOCKET_PORT stays authoritative so a local override always wins, but hosted
 * platforms (Render, Railway, Fly) inject PORT and require the process to bind
 * exactly that — a service listening on 4000 while the platform routes to PORT
 * fails its health check and is killed as unresponsive.
 */
const PORT = Number(process.env.SOCKET_PORT || process.env.PORT || 4000);
const ORIGIN = process.env.NEXTAUTH_URL || "http://localhost:3000";
const SECRET =
  process.env.NEXTAUTH_SECRET || "dev-only-insecure-secret-change-me";

const HISTORY_LIMIT = 50;
const MAX_CHAT_LENGTH = 2000;
/** Matches MAX_CONTENT in pages/api/dm/[studentId].ts: both paths write the
 *  same rows, so they must accept the same input. */
const MAX_DM_LENGTH = 4000;
/** Matches the REST routes for complaint threads and Live Chat. */
const MAX_THREAD_LENGTH = 4000;
const RATE_WINDOW_MS = 60_000;
const SETTINGS_TTL_MS = 5_000;
/** Admins are never anonymised in the global room — see connection handler. */
const STAFF_LABEL = "Student Affairs";

if (!process.env.DATABASE_URL) {
  console.error(
    [
      "",
      "  Cannot start the realtime server: DATABASE_URL is not set.",
      "",
      "  Chat and direct messages are persisted, so there is nothing useful to",
      "  do without a database. Copy .env.local.example to .env.local, fill in",
      "  your Supabase connection strings, then run:",
      "",
      "      npx prisma migrate dev",
      "      npm run socket",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(
    `  Cannot start the realtime server: SOCKET_PORT="${process.env.SOCKET_PORT}" is not a valid port.`,
  );
  process.exit(1);
}

if (!process.env.NEXTAUTH_SECRET) {
  console.warn(
    "  [socket] NEXTAUTH_SECRET is not set — falling back to the insecure dev\n" +
      "           secret. Handshakes only succeed while the web app uses the same\n" +
      "           fallback. Set it in both processes before deploying.",
  );
}

const prisma = new PrismaClient({ log: ["error"] });

function errText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ------------------------------------------------------------------ settings */

const DEFAULT_SETTINGS = { anonymousMode: true, chatRateLimitPerMin: 20 };

/**
 * Cached mirror of lib/settings.ts, parsed identically (`"true"` is the only
 * truthy spelling; a non-positive integer falls back to the default).
 *
 * Cached for a few seconds because chat:send would otherwise pay a round trip
 * per message. The trade is that flipping a setting in /admin/settings takes
 * effect within SETTINGS_TTL_MS instead of instantly, which is invisible to a
 * human but keeps a busy room from hammering the Setting table.
 */
let settingsCache = { value: { ...DEFAULT_SETTINGS }, readAt: 0 };

async function getSettings() {
  const now = Date.now();
  if (now - settingsCache.readAt < SETTINGS_TTL_MS) return settingsCache.value;

  try {
    const rows = await prisma.setting.findMany();
    const map = new Map(rows.map((row) => [row.key, row.value]));

    const anonymousRaw = map.get("anonymousMode");
    const limitRaw = Number.parseInt(map.get("chatRateLimitPerMin") ?? "", 10);

    settingsCache = {
      value: {
        anonymousMode:
          anonymousRaw === undefined
            ? DEFAULT_SETTINGS.anonymousMode
            : anonymousRaw === "true",
        chatRateLimitPerMin:
          Number.isFinite(limitRaw) && limitRaw > 0
            ? limitRaw
            : DEFAULT_SETTINGS.chatRateLimitPerMin,
      },
      readAt: now,
    };
  } catch (error) {
    // The table may not exist yet (pre-migration). Defaults keep chat working.
    console.warn("[socket] settings read failed, using defaults:", errText(error));
    settingsCache = { value: { ...DEFAULT_SETTINGS }, readAt: now };
  }

  return settingsCache.value;
}

/* ---------------------------------------------------------------- rate limit */

/**
 * Sliding window per userId, held in memory.
 *
 * Per *user* rather than per socket, so opening a second tab does not double
 * anyone's allowance. In-memory is the right scope: a single socket process
 * sees every message, and a restart forgiving old hits is harmless.
 *
 * @type {Map<string, number[]>}
 */
const rateHits = new Map();

function checkRateLimit(userId, limitPerMin) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (rateHits.get(userId) ?? []).filter((at) => at > cutoff);

  if (hits.length >= limitPerMin) {
    rateHits.set(userId, hits);
    // The oldest hit in the window is the one that has to age out.
    const oldest = hits[0] ?? now;
    const waitMs = oldest + RATE_WINDOW_MS - now;
    return { ok: false, retryInSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  hits.push(now);
  rateHits.set(userId, hits);
  return { ok: true, retryInSeconds: 0 };
}

// Without this, every user who ever connected keeps an array forever.
const pruneTimer = setInterval(
  () => {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [userId, hits] of rateHits) {
      const fresh = hits.filter((at) => at > cutoff);
      if (fresh.length === 0) rateHits.delete(userId);
      else rateHits.set(userId, fresh);
    }
  },
  5 * 60_000,
);
pruneTimer.unref();

/* ------------------------------------------------------------------ presence */

/**
 * Distinct users online, each holding the socket ids it has open.
 *
 * Keyed by userId so two tabs count once — presence answers "how many people
 * are here", not "how many connections exist".
 *
 * @type {Map<string, { role: "STUDENT" | "ADMIN", sockets: Set<string> }>}
 */
const online = new Map();

function addPresence(user, socketId) {
  const entry = online.get(user.id);
  if (entry) entry.sockets.add(socketId);
  else online.set(user.id, { role: user.role, sockets: new Set([socketId]) });
}

function removePresence(userId, socketId) {
  const entry = online.get(userId);
  if (!entry) return;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) online.delete(userId);
}

function presencePayload() {
  let onlineStudents = 0;
  let onlineAdmins = 0;
  for (const entry of online.values()) {
    if (entry.role === "ADMIN") onlineAdmins += 1;
    else onlineStudents += 1;
  }
  return { onlineStudents, onlineAdmins };
}

/* ----------------------------------------------------------------- pseudonym */

/**
 * Pseudonyms currently in use, so two students in the same room are not both
 * "Anonymous #42" — which would read as one person contradicting themselves.
 *
 * @type {Set<string>}
 */
const takenPseudonyms = new Set();

function claimPseudonym() {
  // 10..999 keeps N at the specified 2-3 digits.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `Anonymous #${10 + Math.floor(Math.random() * 990)}`;
    if (!takenPseudonyms.has(candidate)) {
      takenPseudonyms.add(candidate);
      return candidate;
    }
  }
  // 20 collisions means the room is implausibly full; a duplicate beats a hang.
  return `Anonymous #${10 + Math.floor(Math.random() * 990)}`;
}

function releasePseudonym(pseudonym) {
  if (pseudonym) takenPseudonyms.delete(pseudonym);
}

/**
 * The name to attach to a message right now.
 *
 * The pseudonym itself is fixed for the life of the connection, but whether it
 * is used is read fresh: an admin turning anonymousMode off should not have to
 * ask every student to reconnect.
 */
async function displayNameFor(socket) {
  const { anonymousMode } = await getSettings();
  if (anonymousMode) return socket.data.pseudonym;
  return socket.data.user.name || socket.data.pseudonym;
}

/* -------------------------------------------------------------- wire helpers */

const CHAT_PUBLIC_FIELDS = {
  id: true,
  pseudonym: true,
  content: true,
  timestamp: true,
};

const DM_FIELDS = {
  id: true,
  studentId: true,
  senderRole: true,
  content: true,
  createdAt: true,
};

function toPublicChatMessage(row) {
  return {
    id: row.id,
    pseudonym: row.pseudonym,
    content: row.content,
    timestamp: row.timestamp.toISOString(),
  };
}

function toDmMessage(row) {
  return {
    id: row.id,
    studentId: row.studentId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Pulls `content` off an event payload.
 *
 * Returns null for anything unusable, so callers have one thing to check. A
 * bare string is tolerated as well as the contract's `{ content }`.
 */
function readContent(payload) {
  const raw =
    typeof payload === "string"
      ? payload
      : payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.content
        : undefined;

  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function recentHistory() {
  // Newest 50 by query, then reversed: the client renders oldest first.
  const rows = await prisma.chatMessage.findMany({
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: CHAT_PUBLIC_FIELDS,
  });
  return rows.reverse().map(toPublicChatMessage);
}

/* ----------------------------------------------------------------- transport */

const httpServer = createServer((req, res) => {
  // A plain HTTP probe for the platforms this is deployed to, and a quick way
  // to tell "server down" from "handshake refused" while debugging.
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        ...presencePayload(),
      }),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("UNILORIN SpeakUp realtime server. Socket.io endpoint: /socket.io/\n");
});

const io = new Server(httpServer, {
  cors: { origin: ORIGIN, credentials: true },
});

function broadcastPresence() {
  io.emit("presence", presencePayload());
}

/* ---------------------------------------------------------------- handshake */

/**
 * Authenticates the connection from the NextAuth session token.
 *
 * Two checks, not one. The token says whether the account was active when it
 * was issued; the database says whether it is active *now*. Sessions last eight
 * hours, so trusting the token alone would let a student the Unit just blocked
 * keep talking for the rest of the day — which would quietly defeat the whole
 * point of the block button on /admin/users. One indexed lookup per connection
 * (not per message) is a cheap way to make deactivation immediate.
 */
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || token.length === 0) {
      return next(new Error("unauthorized"));
    }

    let payload = null;
    try {
      payload = await decode({ token, secret: SECRET });
    } catch {
      // Tampered, expired, or signed with a different secret. All the same
      // answer: no detail goes back to the client.
      payload = null;
    }
    if (!payload || payload.isActive === false) {
      return next(new Error("unauthorized"));
    }

    const id =
      typeof payload.id === "string" && payload.id
        ? payload.id
        : typeof payload.sub === "string"
          ? payload.sub
          : "";
    if (!id) return next(new Error("unauthorized"));

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        studentId: true,
        isActive: true,
      },
    });
    if (!user || !user.isActive) return next(new Error("unauthorized"));

    // Role and name come from the row, not the claims: the database is the
    // authority on both, and a token cannot outrank it.
    socket.data.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      studentId: user.studentId,
    };
    return next();
  } catch (error) {
    // Includes the database being unreachable. Failing closed is right: every
    // event handler needs the database anyway.
    console.error("[socket] handshake rejected:", errText(error));
    return next(new Error("unauthorized"));
  }
});

/* ------------------------------------------------------------------ handlers */

async function handleHistoryRequest(socket) {
  try {
    socket.emit("chat:history", await recentHistory());
  } catch (error) {
    console.error("[socket] chat:history failed:", errText(error));
    socket.emit("chat:error", {
      message: "Could not load earlier messages. Please try again.",
    });
  }
}

async function handleChatSend(socket, payload) {
  const user = socket.data.user;
  try {
    const content = readContent(payload);
    if (content === null) {
      socket.emit("chat:error", { message: "Message cannot be empty." });
      return;
    }
    if (content.length > MAX_CHAT_LENGTH) {
      socket.emit("chat:error", {
        message: `Message must be ${MAX_CHAT_LENGTH} characters or fewer.`,
      });
      return;
    }

    // Validation runs first so a rejected message never costs the sender part
    // of their allowance.
    const settings = await getSettings();
    const verdict = checkRateLimit(user.id, settings.chatRateLimitPerMin);
    if (!verdict.ok) {
      socket.emit("chat:error", {
        message: `You are sending messages too quickly. Try again in ${verdict.retryInSeconds}s.`,
      });
      return;
    }

    const pseudonym = settings.anonymousMode
      ? socket.data.pseudonym
      : user.name || socket.data.pseudonym;

    // The real userId is persisted for the admin chat log; the `select` then
    // hands back only the four public fields, so the identity cannot reach the
    // broadcast even by accident.
    const row = await prisma.chatMessage.create({
      data: { userId: user.id, pseudonym, content },
      select: CHAT_PUBLIC_FIELDS,
    });

    io.emit("chat:message", toPublicChatMessage(row));
  } catch (error) {
    console.error("[socket] chat:send failed:", errText(error));
    socket.emit("chat:error", {
      message: "Message could not be delivered. Please try again.",
    });
  }
}

async function handleDmSend(socket, payload) {
  const user = socket.data.user;
  try {
    const content = readContent(payload);
    if (content === null) {
      socket.emit("chat:error", { message: "Message cannot be empty." });
      return;
    }
    if (content.length > MAX_DM_LENGTH) {
      socket.emit("chat:error", {
        message: `Message must be ${MAX_DM_LENGTH} characters or fewer.`,
      });
      return;
    }

    // `threadId` is a User.id — the thread owner — not a matriculation number.
    // The schema keys DM threads by the student because students address the
    // Unit collectively and any admin may answer.
    let threadId;
    let studentName = user.name;

    if (user.role === "ADMIN") {
      const requested =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.studentId
          : undefined;
      if (typeof requested !== "string" || requested.trim().length === 0) {
        socket.emit("chat:error", {
          message: "Select a student before sending a reply.",
        });
        return;
      }
      threadId = requested.trim();

      // Confirms the target exists and is a student. Also rejects an admin
      // opening a thread keyed to another admin, which the schema allows but
      // the product does not.
      const student = await prisma.user.findUnique({
        where: { id: threadId },
        select: { name: true, role: true },
      });
      if (!student || student.role !== "STUDENT") {
        socket.emit("chat:error", { message: "Student not found." });
        return;
      }
      studentName = student.name;
    } else {
      // A student writes to their own thread, full stop. Any studentId in the
      // payload is ignored rather than validated, so there is no path — not
      // even a rejected one — for one student to post into another's thread.
      threadId = user.id;
    }

    const row = await prisma.directMessage.create({
      // Author and role come from the verified handshake, never the payload.
      data: {
        studentId: threadId,
        senderId: user.id,
        senderRole: user.role,
        content,
      },
      select: DM_FIELDS,
    });

    const message = toDmMessage(row);

    // Delivered to both sides, including the sender's own other tabs: the
    // student's room and the shared admin room. studentName is added only for
    // admins, who need it to label the thread in their inbox; the student
    // already knows whose conversation they are in.
    io.to(`user:${threadId}`).emit("dm:new", message);
    io.to("admins").emit("dm:new", { ...message, studentName });
  } catch (error) {
    console.error("[socket] dm:send failed:", errText(error));
    socket.emit("chat:error", {
      message: "Message could not be delivered. Please try again.",
    });
  }
}

/* ------------------------------------------------- complaint thread events */

const COMPLAINT_MESSAGE_FIELDS = {
  id: true,
  complaintId: true,
  senderRole: true,
  content: true,
  createdAt: true,
};

function toComplaintMessage(row) {
  return {
    id: row.id,
    complaintId: row.complaintId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Authorizes a complaint for this socket's user. Admins may open any thread;
 * a student only their own. Returns the complaint row or null — the caller
 * turns null into a quiet refusal, because "not yours" and "does not exist"
 * must not be distinguishable to a probing client.
 */
async function complaintForUser(user, complaintId) {
  if (typeof complaintId !== "string" || complaintId.trim().length === 0) {
    return null;
  }
  const where =
    user.role === "ADMIN"
      ? { id: complaintId }
      : { id: complaintId, userId: user.id };
  return prisma.complaint.findFirst({
    where,
    select: { id: true },
  });
}

async function handleComplaintJoin(socket, payload) {
  const user = socket.data.user;
  try {
    const complaintId =
      payload && typeof payload === "object" ? payload.complaintId : undefined;
    const complaint = await complaintForUser(user, complaintId);
    if (!complaint) {
      socket.emit("chat:error", { message: "Conversation not available." });
      return;
    }
    // join() is idempotent, so re-joining on every panel mount is free.
    await socket.join(`complaint:${complaint.id}`);
  } catch (error) {
    console.error("[socket] complaint:join failed:", errText(error));
  }
}

async function handleComplaintSend(socket, payload) {
  const user = socket.data.user;
  try {
    const complaintId =
      payload && typeof payload === "object" ? payload.complaintId : undefined;
    const content = readContent(payload);
    if (content === null) {
      socket.emit("chat:error", { message: "Message cannot be empty." });
      return;
    }
    if (content.length > MAX_THREAD_LENGTH) {
      socket.emit("chat:error", {
        message: `Message must be ${MAX_THREAD_LENGTH} characters or fewer.`,
      });
      return;
    }

    const complaint = await complaintForUser(user, complaintId);
    if (!complaint) {
      socket.emit("chat:error", { message: "Conversation not available." });
      return;
    }

    const row = await prisma.complaintMessage.create({
      data: {
        complaintId: complaint.id,
        senderId: user.id,
        senderRole: user.role,
        content,
      },
      select: COMPLAINT_MESSAGE_FIELDS,
    });
    await prisma.complaint.update({
      where: { id: complaint.id },
      data: { updatedAt: new Date() },
    });

    // The sender is in the room too and merges by id, so no separate echo.
    io.to(`complaint:${complaint.id}`).emit("complaint:new", toComplaintMessage(row));
  } catch (error) {
    console.error("[socket] complaint:send failed:", errText(error));
    socket.emit("chat:error", {
      message: "Message could not be delivered. Please try again.",
    });
  }
}

/* ------------------------------------------------------ live chat events */

const LIVE_MESSAGE_FIELDS = {
  id: true,
  conversationId: true,
  senderRole: true,
  content: true,
  createdAt: true,
};

function toLiveMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderRole: row.senderRole,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Creates the student's conversation if this is their first touch — the
 *  socket twin of ensureConversation in /api/livechat. */
async function ensureLiveConversation(userId) {
  const existing = await prisma.liveConversation.findUnique({
    where: { userId },
    select: { id: true, pseudonym: true, status: true },
  });
  if (existing) return existing;
  return prisma.liveConversation.create({
    data: { userId, pseudonym: `Anonymous #${10 + Math.floor(Math.random() * 990)}` },
    select: { id: true, pseudonym: true, status: true },
  });
}

async function handleLivechatJoin(socket, payload) {
  const user = socket.data.user;
  try {
    if (user.role === "ADMIN") {
      // An admin joins a specific conversation's room when they open it.
      const id =
        payload && typeof payload === "object" ? payload.conversationId : undefined;
      if (typeof id !== "string" || id.trim().length === 0) return;
      const conversation = await prisma.liveConversation.findUnique({
        where: { id },
        select: { id: true },
      });
      if (conversation) await socket.join(`live:${conversation.id}`);
      return;
    }

    // A student joins their own conversation — resolved BY their user id, so
    // a crafted payload has no conversation to point at.
    const conversation = await ensureLiveConversation(user.id);
    await socket.join(`live:${conversation.id}`);
    socket.emit("livechat:conversation", {
      id: conversation.id,
      pseudonym: conversation.pseudonym,
      status: conversation.status,
    });
  } catch (error) {
    console.error("[socket] livechat:join failed:", errText(error));
  }
}

async function handleLivechatSend(socket, payload) {
  const user = socket.data.user;
  try {
    const content = readContent(payload);
    if (content === null) {
      socket.emit("chat:error", { message: "Message cannot be empty." });
      return;
    }
    if (content.length > MAX_THREAD_LENGTH) {
      socket.emit("chat:error", {
        message: `Message must be ${MAX_THREAD_LENGTH} characters or fewer.`,
      });
      return;
    }

    const conversation = await ensureLiveConversation(user.id);
    if (conversation.status === "CLOSED") {
      await prisma.liveConversation.update({
        where: { id: conversation.id },
        data: { status: "OPEN" },
      });
    }

    const row = await prisma.liveMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        senderRole: "STUDENT",
        content,
      },
      select: LIVE_MESSAGE_FIELDS,
    });
    await prisma.liveConversation.update({
      where: { id: conversation.id },
      data: { adminUnread: { increment: 1 }, updatedAt: new Date() },
    });

    const message = toLiveMessage(row);
    io.to(`live:${conversation.id}`).emit("livechat:new", message);
    // The inbox bump lets every connected admin's badge move without a
    // refetch; admins not in the room still catch up over REST on open.
    io.to("admins").emit("livechat:inbox", {
      conversationId: conversation.id,
      lastMessage: message,
    });
  } catch (error) {
    console.error("[socket] livechat:send failed:", errText(error));
    socket.emit("chat:error", {
      message: "Message could not be delivered. Please try again.",
    });
  }
}

async function handleLivechatReply(socket, payload) {
  const user = socket.data.user;
  try {
    const conversationId =
      payload && typeof payload === "object" ? payload.conversationId : undefined;
    const content = readContent(payload);
    if (content === null) {
      socket.emit("chat:error", { message: "Message cannot be empty." });
      return;
    }
    if (content.length > MAX_THREAD_LENGTH) {
      socket.emit("chat:error", {
        message: `Message must be ${MAX_THREAD_LENGTH} characters or fewer.`,
      });
      return;
    }
    if (user.role !== "ADMIN" || typeof conversationId !== "string") {
      socket.emit("chat:error", { message: "Conversation not available." });
      return;
    }

    const conversation = await prisma.liveConversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      socket.emit("chat:error", { message: "Conversation not available." });
      return;
    }

    const row = await prisma.liveMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        senderRole: "ADMIN",
        content,
      },
      select: LIVE_MESSAGE_FIELDS,
    });
    await prisma.liveConversation.update({
      where: { id: conversation.id },
      data: { userUnread: { increment: 1 }, updatedAt: new Date() },
    });

    io.to(`live:${conversation.id}`).emit("livechat:new", toLiveMessage(row));
  } catch (error) {
    console.error("[socket] livechat:reply failed:", errText(error));
    socket.emit("chat:error", {
      message: "Message could not be delivered. Please try again.",
    });
  }
}

/* ---------------------------------------------------------------- connection */

io.on("connection", (socket) => {
  const user = socket.data.user;
  const isAdmin = user.role === "ADMIN";

  // Fixed for the life of this connection. Staff are labelled instead of
  // anonymised: a reply from the Unit that looked like "Anonymous #71" would
  // misrepresent who was speaking.
  socket.data.pseudonym = isAdmin ? STAFF_LABEL : claimPseudonym();

  // Every socket gets a personal room for DMs; admins share one for the inbox.
  socket.join(`user:${user.id}`);
  if (isAdmin) socket.join("admins");

  addPresence(user, socket.id);
  broadcastPresence();

  socket.on("chat:history:request", () => {
    void handleHistoryRequest(socket);
  });
  socket.on("chat:send", (payload) => {
    void handleChatSend(socket, payload);
  });
  socket.on("dm:send", (payload) => {
    void handleDmSend(socket, payload);
  });
  socket.on("complaint:join", (payload) => {
    void handleComplaintJoin(socket, payload);
  });
  socket.on("complaint:send", (payload) => {
    void handleComplaintSend(socket, payload);
  });
  socket.on("livechat:join", (payload) => {
    void handleLivechatJoin(socket, payload);
  });
  socket.on("livechat:send", (payload) => {
    void handleLivechatSend(socket, payload);
  });
  socket.on("livechat:reply", (payload) => {
    void handleLivechatReply(socket, payload);
  });

  // A transport-level error must not take the process with it.
  socket.on("error", (error) => {
    console.error(`[socket] socket error (${user.id}):`, errText(error));
  });

  socket.on("disconnect", () => {
    try {
      if (!isAdmin) releasePseudonym(socket.data.pseudonym);
      removePresence(user.id, socket.id);
      broadcastPresence();
    } catch (error) {
      console.error("[socket] disconnect cleanup failed:", errText(error));
    }
  });

  // Opening handshake payloads: who you are, and what has been said so far.
  void (async () => {
    try {
      socket.emit("session", { pseudonym: await displayNameFor(socket) });
      socket.emit("chat:history", await recentHistory());
    } catch (error) {
      console.error("[socket] connection bootstrap failed:", errText(error));
      socket.emit("chat:error", {
        message: "Could not load the chat room. Please refresh.",
      });
    }
  })();
});

/* ------------------------------------------------------------------- startup */

/** Host only — DATABASE_URL contains the password. */
function dbHost() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return `${url.hostname}:${url.port || "5432"}`;
  } catch {
    return "configured";
  }
}

httpServer.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(
      `  [socket] port ${PORT} is already in use. Another copy of the realtime\n` +
        "           server is probably running; stop it, or set SOCKET_PORT (and\n" +
        "           NEXT_PUBLIC_SOCKET_URL to match).",
    );
  } else {
    console.error("  [socket] server error:", errText(error));
  }
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log("");
  console.log("  UNILORIN SpeakUp — realtime server");
  console.log("  ----------------------------------------------------");
  console.log(`  socket.io    http://localhost:${PORT}`);
  console.log(`  health       http://localhost:${PORT}/health`);
  console.log(`  cors origin  ${ORIGIN}`);
  console.log(`  database     ${dbHost()}`);
  console.log(
    `  auth secret  ${
      process.env.NEXTAUTH_SECRET ? "NEXTAUTH_SECRET" : "insecure dev fallback"
    }`,
  );
  console.log("");
  console.log("  Waiting for connections. Ctrl-C to stop.");
  console.log("");
});

/* ------------------------------------------------------------------ shutdown */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n  [socket] ${signal} received, shutting down.`);
  clearInterval(pruneTimer);

  // A client stuck mid-frame must not hold the process open forever.
  const failsafe = setTimeout(() => {
    console.error("  [socket] shutdown timed out, exiting.");
    process.exit(1);
  }, 8_000);
  failsafe.unref();

  try {
    // Disconnects every client and closes the HTTP server it was attached to.
    await new Promise((done) => io.close(() => done()));
  } catch (error) {
    console.error("  [socket] error closing server:", errText(error));
  }

  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error("  [socket] error disconnecting prisma:", errText(error));
  }

  console.log("  [socket] stopped cleanly.");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Last resort. Every handler above is already wrapped, so reaching these means
// something escaped from a library callback. Logging and staying up is the
// right call for a chat server: dying would disconnect every student online,
// and no state here is unrecoverable.
process.on("unhandledRejection", (reason) => {
  console.error("  [socket] unhandled rejection:", errText(reason));
});
process.on("uncaughtException", (error) => {
  console.error("  [socket] uncaught exception:", errText(error));
});
