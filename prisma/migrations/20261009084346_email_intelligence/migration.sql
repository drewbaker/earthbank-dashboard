-- CreateTable
CREATE TABLE "mailbox_connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "google_email" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mailbox_connection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "message_id_header" TEXT NOT NULL,
    "mailbox_user_id" TEXT,
    "from_address" TEXT NOT NULL,
    "to_addresses" JSONB NOT NULL DEFAULT [],
    "sent_at" DATETIME NOT NULL,
    "subject" TEXT,
    "summary" TEXT NOT NULL,
    "is_relevant" BOOLEAN NOT NULL DEFAULT true,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "funder_id" TEXT,
    "model" TEXT,
    "confidence" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_evidence_mailbox_user_id_fkey" FOREIGN KEY ("mailbox_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "email_evidence_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inbound_address" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbound_address_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_change_event" (
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
    CONSTRAINT "change_event_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "change_event_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "email_evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_change_event" ("actor_user_id", "confidence", "created_at", "entity_id", "entity_type", "evidence_id", "field", "from_value", "id", "reason", "resolved_at", "resolved_by_user_id", "source", "status", "to_value") SELECT "actor_user_id", "confidence", "created_at", "entity_id", "entity_type", "evidence_id", "field", "from_value", "id", "reason", "resolved_at", "resolved_by_user_id", "source", "status", "to_value" FROM "change_event";
DROP TABLE "change_event";
ALTER TABLE "new_change_event" RENAME TO "change_event";
CREATE INDEX "change_event_entity_type_entity_id_field_idx" ON "change_event"("entity_type", "entity_id", "field");
CREATE INDEX "change_event_status_idx" ON "change_event"("status");
CREATE INDEX "change_event_source_idx" ON "change_event"("source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_connection_user_id_key" ON "mailbox_connection"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_evidence_message_id_header_key" ON "email_evidence"("message_id_header");

-- CreateIndex
CREATE INDEX "email_evidence_funder_id_sent_at_idx" ON "email_evidence"("funder_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_address_token_hash_key" ON "inbound_address"("token_hash");

-- CreateIndex
CREATE INDEX "inbound_address_user_id_idx" ON "inbound_address"("user_id");
