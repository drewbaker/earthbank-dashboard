-- Names the team typed (Add fund, email, the seed list) are taken as written; only names the spider
-- found wait for the name check.
UPDATE "fund_manager" SET "name_checked_at" = "created_at" WHERE "origin" IN ('manual', 'seed');
