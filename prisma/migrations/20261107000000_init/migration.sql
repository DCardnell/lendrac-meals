-- CreateTable
CREATE TABLE "HouseholdSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "activeSupermarkets" TEXT NOT NULL DEFAULT '["aldi","lidl","asda","tesco","sainsburys","morrisons","waitrose","ocado"]',
    "hasTescoClubcard" BOOLEAN NOT NULL DEFAULT true,
    "hasSainsburysNectar" BOOLEAN NOT NULL DEFAULT true,
    "hasMorrisonsMore" BOOLEAN NOT NULL DEFAULT true,
    "hasLidlPlus" BOOLEAN NOT NULL DEFAULT true,
    "splitShopMinSavingsGbp" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "currentDeckBatchSize" INTEGER NOT NULL DEFAULT 30,
    "currentDeckSeed" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HouseholdSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#00f3ff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aisle" TEXT NOT NULL,
    "defaultUnit" TEXT NOT NULL,
    "packSize" DOUBLE PRECISION NOT NULL,
    "packLabel" TEXT NOT NULL,
    "storePrices" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meal" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cuisine" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prepMinutes" INTEGER NOT NULL DEFAULT 15,
    "cookMinutes" INTEGER NOT NULL DEFAULT 25,
    "servings" INTEGER NOT NULL DEFAULT 4,
    "emoji" TEXT NOT NULL DEFAULT '🍽️',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "inCurrentDeck" BOOLEAN NOT NULL DEFAULT false,
    "selectedForWeek" BOOLEAN NOT NULL DEFAULT false,
    "plannedDay" TEXT,
    "portionScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealIngredient" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "displayQuantity" TEXT NOT NULL,
    "isPantry" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MealIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealVote" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MealVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StapleItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aisle" TEXT NOT NULL,
    "productId" TEXT,
    "quantityPacks" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NEEDED',
    "autoNeedWeekly" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StapleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aisle" TEXT NOT NULL,
    "productId" TEXT,
    "totalQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "packsNeeded" INTEGER NOT NULL DEFAULT 1,
    "unitLabel" TEXT NOT NULL DEFAULT '1 pack',
    "sourceNotes" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL DEFAULT 'MEAL',
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "haveInCupboard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_name_key" ON "HouseholdMember"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Meal_slug_key" ON "Meal"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MealVote_mealId_memberId_key" ON "MealVote"("mealId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "StapleItem_name_key" ON "StapleItem"("name");

-- AddForeignKey
ALTER TABLE "MealIngredient" ADD CONSTRAINT "MealIngredient_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealIngredient" ADD CONSTRAINT "MealIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CanonicalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealVote" ADD CONSTRAINT "MealVote_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealVote" ADD CONSTRAINT "MealVote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StapleItem" ADD CONSTRAINT "StapleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
