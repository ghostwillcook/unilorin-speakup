/**
 * Demo data reset — wipes test content and seeds a realistic, standard flow
 * for showcasing the platform (e.g. to an investor). Run:
 *
 *   node scripts/reset-demo-data.mjs
 *
 * DELETES every row in Complaint, ComplaintMessage, LiveConversation,
 * LiveMessage, ChatMessage, Notification and PasswordResetToken. KEEPS users,
 * settings and push subscriptions. Talks to Supabase over the REST API
 * (HTTPS), which keeps working from machines whose direct Postgres route is
 * flaky. Env comes from .env.local, same as prisma/seed.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function unquote(input) {
  const quote = input.charAt(0);
  if (input.length >= 2 && (quote === '"' || quote === "'") && input.endsWith(quote)) {
    return input.slice(1, -1);
  }
  return input;
}
function loadEnvFile(filename) {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, filename), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = unquote(body.slice(eq + 1).trim());
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const rest = (path) => `${BASE}/rest/v1/${path}`;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function call(method, path, body, prefer) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(rest(path), {
        method,
        headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      }
      // 201 Created arrives with an empty body unless return=representation
      // is requested — an empty body is success, not malformed JSON.
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
}

// Real server time (this machine's clock can drift badly). Supabase returns
// its Date header on any request; PostgREST timestamps are naive UTC.
async function serverNow() {
  const res = await fetch(`${BASE}/rest/v1/`, { headers: { apikey: KEY } });
  const dateHeader = res.headers.get("date");
  return dateHeader ? Date.parse(dateHeader) : Date.now();
}

// Prisma's DateTime columns are naive UTC — strip the Z like existing rows.
const iso = (ms) => new Date(ms).toISOString().replace("Z", "");

async function main() {
  const now = await serverNow();
  console.log(`server time: ${new Date(now).toISOString()}`);
  const h = (hours) => now - hours * 3600 * 1000;

  const users = await call(
    "GET",
    `User?select=id,email,role&order=email.asc`,
  );
  const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
  const U = {
    admin: byEmail["studentaffairs@unilorin.edu.ng"],
    aisha: byEmail["aisha.bello@students.unilorin.edu.ng"],
    chinedu: byEmail["chinedu.okwuosa@students.unilorin.edu.ng"],
    yetunde: byEmail["yetunde.adeyemi@students.unilorin.edu.ng"],
    samuel: byEmail["samuelopadotun6@gmail.com"],
    mutmainnah: byEmail["mutmainnahtope@gmail.com"],
    iyanuoluwa: byEmail["iyanuoluwaotaro@gmail.com"],
  };
  for (const [k, v] of Object.entries(U)) {
    if (!v) {
      console.error(`Missing account in DB: ${k}`);
      process.exit(1);
    }
  }
  console.log(`accounts: admin + 6 students found`);

  // ---- wipe (children before parents) -------------------------------------
  for (const table of [
    "ComplaintMessage",
    "LiveMessage",
    "Complaint",
    "LiveConversation",
    "ChatMessage",
    "Notification",
    "PasswordResetToken",
  ]) {
    await call("DELETE", table + "?id=neq.");
    console.log(`cleared ${table}`);
  }

  // ---- complaints + threads ------------------------------------------------
  let n = 0;
  const id = (p) => `${p}${String(++n).padStart(22, "0")}`;

  const complaintDefs = [
    {
      user: U.aisha, status: "IN_REVIEW", hours: 72,
      title: "No water supply in Block J hostels",
      description:
        "There has been no running water in Block J (male wing) since Monday evening. The taps run dry by morning and residents are fetching from the borehole near the sports complex. This is becoming urgent.",
      adminReply: null,
      thread: [
        { sender: U.admin, hours: 48, content: "Thank you for this report. Can you confirm whether all floors are affected, and whether the ground floor tanks are also empty?" },
        { sender: U.aisha, hours: 47, content: "All floors, and the tanks are empty too. It gets worse in the mornings." },
        { sender: U.admin, hours: 24, content: "Maintenance has been dispatched and the Works unit is on site. We will update this thread as work progresses." },
      ],
    },
    {
      user: U.chinedu, status: "RESOLVED", hours: 120,
      title: "Projector in Lecture Theatre F100 not working",
      description:
        "The projector in F100 has not powered on since last week. Lectures for PHY 205 are holding without slides and the hall is too bright for the whiteboard.",
      adminReply: "Bulb replaced and tested with the Works unit. Resolved.",
      thread: [
        { sender: U.admin, hours: 96, content: "The bulb has been replaced and the unit tested with the Works unit. Please confirm at the next lecture." },
        { sender: U.chinedu, hours: 94, content: "Confirmed working. Thank you!" },
      ],
    },
    {
      user: U.yetunde, status: "PENDING", hours: 10,
      title: "Course registration portal rejecting my matric number",
      description:
        "The registration portal returns an 'invalid matric number' error each time I submit. My details are correct as printed on my ID card. Please assist.",
      adminReply: null, thread: [],
    },
    {
      user: U.samuel, status: "IN_REVIEW", hours: 48,
      title: "Shuttle buses scarce between 7 and 9am",
      description:
        "Only one or two shuttles run during the 7–9am window, so students miss 8am lectures. The queue at the main gate stretches past the gatehouse most mornings.",
      adminReply: null,
      thread: [
        // readAt left null: an unread reply waiting on the student dashboard.
        { sender: U.admin, hours: 24, content: "Please confirm the route you take (main gate to Faculty of Engineering?) so we can direct this to transport services with specifics.", unread: true },
      ],
    },
    {
      user: U.mutmainnah, status: "REJECTED", hours: 144,
      title: "Extra charge on faculty dues receipt",
      description:
        "My faculty dues receipt shows an extra ₦1,500 charge that is not on the published fee schedule. Kindly review.",
      adminReply: "The ₦1,500 is the departmental laboratory levy approved for this session. No correction needed.",
      thread: [
        { sender: U.admin, hours: 120, content: "Thank you for flagging this. The ₦1,500 line is the departmental laboratory levy approved for this session — it is listed on the faculty notice board. No correction is needed on your receipt." },
        { sender: U.mutmainnah, hours: 117, content: "Understood, thank you for clarifying." },
      ],
    },
    {
      user: U.iyanuoluwa, status: "RESOLVED", hours: 96,
      title: "Walkway lights out between Hostel L and the library",
      description:
        "Six poles along the walkway between Hostel L and the library have been dark for over a week. It is unsafe walking that stretch at night.",
      adminReply: "Bulbs replaced across all six poles. Resolved.",
      thread: [
        { sender: U.admin, hours: 72, content: "All six poles have had their bulbs replaced. Please let us know if any remain out." },
        { sender: U.iyanuoluwa, hours: 67, content: "All bright now. Thank you!" },
      ],
    },
    {
      user: U.aisha, status: "PENDING", hours: 24,
      title: "Library closes too early during exam period",
      description:
        "The main library currently closes at 9pm. During exam period the reading rooms fill up by 7pm and many students have nowhere to study. Could the hours be extended to midnight?",
      adminReply: null, thread: [],
    },
    {
      user: U.yetunde, status: "RESOLVED", hours: 120,
      title: "Missing chairs in Room 202, Faculty of Law",
      description:
        "About fifteen chairs in Room 202 are broken or missing, which makes the room unusable for full attendance.",
      adminReply: "Chairs replaced by Works and Maintenance. Resolved.",
      thread: [
        { sender: U.admin, hours: 96, content: "The room has been restocked — thirty new chairs delivered. Please confirm seating is now adequate." },
        { sender: U.yetunde, hours: 90, content: "Confirmed, thank you." },
      ],
    },
  ];

  for (const def of complaintDefs) {
    const complaintId = id("cmdemo");
    await call("POST", "Complaint", [{
      id: complaintId,
      userId: def.user.id,
      title: def.title,
      description: def.description,
      status: def.status,
      adminReply: def.adminReply,
      files: [],
      createdAt: iso(h(def.hours)),
      updatedAt: iso(h(def.thread.length ? def.thread[def.thread.length - 1].hours : def.hours)),
    }]);
    for (const m of def.thread) {
      await call("POST", "ComplaintMessage", [{
        id: id("cmdemo"),
        complaintId,
        senderId: m.sender.id,
        senderRole: m.sender.role,
        content: m.content,
        readAt: m.unread ? null : iso(h(Math.max(0, m.hours - 0.5))),
        deletedAt: null,
        createdAt: iso(h(m.hours)),
      }]);
    }
  }
  console.log(`created ${complaintDefs.length} complaints with threads`);

  // ---- live conversations --------------------------------------------------
  const convDefs = [
    {
      user: U.aisha, pseudonym: "Anonymous #47", status: "OPEN", adminUnread: 0, userUnread: 0, hours: 26,
      messages: [
        { sender: U.aisha, hours: 26, content: "Good afternoon. I want to report that Block J has had no water since Monday evening." },
        { sender: U.admin, hours: 24, content: "Thank you for reaching out. Which block exactly, and is it the whole block or specific floors?" },
        { sender: U.aisha, hours: 23, content: "Block J male wing, all floors. The taps run dry by morning." },
        { sender: U.admin, hours: 20, content: "Noted. Maintenance has been dispatched and we are following up with the Works unit. You will see progress on your complaint thread as well." },
      ],
    },
    {
      user: U.chinedu, pseudonym: "Anonymous #12", status: "WAITING", adminUnread: 1, userUnread: 0, hours: 30,
      messages: [
        { sender: U.chinedu, hours: 30, content: "Hello, please is there a way to get confirmation that the projector repair request was received?" },
        { sender: U.admin, hours: 28, content: "Yes — it was received and marked resolved. Check the complaint thread for the resolution note." },
        // readAt null + adminUnread 1 above: waiting on the Unit.
        { sender: U.chinedu, hours: 2, content: "Thank you. The new bulb works perfectly. I also want to ask about the podium microphone — it cuts out sometimes.", unread: true },
      ],
    },
    {
      user: U.samuel, pseudonym: "Anonymous #23", status: "OPEN", adminUnread: 0, userUnread: 1, hours: 8,
      messages: [
        { sender: U.samuel, hours: 8, content: "Good morning. How do I attach evidence to a complaint about the shuttle shortage?" },
        // readAt null + userUnread 1 above: badge on the student side.
        { sender: U.admin, hours: 7, content: "Use the attachment button in the complaint form — up to five files, 10 MB each. Photos or PDFs work best.", unread: true },
      ],
    },
    {
      user: U.yetunde, pseudonym: "Anonymous #8", status: "CLOSED", adminUnread: 0, userUnread: 0, hours: 120,
      messages: [
        { sender: U.yetunde, hours: 120, content: "My registration portal keeps rejecting my matric number." },
        { sender: U.admin, hours: 118, content: "We have reset the flag on your record. Please try again and confirm." },
        { sender: U.yetunde, hours: 116, content: "It works now. Thank you!" },
      ],
    },
  ];

  for (const def of convDefs) {
    const convId = id("cmdemo");
    await call("POST", "LiveConversation", [{
      id: convId,
      userId: def.user.id,
      pseudonym: def.pseudonym,
      status: def.status,
      adminUnread: def.adminUnread,
      userUnread: def.userUnread,
      createdAt: iso(h(def.hours)),
      updatedAt: iso(h(def.messages[def.messages.length - 1].hours)),
    }]);
    for (const m of def.messages) {
      await call("POST", "LiveMessage", [{
        id: id("cmdemo"),
        conversationId: convId,
        senderId: m.sender.id,
        senderRole: m.sender.role,
        content: m.content,
        readAt: m.unread ? null : iso(h(Math.max(0, m.hours - 0.5))),
        deletedAt: null,
        createdAt: iso(h(m.hours)),
      }]);
    }
  }
  console.log(`created ${convDefs.length} live conversations with messages`);

  // ---- anonymous room ------------------------------------------------------
  const room = [
    { sender: U.aisha, pseudo: "Anonymous #42", hours: 30, content: "Has anyone else's block been dry since yesterday? Block J still has no water." },
    { sender: U.chinedu, pseudo: "Anonymous #15", hours: 29, content: "Same in Block F. We've been fetching from the borehole near the sports complex." },
    { sender: U.yetunde, pseudo: "Anonymous #87", hours: 27, content: "The shuttle queue at the main gate this morning was something else. Leave early if you have an 8am lecture." },
    { sender: U.samuel, pseudo: "Anonymous #3", hours: 25, content: "Does anyone know when the exam timetable drops? The faculty board said this week." },
    { sender: U.admin, pseudo: "Student Affairs", hours: 24, content: "Update: the Unit has received reports about water supply in Blocks J and F. Maintenance has been dispatched — please lodge a formal complaint if your block is affected so we can track it." },
    { sender: U.mutmainnah, pseudo: "Anonymous #109", hours: 23, content: "Just did. The complaint form took two minutes." },
    { sender: U.iyanuoluwa, pseudo: "Anonymous #23", hours: 20, content: "Library extension hours during exams would go a long way. Currently closes by 9pm." },
    { sender: U.aisha, pseudo: "Anonymous #42", hours: 19, content: "Agreed. The reading rooms are always full by 7pm." },
    { sender: U.chinedu, pseudo: "Anonymous #15", hours: 16, content: "Anyone finished with PHY 205 past questions? Need to borrow before Thursday." },
    { sender: U.yetunde, pseudo: "Anonymous #87", hours: 12, content: "The new notice board beside the cafeteria is actually useful. Kudos to whoever pushed for that." },
    { sender: U.samuel, pseudo: "Anonymous #3", hours: 6, content: "Confirming — exam timetable is out on the faculty portal." },
    { sender: U.mutmainnah, pseudo: "Anonymous #109", hours: 2, content: "Water is back in Block F. Fingers crossed it stays." },
  ];
  for (const m of room) {
    await call("POST", "ChatMessage", [{
      id: id("cmdemo"),
      userId: m.sender.id,
      pseudonym: m.pseudo,
      content: m.content,
      timestamp: iso(h(m.hours)),
    }]);
  }
  console.log(`created ${room.length} anonymous room messages`);

  // ---- notifications (broadcasts, one row per student) ---------------------
  const broadcasts = [
    {
      hours: 96,
      title: "Welcome to UNILORIN Student Connect",
      body: "Your official channel to the Student Affairs Unit — lodge complaints, message the Unit privately, and speak with other students anonymously.",
      readBy: [U.aisha, U.chinedu, U.yetunde, U.iyanuoluwa],
    },
    {
      hours: 20,
      title: "Water supply restored to Block J",
      body: "Maintenance has completed work on the Block J supply. Report any recurrence through the complaint form.",
      readBy: [U.aisha, U.chinedu, U.yetunde],
    },
  ];
  const students = [U.aisha, U.chinedu, U.yetunde, U.samuel, U.mutmainnah, U.iyanuoluwa];
  for (const b of broadcasts) {
    for (const s of students) {
      await call("POST", "Notification", [{
        id: id("cmdemo"),
        userId: s.id,
        title: b.title,
        body: b.body,
        readAt: b.readBy.includes(s) ? iso(h(b.hours - 1)) : null,
        createdAt: iso(h(b.hours)),
      }]);
    }
  }
  console.log(`created ${broadcasts.length} broadcasts (${broadcasts.length * students.length} rows)`);

  console.log("\nDemo data reset complete.");
  console.log("  complaints:        8  (2 PENDING, 2 IN_REVIEW, 3 RESOLVED, 1 REJECTED)");
  console.log("  live messages:     4 conversations (1 waiting on the Unit, 1 unread by student, 1 closed)");
  console.log("  anonymous room:   12 messages incl. one Student Affairs update");
  console.log("  notifications:     2 broadcasts with mixed read state");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
