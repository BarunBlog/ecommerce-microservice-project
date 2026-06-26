-- CreateTable
CREATE TABLE "inventories" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "reservedCount" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT DEFAULT 'Main Warehouse',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventories_productId_key" ON "inventories"("productId");

-- CreateIndex
CREATE INDEX "inventories_productId_idx" ON "inventories"("productId");