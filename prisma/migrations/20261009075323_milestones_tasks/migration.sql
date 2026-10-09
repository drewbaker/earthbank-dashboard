-- CreateTable
CREATE TABLE "milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" DATETIME NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'funding',
    "status" TEXT NOT NULL DEFAULT 'open',
    "goal_id" TEXT,
    "opportunity_id" TEXT,
    "funder_id" TEXT,
    "created_by_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "milestone_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "milestone_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "milestone_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "milestone_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "assignee_id" TEXT,
    "due_at" DATETIME,
    "milestone_id" TEXT,
    "opportunity_id" TEXT,
    "funder_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "completed_at" DATETIME,
    "created_by_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "task_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "task_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestone" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "task_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "task_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "author_id" TEXT,
    "body" TEXT NOT NULL,
    "edited_at" DATETIME,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "comment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "milestone_due_at_idx" ON "milestone"("due_at");

-- CreateIndex
CREATE INDEX "milestone_funder_id_idx" ON "milestone"("funder_id");

-- CreateIndex
CREATE INDEX "task_assignee_id_status_idx" ON "task"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "task_milestone_id_idx" ON "task"("milestone_id");

-- CreateIndex
CREATE INDEX "task_funder_id_idx" ON "task"("funder_id");

-- CreateIndex
CREATE INDEX "task_due_at_idx" ON "task"("due_at");

-- CreateIndex
CREATE INDEX "comment_task_id_idx" ON "comment"("task_id");

-- CreateIndex
CREATE INDEX "attachment_task_id_idx" ON "attachment"("task_id");
