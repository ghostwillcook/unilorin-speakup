# UNILORIN SpeakUp

A complaint and communication platform for the **Students Affairs Unit, University of Ilorin**.
Students sign in, lodge complaints with file attachments and follow each one through
`PENDING → IN_REVIEW → RESOLVED / REJECTED` until the Unit replies. Alongside that there is a
live global chat room where students speak under a rotating pseudonym (`Anonymous #42`) so they
can raise things among themselves without exposing who they are, plus a private direct-message
thread between each student and the Unit. Staff get a console for triaging complaints, answering
DMs, auditing chat, activating or deactivating accounts and toggling anonymity. Built with
Next.js (Pages Router), TypeScript, Tailwind CSS v4, NextAuth, Prisma/Postgres and Socket.io.

---

## Quick start — frontend only

The landing page is designed to stand on its own, so you can see the product before any
infrastructure exists.

```bash
npm install
npm run dev
# then open http://localhost:3000
```

**`/` renders completely with no database and no socket server running, and you do not need a
`.env.local` for this step.** Nothing on the landing page queries Postgres or opens a WebSocket.
The `.env.local` file can be absent entirely — `lib/prisma.ts` only constructs a client on the
first real query, and every API route calls `requireDb()` first, which answers a clean
`503 { error: "Database not configured." }` instead of throwing.

What you get in this mode: the full landing page, the sign-in page's UI, and correct redirects
for protected routes. What you do not get: signing in, complaints, chat or DMs — those need the
database, and chat/DMs also need the socket server. Continue below for that.

---

## Full setup

### 1. Create your env file

```bash
cp .env.local.example .env.local
```

`.env.local.example` documents every variable. The four that matter most are covered next.

### 2. Database — get both Supabase connection strings

In the Supabase dashboard go to **Project Settings → Database → Connection string** and copy
**two different URLs**:

| Variable | Supabase entry | Port | Used for |
| --- | --- | --- | --- |
| `DATABASE_URL` | Transaction pooler | **6543**, append `?pgbouncer=true` | All runtime queries |
| `DIRECT_URL` | Direct connection | **5432** | Migrations only |

```dotenv
DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

Both are required. `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`, and
**migrations fail without `DIRECT_URL`** — schema changes need advisory locks and prepared
statements that PgBouncer's transaction pooling does not support. The `?pgbouncer=true` flag on
`DATABASE_URL` is what stops Prisma from caching prepared statements the pooler will not honour.

### 3. NextAuth secret

```bash
openssl rand -base64 32
```

Put the result in `NEXTAUTH_SECRET`. Set `NEXTAUTH_URL` to the app's own origin
(`http://localhost:3000` locally) — the socket server also uses it as its CORS allow-list, so it
must match the origin the browser is served from.

### 4. Migrate and seed

```bash
npx prisma migrate dev
npm run seed
```

`npm run seed` creates the admin account from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` plus
demo students using `SEED_STUDENT_PASSWORD`. **Change those values in `.env.local` before
seeding anything real** — the committed defaults are placeholders. There is no public
registration route by design: accounts are provisioned by the Unit.

### 5. Storage bucket for attachments

Create a Supabase Storage bucket whose name matches `SUPABASE_STORAGE_BUCKET` (default
`complaint-files`).

**The bucket must be private.** Nothing in this app stores a public URL. `POST /api/upload`
returns a short-lived signed *upload* URL for the browser to `PUT` the file to, and what gets
saved on `Complaint.files[]` is the Storage **object key** — `<user id>/<nonce>-<filename>`.
Every read then goes through `GET /api/attachments/<key>`, which checks the session, confirms the
key sits in the caller's own namespace (admins may read any attachment, a student only their own),
and redirects to a URL signed for 60 seconds. Make the bucket public and you hand out permanent
unauthenticated links to other students' evidence.

Limits are enforced in two application layers, because the signed upload URL itself binds no
restriction — the browser's `PUT` carries its own headers and any byte length, so Supabase will
store whatever arrives. `POST /api/upload` first checks what the client **declares**: **10 MB
per file, 5 files per complaint**, and a MIME allow-list of PNG, JPEG, WebP, PDF, plain text,
DOC and DOCX. Then `POST /api/complaints` stats each stored object with the service-role key
and rejects the whole submission when the **real** stored size or content-type breaks those
rules — that is the layer that catches a spoofed declaration (claim `notes.png` at 1 KB, `PUT`
a 40 MB executable).

**Manual step — set the bucket-level size limit.** Supabase itself imposes nothing on the
`PUT`, so also cap the bucket in the Supabase dashboard: Storage → the bucket → Settings →
**File size limit** → `10485760` bytes (10 MB). That is the hard backstop for anything that
slips past both application layers, and it needs re-setting only if the bucket is recreated.

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never rename it to `NEXT_PUBLIC_*` — it bypasses
row-level security completely.

---

## Running everything

| Process | Command | Port |
| --- | --- | --- |
| Next.js web app | `npm run dev` | 3000 |
| Socket.io realtime server | `npm run socket` | 4000 (`SOCKET_PORT`) |
| Both together | `npm run dev:all` | 3000 + 4000 |

```bash
npm run dev:all
```

**Live chat and direct messages require the socket server.** Socket.io holds a long-lived
connection, which serverless functions cannot, so it runs as its own process
(`server/socket.mjs`) rather than inside Next. It loads `.env.local` itself and needs
`DATABASE_URL` and `NEXTAUTH_SECRET`; it refuses to start without a database and warns loudly if
it falls back to an insecure dev secret. Authentication is handled by the client fetching its raw
NextAuth token from `/api/socket-token` and presenting it as handshake auth, which the socket
server decrypts with the same `NEXTAUTH_SECRET`.

Without it, the app **degrades rather than breaks**: `useSocket()` reports status `offline`, the
chat and DM panels show an offline notice, and everything else — complaints, the admin console,
sign-in — keeps working. Direct messages additionally have a REST fallback
(`GET`/`POST /api/dm/[studentId]`), so DMs can still be read and sent while the realtime server
is down; only the global chat room is truly unavailable.

---

## Scripts

Every script in `package.json`:

| Script | Runs | Purpose |
| --- | --- | --- |
| `npm run dev` | `next dev` | Web app in development on :3000 |
| `npm run socket` | `node server/socket.mjs` | Socket.io realtime server on :4000 |
| `npm run dev:all` | `concurrently -n next,socket …` | Both of the above, colour-tagged in one terminal |
| `npm run build` | `next build` | Production build |
| `npm start` | `next start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` | Strict type check, emits nothing |
| `npm run prisma:generate` | `prisma generate` | Regenerate Prisma Client after a schema edit |
| `npm run prisma:migrate` | `prisma migrate dev` | Create and apply a development migration |
| `npm run prisma:deploy` | `prisma migrate deploy` | Apply existing migrations — the production path, creates nothing new |
| `npm run seed` | `tsx prisma/seed.ts` | Seed the admin and demo student accounts |
| `postinstall` | `prisma generate` | Runs automatically after every install, so a fresh clone or a deploy always has a client |

`package.json` also registers `prisma.seed`, so `npx prisma db seed` and `npx prisma migrate
reset` run the same seed script.

---

## Project structure

```text
unilorin-speakup/
├─ pages/                    Pages Router: UI routes and API routes side by side
│  ├─ index.tsx              Landing page — renders with zero backend
│  ├─ auth/signin.tsx        Credentials sign-in
│  ├─ admin/                 Staff console (dashboard, complaints, messages, chat logs, users, settings)
│  └─ api/                   REST endpoints; auth, complaints, dm, admin, settings,
│                            upload, attachments, socket-token
├─ components/               Reusable UI: GlassCard, NeonButton, StatusBadge, ChatPanel, DMPanel, AdminLayout…
├─ lib/                      Shared logic: prisma client, auth options, route guards, settings, storage, socket hook
├─ prisma/                   schema.prisma (User, Complaint, ChatMessage, DirectMessage, Setting) and the seed script
├─ server/                   socket.mjs — the standalone Socket.io process, run separately from Next
├─ styles/globals.css        Tailwind v4 theme plus the glass/neon component classes
└─ public/                   University crest and logo assets
```

- **`pages/`** — every route in the app, plus the API. Page-level access control lives in
  `getServerSideProps` via `requirePage()`; API access control via `requireRole()`.
- **`components/`** — presentation only, all composing the shared `.glass` / `.neon-*` classes so
  panels stay visually consistent.
- **`lib/`** — the single source of truth for auth, database access, guards and runtime settings.
  Both the web app and the socket server behave off the same rules.
- **`prisma/`** — data model and seed. `DirectMessage` and `Setting` support the DM threads and
  the admin-controlled settings.
- **`server/`** — deliberately isolated: no `@/` alias, no TypeScript, no imports from `lib/`. It
  shares exactly one thing with the web app, `NEXTAUTH_SECRET`.

---

## Routes

| Route | Access | What it does |
| --- | --- | --- |
| `/` | Public | Landing page; works with no database and no socket server |
| `/auth/signin` | Public | Email + password sign-in (student ID optional, must match if given) |
| `/student` | `STUDENT` | Student dashboard: lodge and track complaints, global chat, DM the Unit |
| `/admin` | `ADMIN` | Console dashboard: complaint counts by status, student total, 8 newest complaints |
| `/admin/complaints` | `ADMIN` | All complaints with status/text/date filters; set status and write replies |
| `/admin/messages` | `ADMIN` | DM inbox: every student thread, newest first, with unread counts |
| `/admin/chat-logs` | `ADMIN` | De-anonymised global chat audit — pseudonym alongside the real account |
| `/admin/users` | `ADMIN` | Student directory with complaint/message counts; activate or deactivate accounts |
| `/admin/settings` | `ADMIN` | Toggle anonymous mode and set the chat rate limit per minute |

Signed-in users who hit the wrong area are redirected to their own landing page
(`/student` or `/admin`), not to sign-in. Deactivated accounts are rejected at sign-in and on
every subsequent request.

---

## How anonymity works

Be precise about this with students. **Anonymity here is anonymity from other students — it is
not anonymity from the Students Affairs Unit.**

**What students see**

- In the global chat room each student appears as a pseudonym like `Anonymous #42`, assigned per
  connection and unique among everyone currently online. It is **not stable**: reconnect or
  refresh and you are a different number.
- Students never see another student's name, email or student ID anywhere in the app. The chat
  payload sent to browsers carries no user ID at all — that is enforced by the database `select`
  on every chat query, not by remembering to strip a field.
- Admins are never anonymised in chat. Staff messages appear as **Student Affairs**.

**What staff see**

- Every chat message is stored with its real author. `/admin/chat-logs` shows each message next
  to the sender's **name, email and student ID**, and can be filtered by user, text or date.
- Every complaint is attributed. Admins see the submitting student's name, email and student ID
  on `/admin/complaints`; complaints are not anonymous.
- **Direct messages are not anonymous.** A DM thread is between one identified student and the
  Unit collectively — any admin may read and answer it, and they see who the student is.

**The anonymous-mode switch**

`/admin/settings` exposes `anonymousMode`. When an admin turns it **off**, the global chat starts
showing students' real names instead of pseudonyms, and the change takes effect within seconds
without anyone reconnecting. Whoever operates this service should tell students plainly: chat is
pseudonymous to their peers, fully attributable to the Unit, and the pseudonym layer is a setting
staff can switch off.

---

## Deployment

Two processes, two hosts. That split is not a preference — Socket.io holds a long-lived
connection and no serverless runtime, Netlify's included, can keep one open between requests.

**Web app → Netlify, from GitHub.** `netlify.toml` in the repository root declares everything:
the build command (`npx prisma generate && npm run build`), Node 20, and
`@netlify/plugin-nextjs`, which turns `getServerSideProps` and every `/api` route into a
function. Import the repository in Netlify, then set these in **Site configuration → Environment
variables**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler**, port 6543, `?pgbouncer=true` |
| `DIRECT_URL` | Supabase **direct connection**, port 5432 |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` — the same value as on the socket host |
| `NEXTAUTH_URL` | The deployed Netlify origin |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The `sb_secret_` key |
| `SUPABASE_STORAGE_BUCKET` | `complaint-files` |
| `NEXT_PUBLIC_SOCKET_URL` | The socket deployment's URL |

**`DATABASE_URL` must be the pooler here, not the direct connection.** Every Netlify request is
its own short-lived function, and unpooled connections will exhaust Postgres' limit under any
real traffic.

Migrations do not run on Netlify. Apply them from a machine that has `DIRECT_URL`:

```bash
npx prisma migrate deploy
```

**Socket server → Render, free plan.** `render.yaml` is a blueprint for it: New → Blueprint →
pick the repository. It needs `DATABASE_URL`, `NEXTAUTH_SECRET` and `NEXTAUTH_URL` (set to the
*Netlify* origin — it is the CORS allow-list for the handshake). Render injects `PORT` and the
server binds it.

The free plan spins a service down after ~15 minutes of no traffic, and the next connection pays
a cold start of up to a minute. During that window the app shows "Chat server offline" and the
global room is unavailable; direct messages keep working over the REST fallback.

Two things must line up or realtime silently fails:

1. **`NEXT_PUBLIC_SOCKET_URL` must point at the socket deployment** (e.g.
   `https://speakup-socket.onrender.com`). It is inlined at build time, so set it in Netlify
   *before* building and redeploy after any change.
2. **`NEXTAUTH_SECRET` must be byte-identical in both processes.** The socket server verifies the
   handshake by decrypting the NextAuth session token with that secret; if the two differ, every
   handshake is rejected and the app shows "Chat server offline" while the web side looks
   perfectly healthy.

---

## Troubleshooting

### `503 Database not configured.`

`requireDb()` in `lib/guards.ts` answered before touching Postgres, meaning `DATABASE_URL` is
missing or unreadable. Check that `.env.local` exists at the project root (not `.env.local.txt`),
that the variable is spelled exactly, and **restart `npm run dev`** — Next only reads env files at
startup. If the value is present but queries still fail, you have probably not run
`npx prisma migrate dev` yet, so the tables do not exist. The landing page continuing to work
while API routes return 503 is expected behaviour, not a second bug.

### `prisma migrate` fails against Supabase

Symptoms include hanging on "Applying migration", `prepared statement "s0" already exists`, or an
advisory-lock timeout. Migrations cannot run through the pooler:

- `DIRECT_URL` must be set to the **direct connection on port 5432**.
- `DATABASE_URL` must be the **pooler on 6543 with `?pgbouncer=true`**.
- Do not swap them, and do not add `?pgbouncer=true` to `DIRECT_URL`.

If the password contains URL-unsafe characters (`@`, `#`, `/`, `:`), percent-encode it. If a
previous run died mid-migration, clear the stuck advisory lock by resetting the dev database with
`npx prisma migrate reset` (destructive — it drops data and re-seeds).

### "Chat server offline"

Work through these in order:

1. Is the socket process actually running? `npm run socket` (or `npm run dev:all`). Its startup
   banner prints the port, CORS origin and which secret it loaded.
2. Does `NEXT_PUBLIC_SOCKET_URL` match where it is listening? Default `http://localhost:4000`.
   Because `NEXT_PUBLIC_*` values are baked in at build time, restart the dev server or rebuild
   after editing it.
3. Is `NEXTAUTH_SECRET` the same for both processes? A mismatch makes the handshake fail
   authentication, which looks identical to the server being down.
4. Are you signed in? The handshake needs a valid session token from `/api/socket-token`.
5. `EADDRINUSE` on start means something already holds 4000 — stop it or set `SOCKET_PORT` (and
   update `NEXT_PUBLIC_SOCKET_URL` to match).
6. In production, a CORS rejection in the browser console means `NEXTAUTH_URL` on the socket
   server does not match the origin serving the app.

Direct messages should still work through the REST fallback even while this is unresolved; if
they do not, the problem is the database, not the socket server.

### Sign-in fails after seeding

- Use the exact `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (or `SEED_STUDENT_PASSWORD`) values
  that were in `.env.local` **at the moment the seed ran**. Editing them afterwards does not
  re-hash the stored password — re-run `npm run seed`.
- Email is matched case-insensitively and trimmed, so capitalisation is not the issue. The
  **student ID field is optional, but if you type one it must match the account exactly**; leave
  it blank if unsure.
- "Incorrect email, student ID or password." is deliberately vague and covers unknown accounts
  too. "This account has been deactivated." means `isActive` is false — an admin can restore it
  from `/admin/users`.
- Ran `npx prisma migrate reset`? That drops the accounts. Re-seed.
- Changed `NEXTAUTH_SECRET` after signing in? Existing session cookies can no longer be decrypted
  and you may land in a redirect loop. Clear cookies for `localhost:3000` and sign in again.
- Getting `Database is not configured yet.` in the sign-in error box is the 503 case above, not a
  credentials problem.
