-- CreateTable
CREATE TABLE "sign_in_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sign_in_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "google_sub" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "avatar_storage_key" TEXT,
    "avatar_updated_at" DATETIME,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "settings" JSONB,
    "invited_at" DATETIME,
    "invited_by_id" TEXT,
    "last_sign_in_at" DATETIME,
    "deactivated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_user" ("avatar_url", "created_at", "deactivated_at", "email", "google_sub", "id", "last_sign_in_at", "name", "role", "updated_at") SELECT "avatar_url", "created_at", "deactivated_at", "email", "google_sub", "id", "last_sign_in_at", "name", "role", "updated_at" FROM "user";
DROP TABLE "user";
ALTER TABLE "new_user" RENAME TO "user";
CREATE UNIQUE INDEX "user_google_sub_key" ON "user"("google_sub");
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "sign_in_link_token_hash_key" ON "sign_in_link"("token_hash");

-- CreateIndex
CREATE INDEX "sign_in_link_user_id_idx" ON "sign_in_link"("user_id");

-- CreateIndex
CREATE INDEX "sign_in_link_expires_at_idx" ON "sign_in_link"("expires_at");
