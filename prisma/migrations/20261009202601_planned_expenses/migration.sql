-- CreateTable
CREATE TABLE "planned_expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "starts_on" DATETIME NOT NULL,
    "ends_on" DATETIME,
    "notes" TEXT,
    "created_by_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "planned_expense_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "planned_expense_starts_on_idx" ON "planned_expense"("starts_on");
