-- CreateTable
CREATE TABLE "BotConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'NOAURA BOT',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "prefix" TEXT NOT NULL DEFAULT '.',
    "language" TEXT NOT NULL DEFAULT 'en',
    "ownerNumber" TEXT NOT NULL DEFAULT '',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "goodbyeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mediaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "groupToolsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "privateChatsOnly" BOOLEAN NOT NULL DEFAULT false,
    "statusText" TEXT NOT NULL DEFAULT 'NOAURA BOT',
    "maxWarnings" INTEGER NOT NULL DEFAULT 3,
    "warningAction" TEXT NOT NULL DEFAULT 'mute',
    "dashboardHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jid" TEXT NOT NULL,
    "waId" TEXT,
    "name" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'en',
    "blocked" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Group" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jid" TEXT NOT NULL,
    "name" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GroupSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "groupJid" TEXT NOT NULL,
    "prefix" TEXT,
    "welcome" BOOLEAN NOT NULL DEFAULT true,
    "goodbye" BOOLEAN NOT NULL DEFAULT true,
    "antiSpam" BOOLEAN NOT NULL DEFAULT true,
    "approvals" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "rules" TEXT NOT NULL DEFAULT '',
    "tagallCooldown" INTEGER NOT NULL DEFAULT 180,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupSettings_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "Group" ("jid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Warning" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "groupJid" TEXT NOT NULL,
    "userJid" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "issuedBy" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Warning_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "Group" ("jid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoReply" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "triggers" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'exact',
    "response" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomCommand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MediaHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "provider" TEXT,
    "requester" TEXT,
    "status" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatJid" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "runAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OwnerAction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "target" TEXT,
    "actorJid" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BotLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "level" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MessageStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatJid" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "command" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageStat_chatJid_fkey" FOREIGN KEY ("chatJid") REFERENCES "Group" ("jid") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_jid_key" ON "User"("jid");

-- CreateIndex
CREATE INDEX "User_lastSeen_idx" ON "User"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Group_jid_key" ON "Group"("jid");

-- CreateIndex
CREATE INDEX "Group_jid_idx" ON "Group"("jid");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSettings_groupJid_key" ON "GroupSettings"("groupJid");

-- CreateIndex
CREATE INDEX "Warning_groupJid_userJid_idx" ON "Warning"("groupJid", "userJid");

-- CreateIndex
CREATE INDEX "AutoReply_enabled_idx" ON "AutoReply"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CustomCommand_name_key" ON "CustomCommand"("name");

-- CreateIndex
CREATE INDEX "MediaHistory_kind_createdAt_idx" ON "MediaHistory"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_status_runAt_idx" ON "ScheduledTask"("status", "runAt");

-- CreateIndex
CREATE INDEX "OwnerAction_createdAt_idx" ON "OwnerAction"("createdAt");

-- CreateIndex
CREATE INDEX "BotLog_createdAt_idx" ON "BotLog"("createdAt");

-- CreateIndex
CREATE INDEX "BotLog_level_createdAt_idx" ON "BotLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "MessageStat_createdAt_idx" ON "MessageStat"("createdAt");

-- CreateIndex
CREATE INDEX "MessageStat_command_idx" ON "MessageStat"("command");
