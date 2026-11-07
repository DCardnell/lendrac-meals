import { prisma } from './prisma'
import { UK_CANONICAL_PRODUCTS, DEFAULT_WEEKLY_STAPLES } from './uk-catalog'
import { generateFullUKMealLibrary } from './uk-meals-seed'

let seedPromise: Promise<void> | null = null

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seedPromise) {
    return seedPromise
  }

  seedPromise = (async () => {
    try {
      const mealCount = await prisma.meal.count()
      if (mealCount > 50) {
        return
      }

      console.log('[lendrac-meals] Bootstrapping UK Supermarket Catalog, Staples & 200+ Meal Library...')

      // 1. Ensure HouseholdSettings exists
      await prisma.householdSettings.upsert({
        where: { id: 'default' },
        update: {},
        create: {
          id: 'default',
          activeSupermarkets: JSON.stringify([
            'aldi',
            'lidl',
            'asda',
            'tesco',
            'sainsburys',
            'morrisons',
            'ocado',
            'waitrose',
          ]),
          hasTescoClubcard: true,
          hasSainsburysNectar: true,
          hasMorrisonsMore: true,
          hasLidlPlus: true,
          splitShopMinSavingsGbp: 4.0,
          currentDeckBatchSize: 30,
          currentDeckSeed: 1,
        },
      })

      // 2. Upsert Canonical Products
      for (const prod of UK_CANONICAL_PRODUCTS) {
        await prisma.canonicalProduct.upsert({
          where: { id: prod.id },
          update: {
            name: prod.name,
            aisle: prod.aisle,
            defaultUnit: prod.defaultUnit,
            packSize: prod.packSize,
            packLabel: prod.packLabel,
            storePrices: JSON.stringify(prod.storePrices),
          },
          create: {
            id: prod.id,
            name: prod.name,
            aisle: prod.aisle,
            defaultUnit: prod.defaultUnit,
            packSize: prod.packSize,
            packLabel: prod.packLabel,
            storePrices: JSON.stringify(prod.storePrices),
          },
        })
      }

      // 3. Upsert Default Weekly Staples
      for (const staple of DEFAULT_WEEKLY_STAPLES) {
        await prisma.stapleItem.upsert({
          where: { name: staple.name },
          update: {},
          create: {
            name: staple.name,
            aisle: staple.aisle,
            productId: staple.productId,
            quantityPacks: staple.quantityPacks,
            status: staple.status,
            autoNeedWeekly: staple.autoNeedWeekly,
          },
        })
      }

      // 4. Generate and insert 200+ UK Meals
      const allMeals = generateFullUKMealLibrary()
      // Pick 30 randomized indices for the initial weekly voting deck
      const indices = allMeals.map((_, idx) => idx)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }
      const initialDeckSet = new Set(indices.slice(0, 30))

      for (let i = 0; i < allMeals.length; i++) {
        const m = allMeals[i]
        const existing = await prisma.meal.findUnique({ where: { slug: m.slug } })
        if (existing) continue

        await prisma.meal.create({
          data: {
            slug: m.slug,
            title: m.title,
            description: m.description,
            cuisine: m.cuisine,
            category: m.category,
            prepMinutes: m.prepMinutes,
            cookMinutes: m.cookMinutes,
            servings: m.servings,
            emoji: m.emoji,
            tags: JSON.stringify(m.tags),
            inCurrentDeck: initialDeckSet.has(i),
            selectedForWeek: false,
            ingredients: {
              create: m.ingredients.map((ing) => ({
                productId: ing.productId,
                quantity: ing.quantity,
                displayQuantity: ing.displayQuantity,
                isPantry: ing.isPantry ?? false,
              })),
            },
          },
        })
      }

      console.log(`[lendrac-meals] Seeded ${UK_CANONICAL_PRODUCTS.length} UK products, ${DEFAULT_WEEKLY_STAPLES.length} staples, and ${allMeals.length} meals.`)
    } catch (err) {
      console.error('[lendrac-meals] Seed error:', err)
      seedPromise = null
    }
  })()

  return seedPromise
}
