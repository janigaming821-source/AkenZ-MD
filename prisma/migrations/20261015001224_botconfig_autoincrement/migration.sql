-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BotConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'AkenZ MD',
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
    "statusText" TEXT NOT NULL DEFAULT 'AkenZ MD',
    "logoData" TEXT,
    "logoMime" TEXT,
    "maxWarnings" INTEGER NOT NULL DEFAULT 3,
    "warningAction" TEXT NOT NULL DEFAULT 'mute',
    "dashboardHash" TEXT,
    "apiKey" TEXT,
    "label" TEXT,
    "plan" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BotConfig" ("aiEnabled", "apiKey", "autoReplyEnabled", "createdAt", "dashboardHash", "expiresAt", "goodbyeEnabled", "groupToolsEnabled", "id", "label", "language", "logoData", "logoMime", "maxWarnings", "mediaEnabled", "name", "ownerNumber", "plan", "prefix", "privateChatsOnly", "statusText", "updatedAt", "version", "warningAction", "welcomeEnabled") SELECT "aiEnabled", "apiKey", "autoReplyEnabled", "createdAt", "dashboardHash", "expiresAt", "goodbyeEnabled", "groupToolsEnabled", "id", "label", "language", "logoData", "logoMime", "maxWarnings", "mediaEnabled", "name", "ownerNumber", "plan", "prefix", "privateChatsOnly", "statusText", "updatedAt", "version", "warningAction", "welcomeEnabled" FROM "BotConfig";
DROP TABLE "BotConfig";
ALTER TABLE "new_BotConfig" RENAME TO "BotConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
