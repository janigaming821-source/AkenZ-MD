-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MessageStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatJid" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "command" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MessageStat" ("chatJid", "command", "createdAt", "id", "isGroup") SELECT "chatJid", "command", "createdAt", "id", "isGroup" FROM "MessageStat";
DROP TABLE "MessageStat";
ALTER TABLE "new_MessageStat" RENAME TO "MessageStat";
CREATE INDEX "MessageStat_chatJid_idx" ON "MessageStat"("chatJid");
CREATE INDEX "MessageStat_createdAt_idx" ON "MessageStat"("createdAt");
CREATE INDEX "MessageStat_command_idx" ON "MessageStat"("command");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
