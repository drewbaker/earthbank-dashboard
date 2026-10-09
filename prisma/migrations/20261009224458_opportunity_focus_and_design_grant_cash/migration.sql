-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_opportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "funder_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'identified',
    "amount_cents" BIGINT,
    "probability_override" INTEGER,
    "expected_decision_at" DATETIME,
    "expected_receipt_at" DATETIME,
    "committee_on" DATETIME,
    "focus_areas" JSONB NOT NULL DEFAULT '[]',
    "received_at" DATETIME,
    "next_step" TEXT,
    "owner_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "opportunity_funder_id_fkey" FOREIGN KEY ("funder_id") REFERENCES "funder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opportunity_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opportunity_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_opportunity" ("amount_cents", "archived_at", "committee_on", "created_at", "expected_decision_at", "expected_receipt_at", "funder_id", "goal_id", "id", "name", "next_step", "owner_id", "probability_override", "received_at", "stage", "updated_at") SELECT "amount_cents", "archived_at", "committee_on", "created_at", "expected_decision_at", "expected_receipt_at", "funder_id", "goal_id", "id", "name", "next_step", "owner_id", "probability_override", "received_at", "stage", "updated_at" FROM "opportunity";
DROP TABLE "opportunity";
ALTER TABLE "new_opportunity" RENAME TO "opportunity";
CREATE INDEX "opportunity_funder_id_idx" ON "opportunity"("funder_id");
CREATE INDEX "opportunity_goal_id_stage_idx" ON "opportunity"("goal_id", "stage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Cash flow counts design grants only (they fund operating costs). Update a saved setting too.
UPDATE "setting"
SET "value" = json_set("value", '$.include_goal_types', json('["design_grant"]'))
WHERE "key" = 'cash_settings' AND json_valid("value");
