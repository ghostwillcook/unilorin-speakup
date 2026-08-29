-- Messaging overhaul: per-complaint threads and Live Chat as per-student
-- conversations with the Unit.
--
-- ChatMessage (the old global anonymous room) is untouched: it lives on as the
-- Chat Logs historical record. DirectMessage is untouched.

-- CreateEnum
CREATE TYPE "LiveStatus" AS ENUM ('OPEN', 'WAITING', 'CLOSED');

-- CreateTable: one message in a complaint's dedicated thread.
CREATE TABLE "ComplaintMessage" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one Live Chat support conversation per student.
CREATE TABLE "LiveConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "status" "LiveStatus" NOT NULL DEFAULT 'OPEN',
    "adminUnread" INTEGER NOT NULL DEFAULT 0,
    "userUnread" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: messages inside a Live Chat conversation.
CREATE TABLE "LiveMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "Role" NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplaintMessage_complaintId_createdAt_idx" ON "ComplaintMessage"("complaintId", "createdAt");
CREATE INDEX "LiveConversation_status_updatedAt_idx" ON "LiveConversation"("status", "updatedAt");
CREATE INDEX "LiveMessage_conversationId_createdAt_idx" ON "LiveMessage"("conversationId", "createdAt");

-- CreateIndex (userId unique enforces one conversation per student)
CREATE UNIQUE INDEX "LiveConversation_userId_key" ON "LiveConversation"("userId");

-- AddForeignKey
ALTER TABLE "ComplaintMessage" ADD CONSTRAINT "ComplaintMessage_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplaintMessage" ADD CONSTRAINT "ComplaintMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveConversation" ADD CONSTRAINT "LiveConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveMessage" ADD CONSTRAINT "LiveMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LiveConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveMessage" ADD CONSTRAINT "LiveMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every complaint's existing adminReply becomes the first message in
-- its thread, so no history is lost to the new model. The sender is attributed
-- to an admin (any admin — the schema never recorded which one wrote it) and
-- the timestamp to the complaint's updatedAt, which the reply path maintained.
-- The guard on ComplaintMessage being empty makes this migration re-runnable
-- against a database that somehow already has thread rows.
INSERT INTO "ComplaintMessage" ("id", "complaintId", "senderId", "senderRole", "content", "readAt", "createdAt")
SELECT
    'legacy-' || c."id",
    c."id",
    (SELECT u."id" FROM "User" u WHERE u."role" = 'ADMIN' ORDER BY u."createdAt" LIMIT 1),
    'ADMIN',
    c."adminReply",
    c."updatedAt",
    c."updatedAt"
FROM "Complaint" c
WHERE c."adminReply" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ComplaintMessage" m WHERE m."complaintId" = c."id");
