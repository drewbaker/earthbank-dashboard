-- AlterTable
ALTER TABLE "fund_manager" ADD COLUMN "screened_at" DATETIME;
ALTER TABLE "fund_manager" ADD COLUMN "screened_out_at" DATETIME;
ALTER TABLE "fund_manager" ADD COLUMN "screening_note" TEXT;
