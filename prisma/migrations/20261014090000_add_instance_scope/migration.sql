-- One process now hosts many bots: a BotConfig row *is* an instance, so its id
-- doubles as the instance id and the owner's row (id 1) needs no migration.
ALTER TABLE "BotConfig" ADD COLUMN "apiKey" TEXT;
ALTER TABLE "BotConfig" ADD COLUMN "label" TEXT;
ALTER TABLE "BotConfig" ADD COLUMN "plan" TEXT;
ALTER TABLE "BotConfig" ADD COLUMN "expiresAt" DATETIME;

-- Every other row belongs to exactly one instance. Existing rows are the owner's.
ALTER TABLE "User" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GroupSettings" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Warning" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AutoReply" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CustomCommand" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Note" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScheduledTask" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MessageStat" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BotLog" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MediaHistory" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OwnerAction" ADD COLUMN "instance" INTEGER NOT NULL DEFAULT 1;

-- The same WhatsApp identity can exist in two bots at once, so uniqueness is
-- per instance. A plain WhatsApp group stays one global row on purpose.
DROP INDEX "User_jid_key";
CREATE UNIQUE INDEX "User_jid_instance_key" ON "User"("jid", "instance");
DROP INDEX "CustomCommand_name_key";
CREATE UNIQUE INDEX "CustomCommand_name_instance_key" ON "CustomCommand"("name", "instance");
DROP INDEX "GroupSettings_groupJid_key";
CREATE UNIQUE INDEX "GroupSettings_groupJid_instance_key" ON "GroupSettings"("groupJid", "instance");
