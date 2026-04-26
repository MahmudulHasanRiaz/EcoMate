/*
  Warnings:

  - Added offlineInvoiceUrl to PurchaseOrder (safe if already exists).
*/
-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "offlineInvoiceUrl" TEXT;
