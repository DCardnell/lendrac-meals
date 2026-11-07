'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { SupermarketId } from '@/lib/uk-catalog'

const MEMBER_COLORS = [
  '#00f3ff', // Neon Cyan
  '#ff9900', // LCARS Orange
  '#ff00ff', // Neon Pink
  '#00ff9d', // Neon Green
  '#9999ff', // LCARS Blue
  '#ffdf00', // Gold
]

export async function getOrCreateMember(rawName: string) {
  const cleanName = rawName.trim().slice(0, 32)
  if (!cleanName) {
    throw new Error('Name cannot be empty')
  }

  const existing = await prisma.householdMember.findFirst({
    where: {
      name: {
        equals: cleanName,
        mode: 'insensitive',
      },
    },
  })

  if (existing) {
    revalidatePath('/')
    return existing
  }

  const count = await prisma.householdMember.count()
  const color = MEMBER_COLORS[count % MEMBER_COLORS.length]

  const created = await prisma.householdMember.create({
    data: {
      name: cleanName,
      color,
    },
  })

  revalidatePath('/')
  return created
}

export async function castMealVote(
  mealId: string,
  memberName: string,
  choice: 'YES' | 'NOT_THIS_WEEK' | 'NO'
) {
  if (!['YES', 'NOT_THIS_WEEK', 'NO'].includes(choice)) {
    throw new Error('Invalid vote choice')
  }

  const member = await getOrCreateMember(memberName)

  await prisma.mealVote.upsert({
    where: {
      mealId_memberId: {
        mealId,
        memberId: member.id,
      },
    },
    update: {
      choice,
      memberName: member.name,
    },
    create: {
      mealId,
      memberId: member.id,
      memberName: member.name,
      choice,
    },
  })

  revalidatePath('/')
}

export async function clearMemberVote(mealId: string, memberName: string) {
  const member = await prisma.householdMember.findFirst({
    where: { name: { equals: memberName.trim(), mode: 'insensitive' } },
  })
  if (!member) return

  await prisma.mealVote.deleteMany({
    where: {
      mealId,
      memberId: member.id,
    },
  })

  revalidatePath('/')
}

export async function randomizeWeeklyVotingDeck(batchSize = 30, clearCurrentWeekVotes = false) {
  const safeBatchSize = Math.max(10, Math.min(100, batchSize))

  if (clearCurrentWeekVotes) {
    await prisma.mealVote.deleteMany({})
  }

  const allMeals = await prisma.meal.findMany({
    select: { id: true, selectedForWeek: true },
  })

  // Reset inCurrentDeck on unselected meals, then randomly pick safeBatchSize meals
  await prisma.meal.updateMany({
    where: { selectedForWeek: false },
    data: { inCurrentDeck: false },
  })

  const unselectedIds = allMeals.filter((m) => !m.selectedForWeek).map((m) => m.id)
  for (let i = unselectedIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[unselectedIds[i], unselectedIds[j]] = [unselectedIds[j], unselectedIds[i]]
  }

  const chosenIds = unselectedIds.slice(0, safeBatchSize)
  if (chosenIds.length > 0) {
    await prisma.meal.updateMany({
      where: {
        OR: [{ id: { in: chosenIds } }, { selectedForWeek: true }],
      },
      data: { inCurrentDeck: true },
    })
  }

  await prisma.householdSettings.upsert({
    where: { id: 'default' },
    update: {
      currentDeckBatchSize: safeBatchSize,
      currentDeckSeed: { increment: 1 },
    },
    create: {
      id: 'default',
      currentDeckBatchSize: safeBatchSize,
      currentDeckSeed: 2,
    },
  })

  revalidatePath('/')
}

export async function toggleMealSelectedForWeek(
  mealId: string,
  selected: boolean,
  plannedDay?: string | null
) {
  await prisma.meal.update({
    where: { id: mealId },
    data: {
      selectedForWeek: selected,
      inCurrentDeck: selected ? true : undefined,
      plannedDay: selected ? plannedDay ?? null : null,
    },
  })

  // Automatically rebuild shopping list so selected meals sync immediately
  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function updateMealSchedule(
  mealId: string,
  plannedDay: string | null,
  portionScale: number
) {
  const safeScale = Math.max(0.5, Math.min(4.0, portionScale))
  await prisma.meal.update({
    where: { id: mealId },
    data: {
      plannedDay,
      portionScale: safeScale,
    },
  })

  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function createCustomHouseholdMeal(input: {
  title: string
  description: string
  cuisine: string
  category: string
  prepMinutes: number
  cookMinutes: number
  emoji: string
  ingredientProductIds: { productId: string; quantity: number; displayQuantity: string }[]
}) {
  const title = input.title.trim()
  if (!title) throw new Error('Meal title is required')

  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    Date.now().toString(36)

  await prisma.meal.create({
    data: {
      slug,
      title,
      description: input.description.trim() || 'Custom household recipe',
      cuisine: input.cuisine.trim() || 'British',
      category: input.category || 'Comfort & Classics',
      prepMinutes: input.prepMinutes || 15,
      cookMinutes: input.cookMinutes || 25,
      emoji: input.emoji || '🍲',
      tags: JSON.stringify(['Custom Family Recipe']),
      inCurrentDeck: true,
      selectedForWeek: true,
      isCustom: true,
      ingredients: {
        create: input.ingredientProductIds.map((ing) => ({
          productId: ing.productId,
          quantity: ing.quantity,
          displayQuantity: ing.displayQuantity,
          isPantry: false,
        })),
      },
    },
  })

  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function updateStapleStatus(
  stapleId: string,
  status: 'OUT' | 'LOW' | 'NEEDED' | 'IN_STOCK',
  quantityPacks?: number
) {
  if (!['OUT', 'LOW', 'NEEDED', 'IN_STOCK'].includes(status)) {
    throw new Error('Invalid staple status')
  }

  await prisma.stapleItem.update({
    where: { id: stapleId },
    data: {
      status,
      quantityPacks: quantityPacks !== undefined ? Math.max(1, quantityPacks) : undefined,
    },
  })

  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function toggleStapleAutoWeekly(stapleId: string, autoNeedWeekly: boolean) {
  await prisma.stapleItem.update({
    where: { id: stapleId },
    data: { autoNeedWeekly },
  })
  revalidatePath('/')
}

export async function addCustomStaple(input: {
  name: string
  aisle: string
  productId?: string
  quantityPacks: number
  autoNeedWeekly: boolean
}) {
  const cleanName = input.name.trim()
  if (!cleanName) return

  await prisma.stapleItem.upsert({
    where: { name: cleanName },
    update: {
      aisle: input.aisle,
      productId: input.productId || null,
      quantityPacks: Math.max(1, input.quantityPacks),
      status: 'NEEDED',
      autoNeedWeekly: input.autoNeedWeekly,
    },
    create: {
      name: cleanName,
      aisle: input.aisle,
      productId: input.productId || null,
      quantityPacks: Math.max(1, input.quantityPacks),
      status: 'NEEDED',
      autoNeedWeekly: input.autoNeedWeekly,
    },
  })

  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function resetWeeklyStaplesToDefault() {
  // Set all autoNeedWeekly staples back to NEEDED for a fresh weekly shop
  await prisma.stapleItem.updateMany({
    where: { autoNeedWeekly: true },
    data: { status: 'NEEDED' },
  })
  await rebuildShoppingListInternal()
  revalidatePath('/')
}

async function rebuildShoppingListInternal() {
  // Preserve existing checked / haveInCupboard state by productId or name
  const existingItems = await prisma.shoppingItem.findMany()
  const existingStateByKey = new Map<string, { checked: boolean; haveInCupboard: boolean }>()
  for (const item of existingItems) {
    const key = item.productId || `name:${item.name.toLowerCase()}`
    existingStateByKey.set(key, {
      checked: item.checked,
      haveInCupboard: item.haveInCupboard,
    })
  }

  // Keep manual one-off items
  const manualItems = existingItems.filter((i) => i.sourceType === 'MANUAL')

  // Fetch selected meals with their ingredients + canonical products
  const selectedMeals = await prisma.meal.findMany({
    where: { selectedForWeek: true },
    include: {
      ingredients: {
        include: { product: true },
      },
    },
  })

  // Fetch needed staples (OUT, LOW, or NEEDED)
  const neededStaples = await prisma.stapleItem.findMany({
    where: {
      status: { in: ['OUT', 'LOW', 'NEEDED'] },
    },
    include: { product: true },
  })

  // Aggregate by CanonicalProduct ID
  interface AggregatedEntry {
    productId: string | null
    name: string
    aisle: string
    defaultUnit: string
    packSize: number
    packLabel: string
    totalQuantity: number
    extraPacksFromStaples: number
    sources: string[]
    sourceTypes: Set<string>
    allPantry: boolean
  }

  const aggMap = new Map<string, AggregatedEntry>()

  for (const meal of selectedMeals) {
    const scale = meal.portionScale || 1.0
    for (const ing of meal.ingredients) {
      const prod = ing.product
      const key = prod.id
      const scaledQty = Math.round(ing.quantity * scale * 10) / 10
      const existing = aggMap.get(key)

      if (existing) {
        existing.totalQuantity += scaledQty
        if (!existing.sources.includes(`${meal.title} (${ing.displayQuantity})`)) {
          existing.sources.push(`${meal.title} (${ing.displayQuantity})`)
        }
        existing.sourceTypes.add('MEAL')
        if (!ing.isPantry) existing.allPantry = false
      } else {
        aggMap.set(key, {
          productId: prod.id,
          name: prod.name,
          aisle: prod.aisle,
          defaultUnit: prod.defaultUnit,
          packSize: prod.packSize,
          packLabel: prod.packLabel,
          totalQuantity: scaledQty,
          extraPacksFromStaples: 0,
          sources: [`${meal.title} (${ing.displayQuantity})`],
          sourceTypes: new Set(['MEAL']),
          allPantry: ing.isPantry,
        })
      }
    }
  }

  for (const staple of neededStaples) {
    const statusLabel =
      staple.status === 'OUT'
        ? 'Ran Out 🔴'
        : staple.status === 'LOW'
        ? 'Running Low 🟡'
        : 'Weekly Staple'

    if (staple.productId && staple.product) {
      const prod = staple.product
      const key = prod.id
      const existing = aggMap.get(key)
      if (existing) {
        existing.extraPacksFromStaples += staple.quantityPacks
        existing.sources.push(`${statusLabel} (${staple.quantityPacks}x)`)
        existing.sourceTypes.add('STAPLE')
        existing.allPantry = false
      } else {
        aggMap.set(key, {
          productId: prod.id,
          name: prod.name,
          aisle: prod.aisle,
          defaultUnit: prod.defaultUnit,
          packSize: prod.packSize,
          packLabel: prod.packLabel,
          totalQuantity: 0,
          extraPacksFromStaples: staple.quantityPacks,
          sources: [`${statusLabel} (${staple.quantityPacks}x)`],
          sourceTypes: new Set(['STAPLE']),
          allPantry: false,
        })
      }
    } else {
      const key = `staple:${staple.name.toLowerCase()}`
      aggMap.set(key, {
        productId: null,
        name: staple.name,
        aisle: staple.aisle,
        defaultUnit: 'pack',
        packSize: 1,
        packLabel: 'pack',
        totalQuantity: 0,
        extraPacksFromStaples: staple.quantityPacks,
        sources: [statusLabel],
        sourceTypes: new Set(['STAPLE']),
        allPantry: false,
      })
    }
  }

  // Delete all non-manual items and insert fresh aggregated list
  await prisma.shoppingItem.deleteMany({
    where: {
      sourceType: { not: 'MANUAL' },
    },
  })

  for (const entry of Array.from(aggMap.values())) {
    const mealPacks =
      entry.totalQuantity > 0 && entry.packSize > 0
        ? Math.ceil(entry.totalQuantity / entry.packSize)
        : 0
    const packsNeeded = Math.max(1, Math.round(mealPacks + entry.extraPacksFromStaples))

    const unitLabel =
      packsNeeded === 1
        ? `1 x ${entry.packLabel}`
        : `${packsNeeded} x ${entry.packLabel}`

    const stateKey = entry.productId || `name:${entry.name.toLowerCase()}`
    const prevState = existingStateByKey.get(stateKey)

    const sourceType =
      entry.sourceTypes.has('MEAL') && entry.sourceTypes.has('STAPLE')
        ? 'MEAL+STAPLE'
        : entry.sourceTypes.has('STAPLE')
        ? 'STAPLE'
        : 'MEAL'

    await prisma.shoppingItem.create({
      data: {
        name: entry.name,
        aisle: entry.aisle,
        productId: entry.productId,
        totalQuantity: entry.totalQuantity || packsNeeded,
        packsNeeded,
        unitLabel,
        sourceNotes: entry.sources.join(' + '),
        sourceType,
        checked: prevState?.checked ?? false,
        haveInCupboard: prevState?.haveInCupboard ?? entry.allPantry,
      },
    })
  }

  // Ensure manual items remain intact
  void manualItems
}

export async function generateShoppingListNow() {
  await rebuildShoppingListInternal()
  revalidatePath('/')
}

export async function toggleShoppingItemChecked(itemId: string, checked: boolean) {
  await prisma.shoppingItem.update({
    where: { id: itemId },
    data: { checked },
  })
  revalidatePath('/')
}

export async function toggleShoppingItemCupboard(itemId: string, haveInCupboard: boolean) {
  await prisma.shoppingItem.update({
    where: { id: itemId },
    data: { haveInCupboard },
  })
  revalidatePath('/')
}

export async function adjustShoppingItemPacks(itemId: string, delta: number) {
  const item = await prisma.shoppingItem.findUnique({
    where: { id: itemId },
    include: { product: true },
  })
  if (!item) return

  const newPacks = Math.max(1, item.packsNeeded + delta)
  const packLabel = item.product?.packLabel || 'pack'
  await prisma.shoppingItem.update({
    where: { id: itemId },
    data: {
      packsNeeded: newPacks,
      unitLabel: `${newPacks} x ${packLabel}`,
    },
  })
  revalidatePath('/')
}

export async function addManualShoppingItem(name: string, aisle: string, packsNeeded = 1) {
  const cleanName = name.trim()
  if (!cleanName) return

  await prisma.shoppingItem.create({
    data: {
      name: cleanName,
      aisle: aisle || 'Household & Breakfast',
      packsNeeded: Math.max(1, packsNeeded),
      totalQuantity: Math.max(1, packsNeeded),
      unitLabel: `${Math.max(1, packsNeeded)} pack`,
      sourceNotes: 'Added manually',
      sourceType: 'MANUAL',
      checked: false,
      haveInCupboard: false,
    },
  })

  revalidatePath('/')
}

export async function deleteShoppingItem(itemId: string) {
  await prisma.shoppingItem.delete({
    where: { id: itemId },
  })
  revalidatePath('/')
}

export async function updateSupermarketPreferences(input: {
  activeSupermarkets: SupermarketId[]
  hasTescoClubcard: boolean
  hasSainsburysNectar: boolean
  hasMorrisonsMore: boolean
  hasLidlPlus: boolean
  splitShopMinSavingsGbp: number
}) {
  const safeStores =
    input.activeSupermarkets.length > 0 ? input.activeSupermarkets : (['aldi', 'tesco'] as SupermarketId[])

  await prisma.householdSettings.upsert({
    where: { id: 'default' },
    update: {
      activeSupermarkets: JSON.stringify(safeStores),
      hasTescoClubcard: input.hasTescoClubcard,
      hasSainsburysNectar: input.hasSainsburysNectar,
      hasMorrisonsMore: input.hasMorrisonsMore,
      hasLidlPlus: input.hasLidlPlus,
      splitShopMinSavingsGbp: Math.max(0, input.splitShopMinSavingsGbp),
    },
    create: {
      id: 'default',
      activeSupermarkets: JSON.stringify(safeStores),
      hasTescoClubcard: input.hasTescoClubcard,
      hasSainsburysNectar: input.hasSainsburysNectar,
      hasMorrisonsMore: input.hasMorrisonsMore,
      hasLidlPlus: input.hasLidlPlus,
      splitShopMinSavingsGbp: Math.max(0, input.splitShopMinSavingsGbp),
    },
  })

  revalidatePath('/')
}
