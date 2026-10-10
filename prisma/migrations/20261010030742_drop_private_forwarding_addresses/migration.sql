/*
  Warnings:

  - You are about to drop the `inbound_address` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "inbound_address";
PRAGMA foreign_keys=on;
