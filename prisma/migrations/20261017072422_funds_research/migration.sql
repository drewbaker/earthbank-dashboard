-- CreateTable
CREATE TABLE "fund_manager" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "website_url" TEXT,
    "website_domain" TEXT,
    "linkedin_url" TEXT,
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
    "lender_archetype" TEXT,
    "lending_channel" TEXT,
    "lends_local_currency" BOOLEAN NOT NULL DEFAULT false,
    "ticket_fit" TEXT,
    "research_completeness" INTEGER NOT NULL DEFAULT 0,
    "diligence_completeness" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_manager_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_manager_discovered_from_id_fkey" FOREIGN KEY ("discovered_from_id") REFERENCES "fund_manager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_finding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "value_key" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "research_run_id" TEXT,
    "rejected_by_user_id" TEXT,
    "rejected_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_finding_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_finding_research_run_id_fkey" FOREIGN KEY ("research_run_id") REFERENCES "fund_research_run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_finding_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "retrieved_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "fund_finding_source" (
    "finding_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "quote" TEXT,

    PRIMARY KEY ("finding_id", "source_id"),
    CONSTRAINT "fund_finding_source_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "fund_finding" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_finding_source_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fund_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "title" TEXT,
    "is_principal" BOOLEAN NOT NULL DEFAULT false,
    "linkedin_url" TEXT,
    "email" TEXT,
    "bio_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_person_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_person_source" (
    "person_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "quote" TEXT,

    PRIMARY KEY ("person_id", "source_id"),
    CONSTRAINT "fund_person_source_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "fund_person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_person_source_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fund_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "website_domain" TEXT,
    "fund_manager_id" TEXT,
    "classified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_organization_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_affiliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "person_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'employment',
    "title" TEXT,
    "start_year" INTEGER,
    "end_year" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_affiliation_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "fund_person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_affiliation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "research_organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_affiliation_source" (
    "affiliation_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "quote" TEXT,

    PRIMARY KEY ("affiliation_id", "source_id"),
    CONSTRAINT "fund_affiliation_source_affiliation_id_fkey" FOREIGN KEY ("affiliation_id") REFERENCES "fund_affiliation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_affiliation_source_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "fund_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_diligence_answer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_urls" JSONB NOT NULL DEFAULT [],
    "answered_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_diligence_answer_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_diligence_answer_answered_by_user_id_fkey" FOREIGN KEY ("answered_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fund_research_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'fund',
    "fund_manager_id" TEXT,
    "source_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "model" TEXT,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "web_searches" INTEGER NOT NULL DEFAULT 0,
    "web_fetches" INTEGER NOT NULL DEFAULT 0,
    "firecrawl_credits" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "findings_added" INTEGER NOT NULL DEFAULT 0,
    "findings_dropped" INTEGER NOT NULL DEFAULT 0,
    "funds_discovered" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "fund_research_run_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "public_investment_record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_key" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_name_key" TEXT NOT NULL,
    "amount_cents" BIGINT,
    "currency" TEXT,
    "original_amount" REAL,
    "committed_on" DATETIME,
    "country" TEXT,
    "instrument" TEXT,
    "description" TEXT,
    "is_intermediary" BOOLEAN NOT NULL DEFAULT false,
    "fund_manager_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "public_investment_record_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "public_investment_source" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "cursor" TEXT,
    "last_synced_at" DATETIME,
    "last_error" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_manager_name_key_key" ON "fund_manager"("name_key");

-- CreateIndex
CREATE UNIQUE INDEX "fund_manager_website_domain_key" ON "fund_manager"("website_domain");

-- CreateIndex
CREATE INDEX "fund_manager_stage_idx" ON "fund_manager"("stage");

-- CreateIndex
CREATE INDEX "fund_manager_research_status_idx" ON "fund_manager"("research_status");

-- CreateIndex
CREATE INDEX "fund_finding_fund_manager_id_field_status_idx" ON "fund_finding"("fund_manager_id", "field", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fund_source_url_key" ON "fund_source"("url");

-- CreateIndex
CREATE UNIQUE INDEX "fund_person_fund_manager_id_name_key_key" ON "fund_person"("fund_manager_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_organization_name_key_key" ON "research_organization"("name_key");

-- CreateIndex
CREATE UNIQUE INDEX "research_organization_fund_manager_id_key" ON "research_organization"("fund_manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_affiliation_person_id_organization_id_relation_key" ON "fund_affiliation"("person_id", "organization_id", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "fund_diligence_answer_fund_manager_id_question_key" ON "fund_diligence_answer"("fund_manager_id", "question");

-- CreateIndex
CREATE INDEX "fund_research_run_fund_manager_id_idx" ON "fund_research_run"("fund_manager_id");

-- CreateIndex
CREATE INDEX "fund_research_run_started_at_idx" ON "fund_research_run"("started_at");

-- CreateIndex
CREATE INDEX "public_investment_record_recipient_name_key_idx" ON "public_investment_record"("recipient_name_key");

-- CreateIndex
CREATE INDEX "public_investment_record_fund_manager_id_idx" ON "public_investment_record"("fund_manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "public_investment_record_source_key_external_id_key" ON "public_investment_record"("source_key", "external_id");

