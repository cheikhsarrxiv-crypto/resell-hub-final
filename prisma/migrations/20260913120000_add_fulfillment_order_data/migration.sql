-- AlterTable: Order — origin marketplace tag + full shipping address fields.
-- All nullable, purely additive: no existing column touched, no data loss.
ALTER TABLE "Order" ADD COLUMN     "marketplace" TEXT;
ALTER TABLE "Order" ADD COLUMN     "shippingAddress2" TEXT;
ALTER TABLE "Order" ADD COLUMN     "shippingState" TEXT;
ALTER TABLE "Order" ADD COLUMN     "shippingPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN     "shippingEmail" TEXT;

-- AlterTable: OrderItem — historical cost snapshot, nullable (unknown, not
-- zero, for rows created before this column existed).
ALTER TABLE "OrderItem" ADD COLUMN     "purchasePrice" DOUBLE PRECISION;

-- AlterTable: Product — shipping weight/dimensions (grams / centimeters,
-- see column names) and supplier's own SKU. All nullable.
ALTER TABLE "Product" ADD COLUMN     "weightGrams" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN     "lengthCm" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN     "widthCm" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN     "heightCm" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN     "supplierSku" TEXT;
