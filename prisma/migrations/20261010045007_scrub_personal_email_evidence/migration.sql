-- Emails the AI marked personal are now ignored completely. Clear what was kept about earlier ones:
-- only the Message-ID (so they aren't read again), sender and date remain.
UPDATE "email_evidence"
SET "subject" = NULL, "summary" = 'Personal email; ignored.', "to_addresses" = '[]'
WHERE "is_sensitive" = 1;
