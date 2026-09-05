# UNILORIN Student Connect — Debug Sweep 2026-09-05

Ultracode sweep: 8 finder dimensions → cross-dedup → adversarial verification (every finding
re-read by a skeptic; security findings got two). 35 findings adjudicated: **20 confirmed,
13 real-but-downgraded, 2 refuted outright**. Plus a live-prod probe (this machine, direct).

Live prod probe results (all clean):
- `/api/complaints`, `/api/settings`, `/api/admin/stats`, `/api/socket-token` → **401** unauthenticated ✅
- `/api/upload` GET → **405** (POST-only) ✅
- `/api/attachments/..%2f..%2fetc%2fpasswd` → **404**, no data, no 500 ✅
- `/api/push/public-key` → 200 with VAPID key (public by design) ✅
- HSTS + `X-Content-Type-Options: nosniff` present; no CSP / X-Frame-Options (P3 hardening below)
- `/auth/signin` → 200; landing fully rebranded ✅

---

## P1 — fix before real student use

### 1. Deactivated student keeps full access for up to 8 hours
- **Where:** `lib/guards.ts:50`
- **Root cause:** REST guards trust the `isActive` claim baked into the NextAuth JWT at sign-in.
  Deactivating an account in `/admin/users` blocks *new* sign-ins but not requests riding an
  existing session, until the cookie expires.
- **Failure:** Admin deactivates a problematic student at 9am; that student keeps lodging
  complaints, chatting, and DMing until their token naturally expires.
- **Fix:** In `requireRole()`/`guarded()` (or the shared session fetch), re-read
  `prisma.user.findUnique({ where: { id }, select: { isActive } })` on protected writes —
  cache per-invocation only, not across requests. Cheaper option: NextAuth `jwt` callback
  refetching `isActive` on an interval (see NextAuth docs session refetch), but the guard-side
  DB check is the only one that's actually enforceable server-side.
- **Verify:** Sign in as test student → deactivate from admin → student's next API call 401s.

## P2 — real defects, worth fixing

### 2. Web Push fan-out is dropped on serverless — same bug class as the prod email drop
- **Where:** `pages/api/admin/notifications.ts:203-205`
- **Root cause:** `setImmediate(pushToRecipients…)` scheduled AFTER `res.status(201).json()`.
  Netlify freezes the function when the invocation completes; pending timers never run. The
  codebase itself documents this exact failure mode in `forgot-password.ts:109-117` (fixed
  there in 778a9a1 after a real prod loss) but reintroduces it here.
- **Impact:** Students get the in-app row but **never the lock-screen push** on every REST-path
  send — which is the *only* path in prod (socket deliberately bypassed).
- **Fix:** `await pushToRecipients(...).catch(() => {})` before the 201, and batch inside it
  (chunks of ~20 subscriptions via `Promise.all`, keeping per-subscription try/catch so
  404/410 pruning still works). If very large broadcasts risk the function timeout, the
  durable fix is a Netlify Background Function.
- **Verify:** Send a broadcast with the tab closed → push arrives on the device.

### 3. Upload limits are only checked against client-declared values
- **Where:** `pages/api/upload.ts:80-110` (found independently by 3 finders)
- **Root cause:** The route validates `body.contentType`/`body.size` (client-declared), then
  mints `createSignedUploadUrl(path)` — which binds **no** content-type or size restriction
  (verified against @supabase/storage-js 2.112.4: options are upsert-only). The subsequent PUT
  carries its own Content-Type and any byte length; Supabase accepts it. The route's doc
  comment ("limits enforced server-side before any credential is issued") is false.
- **Failure:** Declare `notes.png`/1KB, PUT a 40MB executable; admin clicks the attachment and
  downloads it via the signed URL.
- **Fix:** (1) Set a bucket-level 10MB size limit in the Supabase dashboard. (2) At complaint
  submission (`readFiles()` in `pages/api/complaints/index.ts:198`), stat each key's real
  `metadata.size`/`mimetype` via the service-role client and reject outliers. (3) Add
  `checkRateLimit(user.id)` to `/api/upload` — it's the only unthrottled write route.
  (4) Correct the false doc comment + README:102-103.
- **Verify:** PUT an oversized file with a spoofed declared size → rejected.

### 4. Soft-deleted messages still render in list previews and inflate unread counts
- **Where:** `pages/api/complaints/index.ts:244`
- **Root cause:** The complaints list's last-message preview query doesn't filter `deletedAt`,
  so a deleted message's text still shows in the student's list preview (and similarly for
  unread badges on the Messages side).
- **Fix:** Add `deletedAt: null` to the preview/unread aggregation queries everywhere messages
  are counted or previewed (`complaints/index.ts`, `admin/livechat/*`, `livechat/index.ts`).
- **Verify:** Delete a message → preview and badge update.

### 5. Forgot-password: account-existence oracle + 24h lockout DoS
- **Where:** `pages/api/auth/forgot-password.ts:93-104`
- **Root cause:** (1) Daily-limit branch returns a distinct **429** only for *known* accounts —
  an enumeration oracle; the in-code mitigation comment ("probing takes minutes") is wrong
  because the per-minute limiter allows 20/60s. (2) `countRecentResetRequests` counts attacker-
  minted rows against the victim, so 6 anonymous requests lock the real owner out of reset for
  24h and email-bomb them. (3) Known accounts take a Resend round-trip (~200-600ms) vs one
  indexed read for unknown → timing oracle. (4) `RESET_LIMIT_EXEMPT_EMAILS` hardcodes two real
  Gmail addresses in source, exempt from the cap.
- **Fix:** Return the same generic 200 for the daily-limit branch (log internally); add an
  IP-keyed rate limit alongside the email-keyed one; move the exempt list to env/DB flag.
  Timing oracle is hard to fully close (dummy Resend-shaped delay) — document as accepted.
- **Verify:** 6 rapid requests to a known vs unknown address → indistinguishable responses.

### 6. REST rate limits ignore the admin's chatRateLimitPerMin setting
- **Where:** `lib/rate-limit.ts:19` (REST path hardcodes 20/min)
- **Root cause:** The admin sets a chat rate limit in Settings; the socket server honors it,
  but every REST fallback path (and all non-chat writes) uses the hardcoded in-memory 20/min.
  Two independent per-process buckets also mean the effective limit doubles when both paths run.
- **Fix:** Have REST paths read the `Setting` (cached, like `lib/settings.ts` does) for chat
  writes; document that non-chat writes keep the fixed default.
- **Verify:** Set limit to 1/min in admin → second REST message within a minute is 429.

### 7. Concurrent `useSocket()` mounts kill each other's connecting socket
- **Where:** `lib/socket-client.ts:133`
- **Root cause:** The "gave up" heuristic reads `!connected && !_reconnecting` — but
  `_reconnecting` is also false during a socket's *first* connection attempt. On hard-load of
  `/student`, NotificationBell (×2) + NotificationOverlay each run their own token fetch; a
  later resolver sees the earlier socket mid-handshake, calls `disconnect()` on it (which sets
  `skipReconnect` — permanent), and builds its own. The earlier consumer keeps a dead socket
  forever (deps are `[enabled]` only). Verified against the installed socket.io-client build.
- **Fix:** (1) Check Manager `_readyState === "closed"` instead of inferring give-up.
  (2) Serialize creation behind one module-level `inFlight` promise so concurrent consumers
  await the same connection. (3) Belt-and-braces: clear `shared` on `reconnect_failed`.
- **Verify:** Hard-load /student → single socket in devtools; notification bumps the badge live.

## P3 — real, edge-case or polish (fix opportunistically)

### 8. Four private-content GETs omit `Cache-Control: no-store`
- `complaints/[id]/messages.ts:118`, `livechat/index.ts:157`, `admin/livechat/index.ts:107`,
  `admin/livechat/[id].ts:102`. Siblings set it with a "never store personal data" comment;
  these four were missed. **Fix:** add the header. Trivial.

### 9. Password-reset token lifecycle races (3 sub-items)
- **9a.** Non-CAS burn (`lib/password-reset.ts:104-118`): two concurrent consumes both succeed.
  **Fix:** `updateMany({ where: { id, usedAt: null } })` + check `count === 0`. One-liner.
- **9b.** Three unwrapped writes on request (`password-reset.ts:42`): concurrent requests can
  exceed the 5/day cap and leave two live tokens. **Fix:** wrap in `$transaction`.
- **9c.** Unbounded attacker-controlled `token` string as rate-limit Map key
  (`reset-password.ts:36`): memory-exhaustion vector. **Fix:** reject tokens over 64 chars /
  non-hex before anything else.

### 10. Anonymous Room "mine" detection = pseudonym string equality (docx bug 3, root-caused)
- `components/AnonymousRoomPanel.tsx:333` + `server/socket.mjs` pseudonym picker: pseudonyms
  have no uniqueness constraint; two connected students can both be "Anonymous #42", and the
  client then renders the other student's messages as "You". **Fix:** server assigns and
  remembers a per-connection token echoed with each message; client compares tokens, not names.
  At this scale collisions are rare — acceptable to defer.

### 11. Presence broadcast is O(N²) traffic
- `server/socket.mjs:478`: every connect/disconnect broadcasts the full presence list to every
  client. Fine at tens of students; degrades in the hundreds. **Fix:** send deltas, or a count.

### 12. Student Messages draft stash cleared by the wrong echo
- `components/MessagesPanel.tsx:215`: a failed send's recovery stash is cleared by an echo that
  doesn't correspond to it, losing the user's typed text on failure. **Fix:** key the stash by
  pending message id, clear only on the matching echo.

### 13. `PushSubscription.userId` has no index
- `prisma/schema.prisma:173`: queried on every broadcast fan-out. **Fix:** `@@index([userId])`
  + migration. One-liner with the next migration batch.

### 14. Admin complaints/users lists return the entire table
- `pages/api/complaints/index.ts:327` etc.: no limit/pagination. Fine at demo scale; will
  degrade. **Fix:** `.take()` + cursor pagination when the time comes.

### 15. `authorize()` response-time oracle
- `lib/auth.ts:43`: unknown email returns fast (one read); wrong password pays a bcrypt round
  (~100ms). Distinguishable by timing. **Fix (cheap):** run a dummy bcrypt compare on the
  fallback hash for unknown emails. P3 because sign-in enumeration is low-value here (emails
  are guessable university addresses anyway).

### 16. Complaint submission-limit TOCTOU (docx bug 2 — accepted tradeoff)
- `pages/api/complaints/index.ts:370`: check-then-create not in a transaction. Two
  same-instant submissions both pass. **Fix if desired:** `$transaction` with the count inside.
  At this concurrency, accepted.

### 17. Per-process in-memory rate limiting (docx bug 7 — known accepted)
- `lib/rate-limit.ts:22`: serverless = per-instance maps, effectively unenforced under fan-out.
  **Fix someday:** Upstash/Redis or a DB-backed counter. Documented limitation for now.

## Real-but-latent (downgraded by skeptics — fix only when the trigger becomes live)

- **Socket push payloads untruncated (docx bug 1, socket half):** `server/socket.mjs:1165`
  lacks the 100/3000 truncation the REST twin has. Latent because notifications deliberately
  bypass the socket today — **but it activates the moment the socket path is re-enabled**
  (there's an in-code TODO to do exactly that after the Render redeploy). Include the 3-line
  truncation fix in the Render refresh so bug 1 closes on both halves.
- **Socket broadcast serial push loop (docx bug 5):** same — REST twin already batches; socket
  twin doesn't. Only matters post-Render-refresh.
- **Socket sends are fire-and-forget** (`MessagesPanel.tsx:321`, `ComplaintThread.tsx:275`,
  `admin/messages.tsx:533`): no ack/timeout; a mid-disconnect emit is silently lost. REST
  fallbacks exist for livechat and complaints, so exposure is the narrow disconnect window.
  **Fix when touching these files:** Socket.io ack callbacks + timeout → fall through to REST.
- **Admin livechat GET marks read after fetching** (`admin/livechat/[id].ts:84`): a message
  committed between findMany and updateMany is marked read but never shown. **Fix:** swap the
  order (mark-read-then-fetch), mirroring the student twin `livechat/index.ts:127-148`.
- **Admin unread badge re-light (docx bug 4 — mechanism pinned):** `handleNew` zeroes locally,
  but the same message triggers `livechat:inbox` → `loadInbox()` which wholesale-replaces with
  server rows where `adminUnread=1`. **Fix:** bump `threadNonce` (re-running the read-receipt
  GET) when a student message lands in the open conversation — server-side counter then
  converges; don't do the naive client-side preserve-zero (suppresses legit cold-socket badges).
- **Moderation rollback into the wrong conversation (docx bug 6 — mechanism pinned):**
  `admin/messages.tsx:664` REST failure branches restore the deleted message with no
  `selectedIdRef` guard (the socket path has one). **Fix:** `restoreIfStillOpen()` closure as
  the socket path does — ~10 lines.
- **ComplaintThread history fetch wholesale-replaces** (`ComplaintThread.tsx:174`): a
  `complaint:new` merged during the in-flight GET is wiped by the response. MessagesPanel fixed
  this exact race with a union-by-id merge. **Fix:** copy that merge (also
  `admin/messages.tsx:292`).
- **NotificationOverlay dedupe asymmetry** (`NotificationOverlay.tsx:108`): catch-up path
  dedupes by id, realtime by title+body → same notification shown twice, or a repeat
  announcement skipped. **Fix:** include the DB row id in the `notification:new` payload.
- **forgot-password swallows sendEmail failure entirely** (`forgot-password.ts:118`): a dead
  Resend key = students permanently locked out while the API says "link sent", zero logs.
  **Fix:** keep the swallow (correct contract) but `console.error` the `{ok:false,error}` —
  ideally inside `lib/email.ts` so all 4 call sites gain diagnostics.
- **Stale Render socket deploy (ops, not code):** anonymous room has no REST write fallback
  (socket-only), deletes don't propagate off-socket, and the student-side realtime
  notification bump is permanently dead in prod. **Fix = the Render redeploy** (see Ops).

## Refuted outright (2)

- Livechat reopen racing admin CLOSE: the claimed harm depends on a status filter that doesn't
  exist anywhere in the admin inbox.
- Socket serial push loop *in prod today*: unreachable — no client invokes the socket
  notification path.

---

## Ops (not code defects)

1. **Render socket refresh** — the highest-value single action: fix the GitHub credential
   block (add `ghostofiyanu` as collaborator on `ghostwillcook/unilorin-speakup` or create a
   new Render service from the current repo), redeploy from HEAD, update CORS/`NEXTAUTH_URL`
   for `unilorinstudentconnect.com`, then revert `pages/admin/notifications.tsx:348-359` to
   the socket-first path per its own TODO. That one redeploy lands the P2002 fix from 6d50534,
   closes docx bugs 1+5 on the socket half, and revives realtime notification bumps.
2. **Add CSP / X-Frame-Options** on Netlify (`netlify.toml` headers) — hardening, P3.
3. **Security headers check**: HSTS + nosniff already present ✅.

## Docx "9 open bugs" scoreboard after this sweep

| # | Docx bug | Status |
|---|---|---|
| 1 | >4k push dropped | REST half already fixed; socket half latent P3 — closes with Render refresh |
| 2 | Complaint limit TOCTOU | Confirmed, accepted tradeoff (P3) |
| 3 | Pseudonym collisions | Root-caused (no uniqueness + string-equality "mine") — P3, fix sketched |
| 4 | Unread badge re-light | Mechanism fully pinned — real P3, fix sketched |
| 5 | Sequential push sends | Not reachable in prod (REST path batches); socket half latent |
| 6 | Rollback into wrong conversation | Mechanism fully pinned — real P3, ~10-line fix |
| 7 | Rate limiter per-process | Confirmed, known accepted (P3) |
| 8 | socket-token returns own JWT | Accepted by design |
| 9 | (push-size related) | covered by #1 |

— Sweep executed 2026-09-05 by 44 subagents (8 finders + adversarial verification), plus
direct live-prod probes. Generated by the recovery session.
