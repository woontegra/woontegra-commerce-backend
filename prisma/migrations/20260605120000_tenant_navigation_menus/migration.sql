-- CreateEnum
CREATE TYPE "NavigationMenuType" AS ENUM ('HEADER', 'FOOTER');

-- CreateTable
CREATE TABLE "tenant_navigation_menus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Menü',
    "type" "NavigationMenuType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_navigation_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_navigation_menu_items" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "targetId" TEXT,
    "url" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_navigation_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_navigation_menus_tenantId_type_key" ON "tenant_navigation_menus"("tenantId", "type");

-- CreateIndex
CREATE INDEX "tenant_navigation_menus_tenantId_idx" ON "tenant_navigation_menus"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_navigation_menu_items_menuId_sortOrder_idx" ON "tenant_navigation_menu_items"("menuId", "sortOrder");

-- CreateIndex
CREATE INDEX "tenant_navigation_menu_items_tenantId_idx" ON "tenant_navigation_menu_items"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_navigation_menus" ADD CONSTRAINT "tenant_navigation_menus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_navigation_menu_items" ADD CONSTRAINT "tenant_navigation_menu_items_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "tenant_navigation_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
