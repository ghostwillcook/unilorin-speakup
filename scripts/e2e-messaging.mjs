/**
 * E2E acceptance test for the messaging overhaul, run against a local
 * `next dev`. Exercises the spec's acceptance flows at the API level:
 *
 *   1. Complaint → dedicated thread → admin replies → student sees it
 *   2. Thread isolation (student B cannot read student A's thread)
 *   3. Live Chat: student message → admin inbox → admin reply → student
 *      re-fetch (the "refresh" persistence test)
 *   4. User lookup by anonymous ID and by matric number
 *   5. Authorization: student blocked from admin endpoints
 *
 * Credentials come from the environment — E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
 * / E2E_STUDENT_EMAIL / E2E_STUDENT_PASSWORD / E2E_STUDENT2_EMAIL /
 * E2E_STUDENT2_PASSWORD — falling back to .env.local's SEED_* values, the
 * same ones `npm run seed` writes. Never hardcoded: these are live passwords
 * and this file is tracked.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3313";

function envFromFile(key) {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
    if (!match) continue;
    let value = match[1].trim();
    if (
      value.length >= 2 &&
      (value.startsWith('"') || value.startsWith("'")) &&
      value.endsWith(value.charAt(0))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function credential(key, fallback) {
  return process.env[key] ?? envFromFile(fallback);
}

const ADMIN = {
  email:
    credential("E2E_ADMIN_EMAIL", "SEED_ADMIN_EMAIL") ??
    "studentaffairs@unilorin.edu.ng",
  password: credential("E2E_ADMIN_PASSWORD", "SEED_ADMIN_PASSWORD"),
};
const STUDENT_A = {
  email:
    credential("E2E_STUDENT_EMAIL", "STUDENT_A_EMAIL") ??
    "aisha.bello@students.unilorin.edu.ng",
  password: credential("E2E_STUDENT_PASSWORD", "SEED_STUDENT_PASSWORD"),
  // Matric numbers are demo data already public in prisma/seed.ts.
  studentId: "19/52HA001",
};
const STUDENT_B = {
  email:
    credential("E2E_STUDENT2_EMAIL", "STUDENT_B_EMAIL") ??
    "chinedu.okwuosa@students.unilorin.edu.ng",
  password: credential("E2E_STUDENT2_PASSWORD", "SEED_STUDENT_PASSWORD"),
  studentId: "20/52HA138",
};

if (!ADMIN.password || !STUDENT_A.password) {
  console.error(
    "Cannot run E2E: no credentials. Set E2E_ADMIN_PASSWORD / E2E_STUDENT_PASSWORD\n" +
      "or SEED_ADMIN_PASSWORD / SEED_STUDENT_PASSWORD in .env.local.",
  );
  process.exit(1);
}

/** Minimal cookie jar: parses set-cookie headers, sends them back. */
function jar() {
  const store = new Map();
  return {
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    absorb(res) {
      const raw =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [];
      for (const cookie of raw) {
        const [pair] = cookie.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) store.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    },
  };
}

async function call(cookies, path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Cookie: cookies.header(),
      ...(options.headers ?? {}),
    },
    redirect: "manual",
  });
  cookies.absorb(res);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

/** Signs in with the credentials flow and returns the jar. */
async function signIn(creds) {
  const cookies = jar();
  const csrf = await call(cookies, "/api/auth/csrf");
  const token = csrf.body?.csrfToken;
  if (!token) throw new Error("no csrf token");

  const res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies.header(),
    },
    body: new URLSearchParams({
      csrfToken: token,
      email: creds.email,
      password: creds.password,
      studentId: creds.studentId ?? "",
    }),
    redirect: "manual",
  });
  cookies.absorb(res);
  return cookies;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("signing in three sessions…");
  const admin = await signIn(ADMIN);
  const aisha = await signIn(STUDENT_A);
  const chinedu = await signIn(STUDENT_B);

  const session = await call(aisha, "/api/auth/session");
  check("student A signed in", session.body?.user?.email === STUDENT_A.email);

  /* ---------------- 1. complaint → thread ---------------- */

  const created = await call(aisha, "/api/complaints", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E: thread test",
      description: "Automated acceptance test for the complaint thread.",
    }),
  });
  const complaintId = created.body?.complaint?.id;
  check("complaint created", created.status === 201 && Boolean(complaintId));

  const emptyThread = await call(
    aisha,
    `/api/complaints/${complaintId}/messages`,
  );
  check("new thread starts empty", emptyThread.body?.messages?.length === 0);

  const studentMsg = await call(aisha, `/api/complaints/${complaintId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Hello from the student side." }),
  });
  check(
    "student writes into thread",
    studentMsg.status === 201 && studentMsg.body?.message?.senderRole === "STUDENT",
  );

  const adminMsg = await call(admin, `/api/complaints/${complaintId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Hello from the Unit." }),
  });
  check(
    "admin replies into thread",
    adminMsg.status === 201 && adminMsg.body?.message?.senderRole === "ADMIN",
  );

  const threadAfter = await call(
    aisha,
    `/api/complaints/${complaintId}/messages`,
  );
  check(
    "student sees full thread (2 messages, ordered)",
    threadAfter.body?.messages?.length === 2 &&
      threadAfter.body.messages[0]?.content === "Hello from the student side." &&
      threadAfter.body.messages[1]?.content === "Hello from the Unit.",
  );

  const listAfter = await call(aisha, "/api/complaints");
  const listed = (listAfter.body?.complaints ?? []).find(
    (c) => c.id === complaintId,
  );
  check(
    "My Complaints list shows last message + unread cleared on read",
    listed?.lastMessage?.content === "Hello from the Unit." &&
      listed?.unread === 0,
  );

  /* ---------------- 2. isolation ---------------- */

  const foreign = await call(
    chinedu,
    `/api/complaints/${complaintId}/messages`,
  );
  check(
    "student B cannot read student A's thread",
    foreign.status === 404,
    `got ${foreign.status}`,
  );

  const foreignPost = await call(
    chinedu,
    `/api/complaints/${complaintId}/messages`,
    { method: "POST", body: JSON.stringify({ content: "intrusion" }) },
  );
  check(
    "student B cannot write into student A's thread",
    foreignPost.status === 404,
    `got ${foreignPost.status}`,
  );

  const badId = await call(aisha, "/api/complaints/does-not-exist/messages");
  check("invalid complaint id → 404", badId.status === 404);

  /* ---------------- 3. live chat ---------------- */

  const lc1 = await call(aisha, "/api/livechat", {
    method: "POST",
    body: JSON.stringify({ content: "Hello, I need help." }),
  });
  check(
    "student livechat send (REST)",
    lc1.status === 201 && lc1.body?.message?.content === "Hello, I need help.",
  );

  const inbox = await call(admin, "/api/admin/livechat");
  const conv = (inbox.body?.conversations ?? []).find(
    (c) => c.student?.studentId === STUDENT_A.studentId,
  );
  check(
    "admin inbox shows the conversation, unread=1, pseudonym present",
    Boolean(conv) && conv.adminUnread >= 1 && conv.pseudonym.startsWith("Anonymous #"),
  );

  const opened = await call(admin, `/api/admin/livechat/${conv.id}`);
  check(
    "admin opens thread; unread clears; message visible",
    opened.body?.messages?.some((m) => m.content === "Hello, I need help."),
    `messages=${opened.body?.messages?.length}`,
  );

  const reply = await call(admin, `/api/admin/livechat/${conv.id}`, {
    method: "POST",
    body: JSON.stringify({ content: "Hello, how can we help?" }),
  });
  check("admin livechat reply", reply.status === 201);

  const lcAfter = await call(aisha, "/api/livechat");
  check(
    "student re-fetch (the refresh test): both messages persist",
    lcAfter.body?.messages?.some((m) => m.content === "Hello, I need help.") &&
      lcAfter.body?.messages?.some((m) => m.content === "Hello, how can we help?"),
  );

  /* ---------------- 4. lookup ---------------- */

  const byPseudonym = await call(
    admin,
    `/api/admin/users/lookup?identifier=${encodeURIComponent(conv.pseudonym)}`,
  );
  check(
    "lookup by anonymous ID",
    byPseudonym.body?.user?.studentId === STUDENT_A.studentId,
  );

  const byMatric = await call(
    admin,
    `/api/admin/users/lookup?identifier=${encodeURIComponent(STUDENT_B.studentId)}`,
  );
  check(
    "lookup by matric number",
    byMatric.body?.user?.studentId === STUDENT_B.studentId,
  );

  const notFound = await call(
    admin,
    "/api/admin/users/lookup?identifier=Anonymous%20%23999",
  );
  check(
    "lookup miss → spec copy",
    notFound.status === 404 &&
      notFound.body?.error?.startsWith("User not found."),
  );

  /* ---------------- 5. authorization ---------------- */

  const adminRouteAsStudent = await call(aisha, "/api/admin/livechat");
  check(
    "student blocked from admin inbox",
    adminRouteAsStudent.status === 403,
    `got ${adminRouteAsStudent.status}`,
  );

  const adminThreadAsStudent = await call(
    aisha,
    `/api/admin/livechat/${conv.id}`,
    { method: "POST", body: JSON.stringify({ content: "intrusion" }) },
  );
  check(
    "student cannot reply via admin route",
    adminThreadAsStudent.status === 403,
    `got ${adminThreadAsStudent.status}`,
  );

  /* ---------------- 6. merge: DM routes gone, merged channel serves all ---- */

  const dmGone = await call(aisha, "/api/dm");
  check(
    "DM routes retired (404, channel merged into /api/livechat)",
    dmGone.status === 404,
    `got ${dmGone.status}`,
  );

  /* ---------------- 7. message deletion ---------------- */

  // Student deletes their own message from the complaint thread.
  const ownForDelete = await call(aisha, `/api/complaints/${complaintId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "delete me please" }),
  });
  const deletableId = ownForDelete.body?.message?.id;
  const del = await call(
    aisha,
    `/api/complaints/${complaintId}/messages/${deletableId}`,
    { method: "DELETE" },
  );
  check("student deletes own thread message", del.status === 200, `got ${del.status}`);

  const afterDelete = await call(aisha, `/api/complaints/${complaintId}/messages`);
  check(
    "deleted message gone from the thread",
    !(afterDelete.body?.messages ?? []).some((m) => m.id === deletableId),
  );

  // Admin deletes a student message from the merged conversation.
  const adminDelete = await call(
    admin,
    `/api/livechat/messages/${lc1.body?.message?.id}`,
    { method: "DELETE" },
  );
  check(
    "admin deletes any livechat message (moderation)",
    adminDelete.status === 200,
    `got ${adminDelete.status}`,
  );
  const lcAfterDelete = await call(aisha, "/api/livechat");
  check(
    "admin-deleted message gone for the student too",
    !(lcAfterDelete.body?.messages ?? []).some((m) => m.id === lc1.body?.message?.id),
  );

  // Student CANNOT delete someone else's (the admin's) message.
  const adminMsgId = reply.body?.message?.id;
  const foreignDelete = await call(aisha, `/api/livechat/messages/${adminMsgId}`, {
    method: "DELETE",
  });
  check(
    "student cannot delete the Unit's message",
    foreignDelete.status === 404,
    `got ${foreignDelete.status}`,
  );

  /* ---------------- 8. notifications ---------------- */

  const notifSend = await call(admin, "/api/admin/notifications", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E test notice",
      body: "Automated acceptance check.",
    }),
  });
  check(
    "admin broadcasts a notification",
    notifSend.status === 201 && notifSend.body?.count >= 2,
    `status=${notifSend.status} count=${notifSend.body?.count}`,
  );

  const notifRead = await call(aisha, "/api/notifications");
  check(
    "student receives the notification (unread)",
    (notifRead.body?.notifications ?? []).some(
      (n) => n.title === "E2E test notice",
    ) && notifRead.body?.unread >= 1,
    `unread=${notifRead.body?.unread}`,
  );

  const markRead = await call(aisha, "/api/notifications/read", { method: "POST" });
  const notifAfter = await call(aisha, "/api/notifications");
  check(
    "mark-all-read clears the badge",
    markRead.status === 200 && notifAfter.body?.unread === 0,
    `unread=${notifAfter.body?.unread}`,
  );

  const notifAsStudent = await call(aisha, "/api/admin/notifications", {
    method: "POST",
    body: JSON.stringify({ title: "x", body: "y" }),
  });
  check(
    "student cannot send notifications",
    notifAsStudent.status === 403,
    `got ${notifAsStudent.status}`,
  );

  /* ---------------- 9. settings + complaint submission limit ---------------- */

  // The settings object is admin-only; complaintSubmissionLimit gates how
  // many OPEN (PENDING / IN_REVIEW) complaints a student may have, 0 = no cap.
  const settingsBefore = await call(admin, "/api/settings");
  check(
    "settings expose complaintSubmissionLimit (default 0 = unlimited)",
    settingsBefore.body?.settings?.complaintSubmissionLimit === 0,
    `value=${settingsBefore.body?.settings?.complaintSubmissionLimit}`,
  );

  const setLimit = await call(admin, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({ complaintSubmissionLimit: 1 }),
  });
  check(
    "admin sets complaintSubmissionLimit=1",
    setLimit.status === 200 &&
      setLimit.body?.settings?.complaintSubmissionLimit === 1,
    `status=${setLimit.status} value=${setLimit.body?.settings?.complaintSubmissionLimit}`,
  );

  // The complaint created in section 1 is still PENDING, so student A already
  // has 1 open complaint — the next submission must be rejected with 429.
  const overLimit = await call(aisha, "/api/complaints", {
    method: "POST",
    body: JSON.stringify({
      title: "E2E: over the limit",
      description: "Should be rejected while an open complaint exists.",
    }),
  });
  check(
    "complaint over the limit rejected with 429",
    overLimit.status === 429,
    `got ${overLimit.status}`,
  );
  check(
    "429 copy mentions complaints under review",
    typeof overLimit.body?.error === "string" &&
      overLimit.body.error.includes("under review"),
    JSON.stringify(overLimit.body?.error ?? overLimit.body).slice(0, 120),
  );

  const badLimit = await call(admin, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({ complaintSubmissionLimit: -1 }),
  });
  check(
    "negative limit rejected with 400",
    badLimit.status === 400,
    `got ${badLimit.status}`,
  );

  const resetLimit = await call(admin, "/api/settings", {
    method: "PUT",
    body: JSON.stringify({ complaintSubmissionLimit: 0 }),
  });
  check(
    "limit reset to unlimited for later runs",
    resetLimit.status === 200 &&
      resetLimit.body?.settings?.complaintSubmissionLimit === 0,
    `status=${resetLimit.status} value=${resetLimit.body?.settings?.complaintSubmissionLimit}`,
  );

  /* ---------------- 10. welcome page sign-off ---------------- */

  // /welcome is public — a plain fetch is enough, no session needed.
  const welcomeRes = await fetch(BASE + "/welcome", { redirect: "manual" });
  const welcomeHtml = await welcomeRes.text();
  check(
    "welcome page renders",
    welcomeRes.status === 200,
    `got ${welcomeRes.status}`,
  );
  check(
    "welcome page signed off by Student Affairs, Dean's name removed",
    welcomeHtml.includes("Student Affairs") && !welcomeHtml.includes("Morenikeji"),
    "",
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exitCode = 1;
});
