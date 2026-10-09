-- CreateTable
CREATE TABLE "bank_account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_included" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "balance_snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bank_account_id" TEXT NOT NULL,
    "as_of" DATETIME NOT NULL,
    "balance_cents" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "balance_snapshot_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bank_transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "external_id" TEXT NOT NULL,
    "bank_account_id" TEXT,
    "booked_on" DATETIME NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "description" TEXT,
    "counterparty_name" TEXT,
    "category_name" TEXT,
    "parent_category" TEXT,
    "is_excluded_from_burn" BOOLEAN NOT NULL DEFAULT false,
    "source_updated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "bank_transaction_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "adjustments" JSONB NOT NULL DEFAULT [],
    "created_by_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "scenario_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_external_id_key" ON "bank_account"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "balance_snapshot_bank_account_id_as_of_key" ON "balance_snapshot"("bank_account_id", "as_of");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_external_id_key" ON "bank_transaction"("external_id");

-- CreateIndex
CREATE INDEX "bank_transaction_booked_on_idx" ON "bank_transaction"("booked_on");
