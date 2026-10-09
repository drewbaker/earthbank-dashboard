-- CreateTable
CREATE TABLE "knowledge_source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drive_folder_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connected_by_id" TEXT,
    "refresh_token_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" DATETIME,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_source_connected_by_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_id" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "web_view_link" TEXT,
    "modified_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "text" TEXT,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_excluded" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_document_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_source_drive_folder_id_key" ON "knowledge_source"("drive_folder_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_drive_file_id_key" ON "knowledge_document"("drive_file_id");

-- CreateIndex
CREATE INDEX "knowledge_document_source_id_idx" ON "knowledge_document"("source_id");
