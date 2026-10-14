-- Added after the first remote apply: the login lockout counter.
-- schema.sql already carries this column for a fresh database.
ALTER TABLE customers ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
