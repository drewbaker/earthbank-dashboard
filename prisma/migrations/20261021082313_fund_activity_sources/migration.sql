-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_fund_manager" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "name_checked_at" DATETIME,
    "website_url" TEXT,
    "website_domain" TEXT,
    "linkedin_url" TEXT,
    "approval_status" TEXT NOT NULL DEFAULT 'approved',
    "approved_at" DATETIME,
    "approved_by_id" TEXT,
    "screened_at" DATETIME,
    "screening_note" TEXT,
    "screened_out_at" DATETIME,
    "stage" TEXT NOT NULL DEFAULT 'new_addition',
    "fit_tags" JSONB NOT NULL DEFAULT [],
    "notes" TEXT,
    "owner_id" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "discovered_from_id" TEXT,
    "discovery_context" TEXT,
    "identity_candidates" JSONB NOT NULL DEFAULT [],
    "research_status" TEXT NOT NULL DEFAULT 'queued',
    "research_queued_at" DATETIME,
    "researched_at" DATETIME,
    "research_error" TEXT,
    "archived_at" DATETIME,
    "summary" TEXT,
    "aum_cents" BIGINT,
    "latest_fund_size_cents" BIGINT,
    "last_fund_close_on" DATETIME,
    "check_min_cents" BIGINT,
    "check_max_cents" BIGINT,
    "has_working_capital_loans" BOOLEAN NOT NULL DEFAULT false,
    "max_working_capital_loan_cents" BIGINT,
    "year_established" INTEGER,
    "hq_country" TEXT,
    "hq_city" TEXT,
    "employee_count" INTEGER,
    "employee_range" TEXT,
    "sectors" JSONB NOT NULL DEFAULT [],
    "loan_types" JSONB NOT NULL DEFAULT [],
    "focus_areas" JSONB NOT NULL DEFAULT [],
    "team_focus_areas" JSONB,
    "lender_archetype" TEXT,
    "lending_channel" TEXT,
    "lends_local_currency" BOOLEAN NOT NULL DEFAULT false,
    "ticket_fit" TEXT,
    "fit_signals" JSONB,
    "last_public_activity_on" DATETIME,
    "last_email_on" DATETIME,
    "last_email_user_id" TEXT,
    "activity_confirmed_at" DATETIME,
    "activity_confirmed_by_id" TEXT,
    "last_activity_on" DATETIME,
    "last_activity_source" TEXT,
    "fit_signals_met" INTEGER NOT NULL DEFAULT 0,
    "research_completeness" INTEGER NOT NULL DEFAULT 0,
    "diligence_completeness" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_manager_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_manager_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_manager_activity_confirmed_by_id_fkey" FOREIGN KEY ("activity_confirmed_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_manager_last_email_user_id_fkey" FOREIGN KEY ("last_email_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_manager_discovered_from_id_fkey" FOREIGN KEY ("discovered_from_id") REFERENCES "fund_manager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_fund_manager" ("approval_status", "approved_at", "approved_by_id", "archived_at", "aum_cents", "check_max_cents", "check_min_cents", "created_at", "diligence_completeness", "discovered_from_id", "discovery_context", "employee_count", "employee_range", "fit_signals", "fit_signals_met", "fit_tags", "focus_areas", "has_working_capital_loans", "hq_city", "hq_country", "id", "identity_candidates", "last_fund_close_on", "last_public_activity_on", "latest_fund_size_cents", "lender_archetype", "lending_channel", "lends_local_currency", "linkedin_url", "loan_types", "max_working_capital_loan_cents", "name", "name_checked_at", "name_key", "notes", "origin", "owner_id", "research_completeness", "research_error", "research_queued_at", "research_status", "researched_at", "screened_at", "screened_out_at", "screening_note", "sectors", "stage", "summary", "team_focus_areas", "ticket_fit", "updated_at", "website_domain", "website_url", "year_established") SELECT "approval_status", "approved_at", "approved_by_id", "archived_at", "aum_cents", "check_max_cents", "check_min_cents", "created_at", "diligence_completeness", "discovered_from_id", "discovery_context", "employee_count", "employee_range", "fit_signals", "fit_signals_met", "fit_tags", "focus_areas", "has_working_capital_loans", "hq_city", "hq_country", "id", "identity_candidates", "last_fund_close_on", "last_public_activity_on", "latest_fund_size_cents", "lender_archetype", "lending_channel", "lends_local_currency", "linkedin_url", "loan_types", "max_working_capital_loan_cents", "name", "name_checked_at", "name_key", "notes", "origin", "owner_id", "research_completeness", "research_error", "research_queued_at", "research_status", "researched_at", "screened_at", "screened_out_at", "screening_note", "sectors", "stage", "summary", "team_focus_areas", "ticket_fit", "updated_at", "website_domain", "website_url", "year_established" FROM "fund_manager";
DROP TABLE "fund_manager";
ALTER TABLE "new_fund_manager" RENAME TO "fund_manager";
CREATE UNIQUE INDEX "fund_manager_name_key_key" ON "fund_manager"("name_key");
CREATE UNIQUE INDEX "fund_manager_website_domain_key" ON "fund_manager"("website_domain");
CREATE INDEX "fund_manager_stage_idx" ON "fund_manager"("stage");
CREATE INDEX "fund_manager_approval_status_idx" ON "fund_manager"("approval_status");
CREATE INDEX "fund_manager_fit_signals_met_idx" ON "fund_manager"("fit_signals_met");
CREATE INDEX "fund_manager_research_status_idx" ON "fund_manager"("research_status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Last activity now also counts email and the team's confirmation; recompute signals at startup.
UPDATE "fund_manager" SET "last_activity_on" = "last_public_activity_on", "last_activity_source" = 'research'
WHERE "last_public_activity_on" IS NOT NULL;
UPDATE "fund_manager" SET "fit_signals" = NULL;
