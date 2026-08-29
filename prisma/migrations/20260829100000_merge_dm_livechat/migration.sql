-- The merge: DirectMessage folds into LiveMessage; soft-delete columns; the
-- notification channel (in-app + Web Push) arrives.

-- Soft delete on the two threaded message tables. Rows stay for audit; reads
-- exclude them.
ALTER TABLE "ComplaintMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "LiveMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- The notification channel: one row per recipient (broadcasts fan out), and
-- one Web Push subscription row per browser.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The fold. Every student who ever sent or received a DM gets a conversation
-- (if they do not have one already), and every DM row becomes a LiveMessage
-- with its id, sender, role, content, read state and timestamp preserved —
-- so the merged channel opens with full history and the migration is
-- idempotent by construction (NOT EXISTS on the id).
INSERT INTO "LiveConversation" ("id", "userId", "pseudonym", "status", "adminUnread", "userUnread", "createdAt", "updatedAt")
SELECT
    'conv-dm-' || d."studentId",
    d."studentId",
    -- Pseudonym per migrated student. Sequential, off the 10-999 range the app
    -- draws from, so collisions with app-generated handles are unlikely (and
    -- pseudonyms are not DB-unique by design; lookup ambiguity is guarded at
    -- generation time, and these students already had app conversations with
    -- their own handles — this branch only runs for those who do not).
    'Anonymous #' || (1000 + ROW_NUMBER() OVER (ORDER BY d."studentId")),
    'OPEN',
    0,
    0,
    MIN(d."createdAt"),
    NOW()
FROM "DirectMessage" d
GROUP BY d."studentId"
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "LiveMessage" ("id", "conversationId", "senderId", "senderRole", "content", "readAt", "createdAt")
SELECT
    m."id",
    c."id",
    m."senderId",
    m."senderRole",
    m."content",
    m."readAt",
    m."createdAt"
FROM "DirectMessage" m
JOIN "LiveConversation" c ON c."userId" = m."studentId"
WHERE NOT EXISTS (SELECT 1 FROM "LiveMessage" x WHERE x."id" = m."id");

-- DirectMessage retires. Its rows now live in LiveMessage (above) — dropping
-- the table is safe once the fold has run.
DROP TABLE "DirectMessage";
