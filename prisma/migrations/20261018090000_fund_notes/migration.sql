-- CreateTable
CREATE TABLE "fund_note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "origin" TEXT NOT NULL,
    "doc_url" TEXT,
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
    CONSTRAINT "fund_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_fund_diligence_answer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fund_manager_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_urls" JSONB NOT NULL DEFAULT [],
    "answered_by_user_id" TEXT,
    "fund_note_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fund_diligence_answer_fund_manager_id_fkey" FOREIGN KEY ("fund_manager_id") REFERENCES "fund_manager" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fund_diligence_answer_answered_by_user_id_fkey" FOREIGN KEY ("answered_by_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fund_diligence_answer_fund_note_id_fkey" FOREIGN KEY ("fund_note_id") REFERENCES "fund_note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_fund_diligence_answer" ("answer", "answered_by_user_id", "created_at", "fund_manager_id", "id", "question", "source", "source_urls", "updated_at") SELECT "answer", "answered_by_user_id", "created_at", "fund_manager_id", "id", "question", "source", "source_urls", "updated_at" FROM "fund_diligence_answer";
DROP TABLE "fund_diligence_answer";
ALTER TABLE "new_fund_diligence_answer" RENAME TO "fund_diligence_answer";
CREATE UNIQUE INDEX "fund_diligence_answer_fund_manager_id_question_key" ON "fund_diligence_answer"("fund_manager_id", "question");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "fund_note_fund_manager_id_created_at_idx" ON "fund_note"("fund_manager_id", "created_at");

