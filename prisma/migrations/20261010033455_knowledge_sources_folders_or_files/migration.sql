-- A knowledge source can be a single Drive file as well as a folder. Renamed in place (not
-- dropped and re-added) so connected folders keep their data.
ALTER TABLE "knowledge_source" RENAME COLUMN "drive_folder_id" TO "drive_item_id";
ALTER TABLE "knowledge_source" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'folder';
DROP INDEX "knowledge_source_drive_folder_id_key";
CREATE UNIQUE INDEX "knowledge_source_drive_item_id_key" ON "knowledge_source"("drive_item_id");
