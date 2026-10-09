-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "uploaded_by_id" TEXT,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachment_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_attachment" ("content_type", "created_at", "deleted_at", "filename", "id", "size_bytes", "storage_key", "task_id", "uploaded_by_id") SELECT "content_type", "created_at", "deleted_at", "filename", "id", "size_bytes", "storage_key", "task_id", "uploaded_by_id" FROM "attachment";
DROP TABLE "attachment";
ALTER TABLE "new_attachment" RENAME TO "attachment";
CREATE INDEX "attachment_task_id_idx" ON "attachment"("task_id");
CREATE INDEX "attachment_comment_id_idx" ON "attachment"("comment_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
