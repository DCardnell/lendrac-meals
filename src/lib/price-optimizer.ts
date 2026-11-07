import { SupermarketId, UK_SUPERMARKETS, StorePriceMap } from './uk-catalog'

export interface BasketItemInput {
  id: string
  name: string
  aisle: string
  packsNeeded: number
  unitLabel: string
  sourceNotes: string
  haveInCupboard: boolean
  checked: boolean
  storePricesJson?: string | null
}

export interface LoyaltySettingsInput {
  activeSupermarkets: SupermarketId[]
  hasTescoClubcard: boolean
  hasSainsburysNectar: boolean
  hasMorrisonsMore: boolean
  hasLidlPlus: boolean
  splitShopMinSavingsGbp: number
}

export interface SingleStoreResult {
  storeId: SupermarketId
  storeName: string
  shortName: string
  color: string
  totalCost: number
  baseWithoutLoyaltyCost: number
  loyaltySavings: number
  missingItemCount: number
  missingItemNames: string[]
  itemBreakdown: {
    itemId: string
    name: string
    packs: number
    unitPrice: number
    lineTotal: number
    usedLoyalty: boolean
    stocked: boolean
  }[]
}

export interface SplitStoreResult {
  storeA: SupermarketId
  storeAName: string
  storeAColor: string
  storeB: SupermarketId
  storeBName: string
  storeBColor: string
  combinedTotal: number
  savingsVsBestSingle: number
  isWorthSecondStop: boolean
  storeAItems: {
    itemId: string
    name: string
    aisle: string
    packs: number
    unitLabel: string
    lineTotal: number
    savedVsOther: number
  }[]
  storeBItems: {
    itemId: string
    name: string
    aisle: string
    packs: number
    unitLabel: string
    lineTotal: number
    savedVsOther: number
    reason: 'cheaper' | 'only-stocked-here'
  }[]
}

export interface BasketComparisonSummary {
  activeItemCount: number
  singleStoreRankings: SingleStoreResult[]
  bestSingleStore: SingleStoreResult | null
  bestSplitCombo: SplitStoreResult | null
  allSplitCombos: SplitStoreResult[]
}

function getEffectiveStorePrice(
  prices: StorePriceMap | null,
  storeId: SupermarketId,
  settings: LoyaltySettingsInput
): { price: number; basePrice: number; usedLoyalty: boolean; stocked: boolean } {
  if (!prices || !prices[storeId]) {
    // Fallback estimate for custom manual items without a canonical product
    const defaultManual = 2.0
    return { price: defaultManual, basePrice: defaultManual, usedLoyalty: false, stocked: true }
  }

  const entry = prices[storeId]
  const stocked = entry.stocked !== false
  const basePrice = entry.base

  let useLoyalty = false
  if (entry.loyalty !== undefined) {
    if (storeId === 'tesco' && settings.hasTescoClubcard) useLoyalty = true
    if (storeId === 'sainsburys' && settings.hasSainsburysNectar) useLoyalty = true
    if (storeId === 'morrisons' && settings.hasMorrisonsMore) useLoyalty = true
    if (storeId === 'lidl' && settings.hasLidlPlus) useLoyalty = true
  }

  const effective = useLoyalty && entry.loyalty !== undefined ? entry.loyalty : basePrice
  return { price: effective, basePrice, usedLoyalty: useLoyalty, stocked }
}

export function calculateUKBasketOptimization(
  items: BasketItemInput[],
  settings: LoyaltySettingsInput
): BasketComparisonSummary {
  const activeItems = items.filter((i) => !i.haveInCupboard && i.packsNeeded > 0)
  const activeStores = UK_SUPERMARKETS.filter((s) => settings.activeSupermarkets.includes(s.id))

  if (activeItems.length === 0 || activeStores.length === 0) {
    return {
      activeItemCount: activeItems.length,
      singleStoreRankings: [],
      bestSingleStore: null,
      bestSplitCombo: null,
      allSplitCombos: [],
    }
  }

  // Parse store prices once per item
  const parsedItems = activeItems.map((item) => {
    let priceMap: StorePriceMap | null = null
    if (item.storePricesJson) {
      try {
        priceMap = JSON.parse(item.storePricesJson)
      } catch {
        priceMap = null
      }
    }
    return { item, priceMap }
  })

  // 1. Evaluate each single supermarket
  const singleResults: SingleStoreResult[] = activeStores.map((store) => {
    let totalCost = 0
    let baseWithoutLoyaltyCost = 0
    const missingItemNames: string[] = []
    const itemBreakdown: SingleStoreResult['itemBreakdown'] = []

    for (const { item, priceMap } of parsedItems) {
      const { price, basePrice, usedLoyalty, stocked } = getEffectiveStorePrice(
        priceMap,
        store.id,
        settings
      )
      const lineTotal = Math.round(price * item.packsNeeded * 100) / 100
      const baseLineTotal = Math.round(basePrice * item.packsNeeded * 100) / 100

      totalCost += lineTotal
      baseWithoutLoyaltyCost += baseLineTotal
      if (!stocked) {
        missingItemNames.push(item.name)
      }

      itemBreakdown.push({
        itemId: item.id,
        name: item.name,
        packs: item.packsNeeded,
        unitPrice: price,
        lineTotal,
        usedLoyalty,
        stocked,
      })
    }

    totalCost = Math.round(totalCost * 100) / 100
    baseWithoutLoyaltyCost = Math.round(baseWithoutLoyaltyCost * 100) / 100
    const loyaltySavings = Math.max(0, Math.round((baseWithoutLoyaltyCost - totalCost) * 100) / 100)

    return {
      storeId: store.id,
      storeName: store.name,
      shortName: store.shortName,
      color: store.color,
      totalCost,
      baseWithoutLoyaltyCost,
      loyaltySavings,
      missingItemCount: missingItemNames.length,
      missingItemNames,
      itemBreakdown,
    }
  })

  // Sort single stores: prefer stores that stock everything (or fewer missing), then lowest total cost
  singleResults.sort((a, b) => a.totalCost - b.totalCost)
  const bestSingleStore = singleResults[0] || null

  // 2. Evaluate all 2-Store Split Combinations (Store A + Store B)
  const splitCombos: SplitStoreResult[] = []
  for (let i = 0; i < activeStores.length; i++) {
    for (let j = i + 1; j < activeStores.length; j++) {
      const storeA = activeStores[i]
      const storeB = activeStores[j]

      let combinedTotal = 0
      const storeAItems: SplitStoreResult['storeAItems'] = []
      const storeBItems: SplitStoreResult['storeBItems'] = []

      for (const { item, priceMap } of parsedItems) {
        const evalA = getEffectiveStorePrice(priceMap, storeA.id, settings)
        const evalB = getEffectiveStorePrice(priceMap, storeB.id, settings)

        const costA = Math.round(evalA.price * item.packsNeeded * 100) / 100
        const costB = Math.round(evalB.price * item.packsNeeded * 100) / 100

        // If Store A doesn't stock a specialty item (e.g., Aldi missing Gochujang) and Store B does, assign to Store B
        if (!evalA.stocked && evalB.stocked) {
          combinedTotal += costB
          storeBItems.push({
            itemId: item.id,
            name: item.name,
            aisle: item.aisle,
            packs: item.packsNeeded,
            unitLabel: item.unitLabel,
            lineTotal: costB,
            savedVsOther: Math.max(0, Math.round((costA - costB) * 100) / 100),
            reason: 'only-stocked-here',
          })
        } else if (evalA.stocked && !evalB.stocked) {
          combinedTotal += costA
          storeAItems.push({
            itemId: item.id,
            name: item.name,
            aisle: item.aisle,
            packs: item.packsNeeded,
            unitLabel: item.unitLabel,
            lineTotal: costA,
            savedVsOther: Math.max(0, Math.round((costB - costA) * 100) / 100),
          })
        } else if (costA <= costB) {
          combinedTotal += costA
          storeAItems.push({
            itemId: item.id,
            name: item.name,
            aisle: item.aisle,
            packs: item.packsNeeded,
            unitLabel: item.unitLabel,
            lineTotal: costA,
            savedVsOther: Math.round((costB - costA) * 100) / 100,
          })
        } else {
          combinedTotal += costB
          storeBItems.push({
            itemId: item.id,
            name: item.name,
            aisle: item.aisle,
            packs: item.packsNeeded,
            unitLabel: item.unitLabel,
            lineTotal: costB,
            savedVsOther: Math.round((costA - costB) * 100) / 100,
            reason: 'cheaper',
          })
        }
      }

      combinedTotal = Math.round(combinedTotal * 100) / 100
      const savingsVsBestSingle = bestSingleStore
        ? Math.max(0, Math.round((bestSingleStore.totalCost - combinedTotal) * 100) / 100)
        : 0

      if (storeAItems.length > 0 && storeBItems.length > 0) {
        splitCombos.push({
          storeA: storeA.id,
          storeAName: storeA.name,
          storeAColor: storeA.color,
          storeB: storeB.id,
          storeBName: storeB.name,
          storeBColor: storeB.color,
          combinedTotal,
          savingsVsBestSingle,
          isWorthSecondStop: savingsVsBestSingle >= settings.splitShopMinSavingsGbp,
          storeAItems,
          storeBItems,
        })
      }
    }
  }

  splitCombos.sort((a, b) => a.combinedTotal - b.combinedTotal)

  return {
    activeItemCount: activeItems.length,
    singleStoreRankings: singleResults,
    bestSingleStore,
    bestSplitCombo: splitCombos[0] || null,
    allSplitCombos: splitCombos.slice(0, 6),
  }
}
