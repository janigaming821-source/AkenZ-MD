-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jid" TEXT NOT NULL,
    "waId" TEXT,
    "name" TEXT,
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_User" ("blocked", "firstSeen", "id", "jid", "language", "lastSeen", "messageCount", "name", "waId") SELECT "blocked", "firstSeen", "id", "jid", "language", "lastSeen", "messageCount", "name", "waId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_jid_key" ON "User"("jid");
CREATE INDEX "User_lastSeen_idx" ON "User"("lastSeen");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
