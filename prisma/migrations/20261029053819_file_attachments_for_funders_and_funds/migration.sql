-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT,
    "comment_id" TEXT,
    "funder_id" TEXT,
    "opportunity_id" TEXT,
    "fund_manager_id" TEXT,
    "uploaded_by_id" TEXT,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'upload',
    "received_email_id" TEXT,
    "read_status" TEXT,
    "read_summary" TEXT,
    "read_error" TEXT,
    "read_counts" JSONB,
    "read_at" DATETIME,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachment_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attachment_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachment_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attachment_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_attachment" ("comment_id", "content_type", "created_at", "deleted_at", "filename", "id", "size_bytes", "storage_key", "task_id", "uploaded_by_id") SELECT "comment_id", "content_type", "created_at", "deleted_at", "filename", "id", "size_bytes", "storage_key", "task_id", "uploaded_by_id" FROM "attachment";
DROP TABLE "attachment";
ALTER TABLE "new_attachment" RENAME TO "attachment";
CREATE INDEX "attachment_task_id_idx" ON "attachment"("task_id");
CREATE INDEX "attachment_comment_id_idx" ON "attachment"("comment_id");
CREATE INDEX "attachment_funder_id_idx" ON "attachment"("funder_id");
CREATE INDEX "attachment_fund_manager_id_idx" ON "attachment"("fund_manager_id");
CREATE INDEX "attachment_received_email_id_idx" ON "attachment"("received_email_id");
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
    "attachment_id" TEXT,
    "reason" TEXT,
    "confidence" REAL,
    "resolved_at" DATETIME,
    "resolved_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "change_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "change_event_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "change_event_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "email_evidence" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "change_event_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_change_event" ("actor_user_id", "confidence", "created_at", "entity_id", "entity_type", "evidence_id", "field", "from_value", "id", "reason", "resolved_at", "resolved_by_user_id", "source", "status", "to_value") SELECT "actor_user_id", "confidence", "created_at", "entity_id", "entity_type", "evidence_id", "field", "from_value", "id", "reason", "resolved_at", "resolved_by_user_id", "source", "status", "to_value" FROM "change_event";
DROP TABLE "change_event";
ALTER TABLE "new_change_event" RENAME TO "change_event";
CREATE INDEX "change_event_entity_type_entity_id_field_idx" ON "change_event"("entity_type", "entity_id", "field");
CREATE INDEX "change_event_status_idx" ON "change_event"("status");
CREATE INDEX "change_event_source_idx" ON "change_event"("source");
CREATE TABLE "new_fund_note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "origin" TEXT NOT NULL,
    "doc_url" TEXT,
    "attachment_id" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "findings_added" INTEGER NOT NULL DEFAULT 0,
    "people_added" INTEGER NOT NULL DEFAULT 0,
    "diligence_answered" INTEGER NOT NULL DEFAULT 0,
    "dropped" INTEGER NOT NULL DEFAULT 0,
    "kept_existing" JSONB NOT NULL DEFAULT [],
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_note_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_note_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_fund_note" ("author_user_id", "created_at", "diligence_answered", "doc_url", "dropped", "error", "findings_added", "fund_manager_id", "id", "kept_existing", "origin", "people_added", "status", "text", "title", "updated_at") SELECT "author_user_id", "created_at", "diligence_answered", "doc_url", "dropped", "error", "findings_added", "fund_manager_id", "id", "kept_existing", "origin", "people_added", "status", "text", "title", "updated_at" FROM "fund_note";
DROP TABLE "fund_note";
ALTER TABLE "new_fund_note" RENAME TO "fund_note";
CREATE INDEX "fund_note_fund_manager_id_created_at_idx" ON "fund_note"("fund_manager_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
