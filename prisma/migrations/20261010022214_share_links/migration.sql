-- CreateTable
CREATE TABLE "share_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "show_next_steps" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "last_viewed_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_link_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "share_link_token_hash_key" ON "share_link"("token_hash");
