-- CreateTable
CREATE TABLE "funder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'foundation',
    "tier" TEXT,
    "relationship_status" TEXT NOT NULL DEFAULT 'no_contact',
    "geo_focus" TEXT,
    "potential_size" TEXT,
    "email_domains" JSONB NOT NULL DEFAULT [],
    "materials_sent_at" DATETIME,
    "last_contact_at" DATETIME,
    "last_contact_note" TEXT,
    "notes" TEXT,
    "owner_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "funder_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funder_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "contact_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_amount_cents" BIGINT,
    "target_date" DATETIME,
    "notes" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funder_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'identified',
    "amount_cents" BIGINT,
    "probability_override" INTEGER,
    "expected_decision_at" DATETIME,
    "expected_receipt_at" DATETIME,
    "received_at" DATETIME,
    "next_step" TEXT,
    "owner_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "opportunity_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opportunity_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opportunity_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "change_event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "from_value" JSONB,
    "to_value" JSONB,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "evidence_id" TEXT,
    "reason" TEXT,
    "confidence" REAL,
    "resolved_at" DATETIME,
    "resolved_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "change_event_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "funder_name_key_key" ON "funder"("name_key");

-- CreateIndex
CREATE INDEX "funder_tier_idx" ON "funder"("tier");

-- CreateIndex
CREATE INDEX "funder_relationship_status_idx" ON "funder"("relationship_status");

-- CreateIndex
CREATE UNIQUE INDEX "contact_email_key" ON "contact"("email");

-- CreateIndex
CREATE INDEX "contact_funder_id_idx" ON "contact"("funder_id");

-- CreateIndex
CREATE UNIQUE INDEX "goal_type_key" ON "goal"("type");

-- CreateIndex
CREATE INDEX "opportunity_funder_id_idx" ON "opportunity"("funder_id");

-- CreateIndex
CREATE INDEX "opportunity_goal_id_stage_idx" ON "opportunity"("goal_id", "stage");

-- CreateIndex
CREATE INDEX "change_event_entity_type_entity_id_field_idx" ON "change_event"("entity_type", "entity_id", "field");

-- CreateIndex
CREATE INDEX "change_event_status_idx" ON "change_event"("status");

-- CreateIndex
CREATE INDEX "change_event_source_idx" ON "change_event"("source");
