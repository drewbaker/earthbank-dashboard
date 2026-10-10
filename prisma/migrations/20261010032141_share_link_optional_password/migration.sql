-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_share_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "password_hash" TEXT,
    "password_encrypted" TEXT,
    "show_next_steps" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "last_viewed_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_share_link" ("created_at", "created_by_user_id", "id", "label", "last_viewed_at", "password_encrypted", "password_hash", "revoked_at", "show_next_steps", "token_encrypted", "token_hash") SELECT "created_at", "created_by_user_id", "id", "label", "last_viewed_at", "password_encrypted", "password_hash", "revoked_at", "show_next_steps", "token_encrypted", "token_hash" FROM "share_link";
DROP TABLE "share_link";
ALTER TABLE "new_share_link" RENAME TO "share_link";
CREATE UNIQUE INDEX "share_link_token_hash_key" ON "share_link"("token_hash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
