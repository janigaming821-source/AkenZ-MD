-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GroupSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "groupJid" TEXT NOT NULL,
    "prefix" TEXT,
    "welcome" BOOLEAN NOT NULL DEFAULT true,
    "goodbye" BOOLEAN NOT NULL DEFAULT true,
    "antiSpam" BOOLEAN NOT NULL DEFAULT true,
    "antiLink" BOOLEAN NOT NULL DEFAULT false,
    "antiDelete" BOOLEAN NOT NULL DEFAULT false,
    "approvals" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "rules" TEXT NOT NULL DEFAULT '',
    "tagallCooldown" INTEGER NOT NULL DEFAULT 180,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GroupSettings_groupJid_fkey" FOREIGN KEY ("groupJid") REFERENCES "Group" ("jid") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GroupSettings" ("antiSpam", "approvals", "createdAt", "goodbye", "groupJid", "id", "muted", "prefix", "rules", "tagallCooldown", "updatedAt", "welcome") SELECT "antiSpam", "approvals", "createdAt", "goodbye", "groupJid", "id", "muted", "prefix", "rules", "tagallCooldown", "updatedAt", "welcome" FROM "GroupSettings";
DROP TABLE "GroupSettings";
ALTER TABLE "new_GroupSettings" RENAME TO "GroupSettings";
CREATE UNIQUE INDEX "GroupSettings_groupJid_key" ON "GroupSettings"("groupJid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
