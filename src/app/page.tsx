import { prisma } from '@/lib/prisma'
import { ensureDatabaseSeeded } from '@/lib/seed-runner'
import {
  MealsPlannerApp,
  ClientMeal,
  ClientMember,
  ClientStaple,
  ClientShoppingItem,
  ClientSettings,
  ClientProductOption,
} from '@/components/MealsPlannerApp'
import { SupermarketId } from '@/lib/uk-catalog'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  await ensureDatabaseSeeded()

  const [mealsRaw, membersRaw, staplesRaw, shoppingRaw, settingsRaw, productsRaw] =
    await Promise.all([
      prisma.meal.findMany({
        include: {
          ingredients: {
            include: { product: true },
          },
          votes: true,
        },
        orderBy: { title: 'asc' },
      }),
      prisma.householdMember.findMany({
        orderBy: { createdAt: 'asc' },
      }),
      prisma.stapleItem.findMany({
        include: { product: true },
        orderBy: [{ aisle: 'asc' }, { name: 'asc' }],
      }),
      prisma.shoppingItem.findMany({
        include: { product: true },
        orderBy: [{ aisle: 'asc' }, { name: 'asc' }],
      }),
      prisma.householdSettings.findUnique({
        where: { id: 'default' },
      }),
      prisma.canonicalProduct.findMany({
        orderBy: [{ aisle: 'asc' }, { name: 'asc' }],
      }),
    ])

  const initialMeals: ClientMeal[] = mealsRaw.map((m) => {
    let tags: string[] = []
    try {
      tags = JSON.parse(m.tags)
    } catch {
      tags = []
    }
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      description: m.description,
      cuisine: m.cuisine,
      category: m.category,
      prepMinutes: m.prepMinutes,
      cookMinutes: m.cookMinutes,
      servings: m.servings,
      emoji: m.emoji,
      tags,
      inCurrentDeck: m.inCurrentDeck,
      selectedForWeek: m.selectedForWeek,
      plannedDay: m.plannedDay,
      portionScale: m.portionScale,
      isCustom: m.isCustom,
      ingredients: m.ingredients.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        aisle: i.product.aisle,
        quantity: i.quantity,
        displayQuantity: i.displayQuantity,
        isPantry: i.isPantry,
      })),
      votes: m.votes.map((v) => ({
        id: v.id,
        mealId: v.mealId,
        memberId: v.memberId,
        memberName: v.memberName,
        choice: v.choice as 'YES' | 'NOT_THIS_WEEK' | 'NO',
      })),
    }
  })

  const initialMembers: ClientMember[] = membersRaw.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
  }))

  const initialStaples: ClientStaple[] = staplesRaw.map((s) => ({
    id: s.id,
    name: s.name,
    aisle: s.aisle,
    productId: s.productId,
    packLabel: s.product?.packLabel || 'pack',
    quantityPacks: s.quantityPacks,
    status: s.status as 'OUT' | 'LOW' | 'NEEDED' | 'IN_STOCK',
    autoNeedWeekly: s.autoNeedWeekly,
  }))

  const initialShoppingItems: ClientShoppingItem[] = shoppingRaw.map((item) => ({
    id: item.id,
    name: item.name,
    aisle: item.aisle,
    productId: item.productId,
    totalQuantity: item.totalQuantity,
    packsNeeded: item.packsNeeded,
    unitLabel: item.unitLabel,
    sourceNotes: item.sourceNotes,
    sourceType: item.sourceType,
    checked: item.checked,
    haveInCupboard: item.haveInCupboard,
    storePricesJson: item.product?.storePrices ?? null,
  }))

  let activeSupermarkets: SupermarketId[] = [
    'aldi',
    'lidl',
    'asda',
    'tesco',
    'sainsburys',
    'morrisons',
    'ocado',
    'waitrose',
  ]
  if (settingsRaw?.activeSupermarkets) {
    try {
      activeSupermarkets = JSON.parse(settingsRaw.activeSupermarkets)
    } catch {
      // keep default
    }
  }

  const initialSettings: ClientSettings = {
    activeSupermarkets,
    hasTescoClubcard: settingsRaw?.hasTescoClubcard ?? true,
    hasSainsburysNectar: settingsRaw?.hasSainsburysNectar ?? true,
    hasMorrisonsMore: settingsRaw?.hasMorrisonsMore ?? true,
    hasLidlPlus: settingsRaw?.hasLidlPlus ?? true,
    splitShopMinSavingsGbp: settingsRaw?.splitShopMinSavingsGbp ?? 4.0,
    currentDeckBatchSize: settingsRaw?.currentDeckBatchSize ?? 30,
    currentDeckSeed: settingsRaw?.currentDeckSeed ?? 1,
  }

  const productCatalog: ClientProductOption[] = productsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    aisle: p.aisle,
    packLabel: p.packLabel,
    defaultUnit: p.defaultUnit,
    packSize: p.packSize,
  }))

  return (
    <MealsPlannerApp
      initialMeals={initialMeals}
      initialMembers={initialMembers}
      initialStaples={initialStaples}
      initialShoppingItems={initialShoppingItems}
      initialSettings={initialSettings}
      productCatalog={productCatalog}
    />
  )
}
