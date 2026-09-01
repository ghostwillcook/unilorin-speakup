/**
 * UNILORIN SpeakUp — database seed.
 *
 * Run with `npm run seed` (tsx). Two consequences of running outside Next shape
 * this whole file:
 *
 *   1. There is no `@/` module alias, so `@prisma/client` is imported directly
 *      rather than through lib/prisma.ts. The lazy Proxy in that module exists
 *      to keep the landing page renderable without a database; a seed has no
 *      use for it, since a missing DATABASE_URL is fatal here by definition.
 *   2. Nothing loads .env.local. Next does that for the web app and
 *      server/socket.mjs parses it by hand for the same reason; the parser
 *      below is the third, deliberately identical, copy.
 *
 * Every step is idempotent. Accounts are upserted on their unique email, and
 * the sample content (complaints, chat, live chat) is only written when
 * its table is empty — so `npm run seed` twice does not produce two of
 * everything. Live chat is the one nuance: the app itself creates
 * conversations, so the conversation row is upserted on its student and only
 * the messages inside it follow the "empty table" rule.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import type { Role, Status } from "@prisma/client";
import bcrypt from "bcryptjs";

/* ------------------------------------------------------------------ env load */

/**
 * Project root, found by walking up from the process CWD.
 *
 * `npm run seed` always executes with the CWD set to the package directory, so
 * the first check normally succeeds; the walk only matters when someone invokes
 * `npx tsx prisma/seed.ts` from a subdirectory.
 */
function findProjectRoot(): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = findProjectRoot();

/**
 * Minimal .env reader, matching server/socket.mjs line for line in behaviour.
 *
 * Real environment variables always win, so a deployment that injects config is
 * never overridden by a checked-out file. Values may be quoted; unquoted values
 * may carry a trailing `# comment`. Multi-line values are not supported —
 * nothing this app needs uses them.
 */
function loadEnvFile(filename: string): void {
  let raw: string;
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
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquote(body.slice(eq + 1).trim());
  }
}

function unquote(input: string): string {
  const quote = input.charAt(0);
  const isQuoted =
    input.length >= 2 && (quote === '"' || quote === "'") && input.endsWith(quote);

  if (isQuoted) {
    const inner = input.slice(1, -1);
    // Only double quotes get escape expansion, matching dotenv. A `#` inside
    // quotes is data — Postgres passwords legitimately contain one.
    return quote === '"'
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
      : inner;
  }

  const comment = input.indexOf(" #");
  return (comment === -1 ? input : input.slice(0, comment)).trim();
}

// .env.local first: it is the file the README tells people to create, and the
// `!== undefined` guard above means whichever is read first wins.
loadEnvFile(".env.local");
loadEnvFile(".env");

/* --------------------------------------------------------------- preflight */

if (!process.env.DATABASE_URL) {
  console.error(
    [
      "",
      "  Cannot seed: DATABASE_URL is not set.",
      "",
      "  Copy .env.local.example to .env.local, fill in your Supabase",
      "  connection strings, then run:",
      "",
      "      npx prisma migrate dev",
      "      npm run seed",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// prisma/schema.prisma declares `directUrl = env("DIRECT_URL")` for migrations.
// The query engine does not need it, but validation reads the whole datasource
// block, so mirroring the pooled URL here keeps a DIRECT_URL-less .env.local
// from failing at client construction. Process-local only; nothing is written.
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const ADMIN_EMAIL = (
  process.env.SEED_ADMIN_EMAIL || "studentaffairs@unilorin.edu.ng"
)
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
const STUDENT_PASSWORD = process.env.SEED_STUDENT_PASSWORD || "Student123!";

/** Cost factor for bcryptjs. lib/auth.ts only ever compares, so this is the
 *  single place the work factor is chosen. */
const BCRYPT_ROUNDS = 10;

/** Matches STAFF_LABEL in server/socket.mjs: staff are labelled in the global
 *  room rather than anonymised. */
const STAFF_LABEL = "Student Affairs";

const prisma = new PrismaClient({ log: ["error"] });

/* ------------------------------------------------------------- seed content */

interface SeedAccount {
  name: string;
  email: string;
  studentId: string;
  role: Role;
  password: string;
}

const ACCOUNTS: SeedAccount[] = [
  {
    name: "Student Affairs Unit",
    email: ADMIN_EMAIL,
    studentId: "ADMIN001",
    role: "ADMIN",
    password: ADMIN_PASSWORD,
  },
  {
    name: "Aisha Bello",
    email: "aisha.bello@students.unilorin.edu.ng",
    studentId: "19/52HA001",
    role: "STUDENT",
    password: STUDENT_PASSWORD,
  },
  {
    name: "Chinedu Okwuosa",
    email: "chinedu.okwuosa@students.unilorin.edu.ng",
    studentId: "20/52HA138",
    role: "STUDENT",
    password: STUDENT_PASSWORD,
  },
  {
    name: "Yetunde Adeyemi",
    email: "yetunde.adeyemi@students.unilorin.edu.ng",
    studentId: "21/52HL072",
    role: "STUDENT",
    password: STUDENT_PASSWORD,
  },
];

const [ADMIN_ACCOUNT, AISHA, CHINEDU, YETUNDE] = ACCOUNTS;

interface ComplaintSeed {
  authorEmail: string;
  title: string;
  description: string;
  status: Status;
  adminReply?: string;
  /** Age of the submission, so the admin dashboard's "8 newest" list has a
   *  believable spread instead of eight identical timestamps. */
  hoursAgo: number;
  /** Age of the reply. Omitted means never touched since submission. */
  repliedHoursAgo?: number;
}

// `files` is left empty on every row on purpose: the column holds public
// Supabase Storage URLs, and a seeded URL would point at an object that does
// not exist, rendering an attachment chip that 404s.
const COMPLAINTS: ComplaintSeed[] = [
  {
    authorEmail: AISHA.email,
    title: "No water supply in Amina Hostel Block C",
    description:
      "Block C has had no running water since Sunday evening. The overhead tank " +
      "is not being filled and the ground floor taps are completely dry, so we " +
      "are buying kegs from vendors at the gate. Over sixty rooms are affected.",
    status: "PENDING",
    hoursAgo: 20,
  },
  {
    authorEmail: AISHA.email,
    title: "Loose ceiling fan in Amina Hostel Block C, Room 214",
    description:
      "The ceiling fan in Room 214 wobbles badly and the mounting rod has " +
      "visibly pulled away from the concrete. We have stopped using it because " +
      "we are afraid it will come down while someone is asleep underneath.",
    status: "IN_REVIEW",
    hoursAgo: 7 * 24 + 5,
  },
  {
    authorEmail: CHINEDU.email,
    title: "GNS 111 result missing from the student portal",
    description:
      "My GNS 111 grade has been blank on the portal since results were " +
      "released, although I wrote the paper and my seat number was signed " +
      "against the attendance list. This is holding up my CGPA computation.",
    status: "RESOLVED",
    adminReply:
      "The Directorate of Academic Planning has re-uploaded the affected GNS " +
      "111 batch and your grade now appears on the portal. Please confirm and " +
      "reopen this ticket if anything else is still missing.",
    hoursAgo: 21 * 24,
    repliedHoursAgo: 18 * 24,
  },
  {
    authorEmail: CHINEDU.email,
    title: "Request to extend hostel checkout by two weeks",
    description:
      "My final year project defence falls after the published hostel " +
      "checkout date and travelling home in between is not realistic for me. " +
      "I am requesting a two week extension on my bed space.",
    status: "REJECTED",
    adminReply:
      "Hostel occupancy is governed by Senate-approved dates and cannot be " +
      "extended for an individual. Please see your Hostel Warden about the " +
      "short-stay arrangement available to graduating students.",
    hoursAgo: 15 * 24,
    repliedHoursAgo: 13 * 24 + 4,
  },
  {
    authorEmail: YETUNDE.email,
    title: "Overcharging by shuttle operators at the main gate",
    description:
      "Shuttle operators at the main gate have been charging well above the " +
      "approved fare during the evening rush and refusing to carry students " +
      "who insist on the posted rate. The fare board is also no longer displayed.",
    status: "IN_REVIEW",
    hoursAgo: 4 * 24 + 9,
  },
  {
    authorEmail: YETUNDE.email,
    title: "Broken sockets in Lecture Theatre A, Faculty of Physical Sciences",
    description:
      "Three of the wall sockets in Lecture Theatre A are hanging out of their " +
      "housings with the wiring exposed, and one sparked during a lecture " +
      "yesterday. Nobody can safely charge a laptop in that hall.",
    status: "PENDING",
    hoursAgo: 3,
  },
];

interface ChatSeed {
  /** Real author. Persisted for the admin chat log and never sent to a student
   *  client — see the `select` in server/socket.mjs. */
  authorEmail: string;
  pseudonym: string;
  content: string;
  minutesAgo: number;
}

// Pseudonyms are stable per author within this batch, the way a real session's
// pseudonym is fixed for the life of one connection.
const CHAT: ChatSeed[] = [
  {
    authorEmail: AISHA.email,
    pseudonym: "Anonymous #42",
    content:
      "Has anyone else lost water in Amina Hostel since Sunday? Block C has been dry for three days.",
    minutesAgo: 48,
  },
  {
    authorEmail: CHINEDU.email,
    pseudonym: "Anonymous #17",
    content: "Same in Block A. The overhead tank is not being filled at all.",
    minutesAgo: 44,
  },
  {
    authorEmail: YETUNDE.email,
    pseudonym: "Anonymous #88",
    content: "I have been buying from the vendors at the gate. Two hundred naira a keg now.",
    minutesAgo: 41,
  },
  {
    authorEmail: ADMIN_ACCOUNT.email,
    pseudonym: STAFF_LABEL,
    content:
      "Good evening all. The Works Unit is aware of the Amina Hostel supply issue and a replacement pump is being fitted today. Please also file it as a complaint so we can track it formally.",
    minutesAgo: 36,
  },
  {
    authorEmail: AISHA.email,
    pseudonym: "Anonymous #42",
    content: "Thank you, I have submitted one already.",
    minutesAgo: 33,
  },
  {
    authorEmail: CHINEDU.email,
    pseudonym: "Anonymous #17",
    content: "Is the portal down for anyone else? I still cannot see my GNS 111 result.",
    minutesAgo: 29,
  },
  {
    authorEmail: ADMIN_ACCOUNT.email,
    pseudonym: STAFF_LABEL,
    content:
      "The portal is under scheduled maintenance until 6pm. Any result still missing after that should be reported to your level adviser.",
    minutesAgo: 24,
  },
  {
    authorEmail: YETUNDE.email,
    pseudonym: "Anonymous #88",
    content: "Noted, thank you.",
    minutesAgo: 19,
  },
];

interface ExchangeSeed {
  from: Role;
  content: string;
  minutesAgo: number;
  /** False on the last student message, so the admin inbox demonstrates a
   *  non-zero unread badge. */
  read: boolean;
}

/**
 * Live Chat is one persistent conversation per student, so this thread is
 * Aisha's — the only student whose Live Chat the demo needs. It stays on the
 * hostel water story already told by her complaint and the global room, then
 * carries the old DM thread's follow-up (the Room 214 fan and the sparking
 * socket), so the three views read as one ongoing incident. A back-and-forth
 * keyed by role, with the last student message left unread.
 */
const LIVE_CHAT: ExchangeSeed[] = [
  {
    from: "STUDENT",
    content: "Hello, is anyone attending to the water problem in Amina Hostel?",
    minutesAgo: 3 * 60 + 30,
    read: true,
  },
  {
    from: "STUDENT",
    content:
      "I filed a complaint about Block C last week and the taps have been dry since Sunday.",
    minutesAgo: 3 * 60 + 28,
    read: true,
  },
  {
    from: "ADMIN",
    content:
      "Good afternoon. Yes — your complaint is with the Works Unit. The Block C tank is being refilled today and a replacement pump is on order.",
    minutesAgo: 3 * 60 + 5,
    read: true,
  },
  {
    from: "STUDENT",
    content:
      "Thank you. The water came on briefly this afternoon and went off again after a few minutes. Should I update the complaint?",
    minutesAgo: 55,
    read: true,
  },
  {
    from: "ADMIN",
    content:
      "No need — the pump order already covers it. Please mention any other faults in this conversation and we will add them to the same Works Unit visit.",
    minutesAgo: 45,
    read: true,
  },
  {
    from: "STUDENT",
    content:
      "In that case: the ceiling fan in Room 214 is still loose, and the socket by the window sparks when I plug in my laptop charger.",
    minutesAgo: 38,
    read: true,
  },
  {
    from: "ADMIN",
    content:
      "Noted. The Works Unit technician is coming Thursday morning for the fan and will inspect the socket in the same visit. Please leave your key with your hostel porter and we will collect it.",
    minutesAgo: 20,
    read: true,
  },
  {
    from: "STUDENT",
    content: "Understood, I will drop the key with the porter on Wednesday evening. Thank you.",
    minutesAgo: 9,
    read: false,
  },
];

/* -------------------------------------------------------------------- seeding */

const NOW = Date.now();
const minutesAgo = (m: number): Date => new Date(NOW - m * 60_000);
const hoursAgo = (h: number): Date => new Date(NOW - h * 3_600_000);

interface SeededUser {
  id: string;
  name: string;
  email: string;
  studentId: string;
  role: Role;
}

/**
 * Upserts one account on its unique email.
 *
 * The password hash is rewritten on every run so the credentials printed at the
 * end are always true. `studentId` is unique too, so a row already holding this
 * ID under a different email is reported rather than silently mutated — the
 * usual cause is SEED_ADMIN_EMAIL changing between runs while "ADMIN001" stays
 * claimed by the previous admin.
 */
async function upsertAccount(account: SeedAccount): Promise<SeededUser> {
  const idHolder = await prisma.user.findUnique({
    where: { studentId: account.studentId },
    select: { email: true },
  });

  if (idHolder && idHolder.email !== account.email) {
    throw new Error(
      `Student ID "${account.studentId}" is already held by ${idHolder.email}, ` +
        `but the seed wants to give it to ${account.email}. Either seed with ` +
        `the existing email or delete that account first.`,
    );
  }

  const passwordHash = await bcrypt.hash(account.password, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: account.email },
    update: {
      name: account.name,
      studentId: account.studentId,
      role: account.role,
      isActive: true,
      passwordHash,
    },
    create: {
      email: account.email,
      name: account.name,
      studentId: account.studentId,
      role: account.role,
      isActive: true,
      passwordHash,
    },
    select: { id: true, name: true, email: true, studentId: true, role: true },
  });

  return user;
}

async function seedAccounts(): Promise<Map<string, SeededUser>> {
  const byEmail = new Map<string, SeededUser>();

  for (const account of ACCOUNTS) {
    const user = await upsertAccount(account);
    byEmail.set(user.email, user);
    console.log(`  upserted ${user.role.padEnd(7)} ${user.email}`);
  }
  return byEmail;
}

function requireUser(users: Map<string, SeededUser>, email: string): SeededUser {
  const user = users.get(email);
  if (!user) throw new Error(`Seed account ${email} was not created.`);
  return user;
}

async function seedComplaints(users: Map<string, SeededUser>): Promise<number> {
  const existing = await prisma.complaint.count();
  if (existing > 0) {
    console.log(`  complaints    skipped (${existing} already present)`);
    return 0;
  }

  const { count } = await prisma.complaint.createMany({
    data: COMPLAINTS.map((c) => {
      const createdAt = hoursAgo(c.hoursAgo);
      return {
        userId: requireUser(users, c.authorEmail).id,
        title: c.title,
        description: c.description,
        status: c.status,
        adminReply: c.adminReply ?? null,
        files: [],
        createdAt,
        // A reply is the only thing that moves updatedAt off createdAt here.
        updatedAt:
          c.repliedHoursAgo === undefined ? createdAt : hoursAgo(c.repliedHoursAgo),
      };
    }),
  });

  console.log(`  complaints    created ${count}`);
  return count;
}

async function seedChat(users: Map<string, SeededUser>): Promise<number> {
  const existing = await prisma.chatMessage.count();
  if (existing > 0) {
    console.log(`  chat messages skipped (${existing} already present)`);
    return 0;
  }

  const { count } = await prisma.chatMessage.createMany({
    data: CHAT.map((m) => ({
      userId: requireUser(users, m.authorEmail).id,
      pseudonym: m.pseudonym,
      content: m.content,
      timestamp: minutesAgo(m.minutesAgo),
    })),
  });

  console.log(`  chat messages created ${count}`);
  return count;
}

/**
 * Ensures Aisha has a Live Chat conversation and seeds its first exchange.
 *
 * The conversation itself is upserted with an empty update: E2E test runs
 * create real conversations under random pseudonyms, and such a row is live
 * app state (pseudonym, status, unread counters), not seed content. Only when
 * no conversation exists is one created — as "Anonymous #42" so the demo
 * matches both the landing page copy and Aisha's pseudonym in the global room
 * history. The messages follow the usual rule instead: written only when the
 * conversation holds none, which also covers the E2E case of a conversation
 * that exists but is empty.
 */
async function seedLiveChat(users: Map<string, SeededUser>): Promise<number> {
  const student = requireUser(users, AISHA.email);
  const admin = requireUser(users, ADMIN_ACCOUNT.email);

  const conversation = await prisma.liveConversation.upsert({
    where: { userId: student.id },
    update: {},
    create: {
      userId: student.id,
      pseudonym: "Anonymous #42",
      status: "OPEN",
    },
    select: { id: true },
  });

  const existing = await prisma.liveMessage.count({
    where: { conversationId: conversation.id },
  });
  if (existing > 0) {
    console.log(`  live messages skipped (${existing} already present)`);
    return 0;
  }

  const { count } = await prisma.liveMessage.createMany({
    data: LIVE_CHAT.map((m) => ({
      conversationId: conversation.id,
      senderId: m.from === "ADMIN" ? admin.id : student.id,
      senderRole: m.from,
      content: m.content,
      // Read a minute after arrival, so the unread count is the interesting
      // number rather than the timestamps.
      readAt: m.read ? minutesAgo(Math.max(m.minutesAgo - 1, 0)) : null,
      createdAt: minutesAgo(m.minutesAgo),
    })),
  });

  // The last seeded student message is unread; adminUnread is the counter the
  // admin inbox renders its badge from, so it is set rather than incremented —
  // the messages were just created, so the seed knows the true total is 1.
  await prisma.liveConversation.update({
    where: { id: conversation.id },
    data: { adminUnread: 1 },
  });

  console.log(`  live messages created ${count}`);
  return count;
}

/**
 * Ensures both Setting rows exist at their defaults.
 *
 * The update side is intentionally empty: an admin who has already tuned the
 * chat rate limit in /admin/settings should not have it silently reset by a
 * re-run. Defaults are duplicated from DEFAULT_SETTINGS in lib/settings.ts,
 * which tsx cannot import through the `@/` alias.
 */
async function seedSettings(): Promise<void> {
  const defaults: Array<[string, string]> = [
    ["anonymousMode", "true"],
    ["chatRateLimitPerMin", "20"],
    ["complaintSubmissionLimit", "0"],
  ];

  for (const [key, value] of defaults) {
    const row = await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
    const state = row.value === value ? "default" : `kept "${row.value}"`;
    console.log(`  setting       ${key} = ${row.value} (${state})`);
  }
}

/* -------------------------------------------------------------------- output */

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i].length)),
  );
  const rule = `  +${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  const render = (cells: string[]): string =>
    `  |${cells.map((cell, i) => ` ${cell.padEnd(widths[i])} `).join("|")}|`;

  console.log(rule);
  console.log(render(headers));
  console.log(rule);
  for (const row of rows) console.log(render(row));
  console.log(rule);
}

/** The passwords that ship in .env.local.example and the README. A seed run that
 *  still uses either of them is publishing its own credentials, which is worth
 *  shouting about; one that does not should not be told it is. */
const PUBLIC_DEFAULTS = new Set(["ChangeMe123!", "Student123!"]);

function printCredentials(): void {
  console.log("\n  Seeded accounts\n");

  printTable(
    ["Role", "Email", "Student ID", "Password"],
    ACCOUNTS.map((a) => [a.role, a.email, a.studentId, a.password]),
  );

  const usingDefaults = ACCOUNTS.some((a) => PUBLIC_DEFAULTS.has(a.password));

  if (!usingDefaults) {
    console.log(
      [
        "",
        "  Passwords above are the values set in .env.local, not the shipped",
        "  defaults. They are still PLAINTEXT in that file and in this output:",
        "  keep .env.local out of git (it is gitignored) and clear your scrollback",
        "  if you ran this anywhere shared.",
        "",
      ].join("\n"),
    );
    return;
  }

  console.log(
    [
      "",
      "  ***********************************************************************",
      "  *  WARNING: the passwords above are PLAINTEXT DEVELOPMENT DEFAULTS.   *",
      "  *                                                                    *",
      "  *  They are printed so you can sign in locally, and they are already  *",
      "  *  public: they live in .env.local.example and in this repository's   *",
      "  *  README. Anyone who can reach your deployment can read them too.    *",
      "  *                                                                    *",
      "  *  Before ANY real deployment:                                        *",
      "  *    1. Set SEED_ADMIN_PASSWORD and SEED_STUDENT_PASSWORD to strong,  *",
      "  *       unique values in .env.local (never commit that file).         *",
      "  *    2. Re-run `npm run seed` so the hashes are replaced.             *",
      "  *    3. Delete or deactivate the sample student accounts from         *",
      "  *       /admin/users.                                                 *",
      "  ***********************************************************************",
      "",
    ].join("\n"),
  );
}

/* ---------------------------------------------------------------------- main */

async function main(): Promise<void> {
  console.log("\n  UNILORIN SpeakUp — seeding database\n");

  const users = await seedAccounts();

  console.log("");
  await seedComplaints(users);
  await seedChat(users);
  await seedLiveChat(users);
  await seedSettings();

  printCredentials();

  const [complaints, chat, live, students] = await Promise.all([
    prisma.complaint.count(),
    prisma.chatMessage.count(),
    prisma.liveMessage.count(),
    prisma.user.count({ where: { role: "STUDENT" } }),
  ]);

  console.log(
    `  Database now holds ${students} student account(s), ${complaints} ` +
      `complaint(s), ${chat} chat message(s) and ` +
      `${live} live chat message(s).\n`,
  );
  console.log("  Sign in at http://localhost:3000/auth/signin\n");
}

main()
  .catch((error: unknown) => {
    console.error("\n  Seed failed.\n");
    console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect())
  .catch(() => {
    // A failing disconnect is not worth a second report, but it should still
    // fail the command rather than exit 0.
    process.exitCode = 1;
  });
