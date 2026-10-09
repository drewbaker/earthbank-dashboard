-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mailbox_connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "google_email" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" DATETIME,
    "last_error" TEXT,
    "sync_state" TEXT NOT NULL DEFAULT 'idle',
    "sync_phase" TEXT,
    "sync_done" INTEGER NOT NULL DEFAULT 0,
    "sync_total" INTEGER,
    "sync_started_at" DATETIME,
    "last_sync_result" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mailbox_connection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_mailbox_connection" ("created_at", "google_email", "id", "last_error", "last_synced_at", "refresh_token_encrypted", "scopes", "status", "updated_at", "user_id") SELECT "created_at", "google_email", "id", "last_error", "last_synced_at", "refresh_token_encrypted", "scopes", "status", "updated_at", "user_id" FROM "mailbox_connection";
DROP TABLE "mailbox_connection";
ALTER TABLE "new_mailbox_connection" RENAME TO "mailbox_connection";
CREATE UNIQUE INDEX "mailbox_connection_user_id_key" ON "mailbox_connection"("user_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
