-- AlterTable
ALTER TABLE "fund_manager" ADD COLUMN "last_public_activity_on" DATETIME;

-- The fit signals changed (the narrower sector list and the new "recent public activity" signal);
-- clearing them makes the app work them out again from stored research at startup.
UPDATE "fund_manager" SET "fit_signals" = NULL;

-- Pending funds are screened again under the new rules (target sectors only, a web check, closed
-- funds out).
UPDATE "fund_manager"
SET "screened_at" = NULL
WHERE "approval_status" = 'pending' AND "archived_at" IS NULL;

-- The team raised the fund limit from 100 to 200.
UPDATE "setting"
SET "value" = json_set("value", '$.max_funds', 200)
WHERE "key" = 'fund_research' AND json_extract("value", '$.max_funds') < 200;
