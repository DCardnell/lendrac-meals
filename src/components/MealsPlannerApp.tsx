'use client'

import React, { useState, useEffect, useMemo, useTransition } from 'react'
import styles from './MealsPlannerApp.module.css'
import {
  UK_SUPERMARKETS,
  SupermarketId,
} from '@/lib/uk-catalog'
import {
  calculateUKBasketOptimization,
} from '@/lib/price-optimizer'
import {
  getOrCreateMember,
  castMealVote,
  clearMemberVote,
  randomizeWeeklyVotingDeck,
  toggleMealSelectedForWeek,
  updateMealSchedule,
  createCustomHouseholdMeal,
  updateStapleStatus,
  toggleStapleAutoWeekly,
  addCustomStaple,
  resetWeeklyStaplesToDefault,
  generateShoppingListNow,
  toggleShoppingItemChecked,
  toggleShoppingItemCupboard,
  adjustShoppingItemPacks,
  addManualShoppingItem,
  deleteShoppingItem,
  updateSupermarketPreferences,
} from '@/app/actions'

export interface ClientVote {
  id: string
  mealId: string
  memberId: string
  memberName: string
  choice: 'YES' | 'NOT_THIS_WEEK' | 'NO'
}

export interface ClientMealIngredient {
  id: string
  productId: string
  productName: string
  aisle: string
  quantity: number
  displayQuantity: string
  isPantry: boolean
}

export interface ClientMeal {
  id: string
  slug: string
  title: string
  description: string
  cuisine: string
  category: string
  prepMinutes: number
  cookMinutes: number
  servings: number
  emoji: string
  tags: string[]
  inCurrentDeck: boolean
  selectedForWeek: boolean
  plannedDay: string | null
  portionScale: number
  isCustom: boolean
  ingredients: ClientMealIngredient[]
  votes: ClientVote[]
}

export interface ClientStaple {
  id: string
  name: string
  aisle: string
  productId: string | null
  packLabel: string
  quantityPacks: number
  status: 'OUT' | 'LOW' | 'NEEDED' | 'IN_STOCK'
  autoNeedWeekly: boolean
}

export interface ClientShoppingItem {
  id: string
  name: string
  aisle: string
  productId: string | null
  totalQuantity: number
  packsNeeded: number
  unitLabel: string
  sourceNotes: string
  sourceType: string
  checked: boolean
  haveInCupboard: boolean
  storePricesJson: string | null
}

export interface ClientProductOption {
  id: string
  name: string
  aisle: string
  packLabel: string
  defaultUnit: string
  packSize: number
}

export interface ClientMember {
  id: string
  name: string
  color: string
}

export interface ClientSettings {
  activeSupermarkets: SupermarketId[]
  hasTescoClubcard: boolean
  hasSainsburysNectar: boolean
  hasMorrisonsMore: boolean
  hasLidlPlus: boolean
  splitShopMinSavingsGbp: number
  currentDeckBatchSize: number
  currentDeckSeed: number
}

interface Props {
  initialMeals: ClientMeal[]
  initialMembers: ClientMember[]
  initialStaples: ClientStaple[]
  initialShoppingItems: ClientShoppingItem[]
  initialSettings: ClientSettings
  productCatalog: ClientProductOption[]
}

const DAYS_OF_WEEK = ['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const AISLE_ORDER = [
  'Produce',
  'Meat & Fish',
  'Dairy & Chilled',
  'Bakery',
  'Tins & Dry Goods',
  'Frozen',
  'Household & Breakfast',
]

export function MealsPlannerApp({
  initialMeals,
  initialMembers,
  initialStaples,
  initialShoppingItems,
  initialSettings,
  productCatalog,
}: Props) {
  const [activeTab, setActiveTab] = useState<'vote' | 'plan' | 'staples' | 'shop'>('vote')
  const [isPending, startTransition] = useTransition()

  // Household member identity (stored in localStorage for frictionless phone voting)
  const [currentMemberName, setCurrentMemberName] = useState<string>('')
  const [nameInput, setNameInput] = useState<string>('')
  const [showNameModal, setShowNameModal] = useState<boolean>(false)

  // Voting UI state
  const [voteViewMode, setVoteViewMode] = useState<'cards' | 'list'>('cards')
  const [voteScope, setVoteScope] = useState<'deck' | 'all'>('deck')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [deckBatchInput, setDeckBatchInput] = useState<number>(
    initialSettings.currentDeckBatchSize || 30
  )
  const [cardCursorIndex, setCardCursorIndex] = useState<number>(0)

  // Planner UI state
  const [planFilter, setPlanFilter] = useState<'ranked' | 'selected' | 'all'>('ranked')
  const [showAddMealModal, setShowAddMealModal] = useState<boolean>(false)
  const [newMealTitle, setNewMealTitle] = useState('')
  const [newMealDesc, setNewMealDesc] = useState('')
  const [newMealCuisine, setNewMealCuisine] = useState('British')
  const [newMealCategory, setNewMealCategory] = useState('Comfort & Classics')
  const [newMealEmoji, setNewMealEmoji] = useState('🍲')
  const [selectedNewIngs, setSelectedNewIngs] = useState<
    { productId: string; quantity: number; displayQuantity: string }[]
  >([])

  // Staples UI state
  const [stapleSearch, setStapleSearch] = useState('')
  const [newStapleName, setNewStapleName] = useState('')
  const [newStapleAisle, setNewStapleAisle] = useState('Dairy & Chilled')
  const [newStapleProductId, setNewStapleProductId] = useState('')

  // Shopping & UK Supermarket Optimizer UI state
  const [manualItemName, setManualItemName] = useState('')
  const [manualItemAisle, setManualItemAisle] = useState('Household & Breakfast')
  const [shopListFilterStore, setShopListFilterStore] = useState<'ALL' | 'SPLIT_A' | 'SPLIT_B'>('ALL')
  const [showStoreConfig, setShowStoreConfig] = useState(false)

  // Load saved member name on mount
  useEffect(() => {
    const saved = window.localStorage.getItem('lendrac_meals_member_name')
    if (saved && saved.trim()) {
      setCurrentMemberName(saved.trim())
    } else {
      setShowNameModal(true)
    }
  }, [])

  const handleSelectMemberName = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    setCurrentMemberName(clean)
    window.localStorage.setItem('lendrac_meals_member_name', clean)
    setShowNameModal(false)
    startTransition(async () => {
      await getOrCreateMember(clean)
    })
  }

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const m of initialMeals) set.add(m.category)
    return ['ALL', ...Array.from(set)]
  }, [initialMeals])

  // Filtered meals for voting
  const votingMeals = useMemo(() => {
    return initialMeals.filter((m) => {
      if (voteScope === 'deck' && !m.inCurrentDeck) return false
      if (categoryFilter !== 'ALL' && m.category !== categoryFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = m.title.toLowerCase().includes(q)
        const matchCuisine = m.cuisine.toLowerCase().includes(q)
        const matchDesc = m.description.toLowerCase().includes(q)
        const matchIng = m.ingredients.some((i) => i.productName.toLowerCase().includes(q))
        if (!matchTitle && !matchCuisine && !matchDesc && !matchIng) return false
      }
      return true
    })
  }, [initialMeals, voteScope, categoryFilter, searchQuery])

  // Unvoted meals for the current person in Card Stack mode
  const unvotedMealsForMember = useMemo(() => {
    if (!currentMemberName) return votingMeals
    return votingMeals.filter(
      (m) =>
        !m.votes.some(
          (v) => v.memberName.toLowerCase() === currentMemberName.toLowerCase()
        )
    )
  }, [votingMeals, currentMemberName])

  const myVotedStats = useMemo(() => {
    let yes = 0
    let later = 0
    let no = 0
    if (!currentMemberName) return { yes, later, no, total: 0 }
    for (const m of votingMeals) {
      const myVote = m.votes.find(
        (v) => v.memberName.toLowerCase() === currentMemberName.toLowerCase()
      )
      if (myVote?.choice === 'YES') yes++
      else if (myVote?.choice === 'NOT_THIS_WEEK') later++
      else if (myVote?.choice === 'NO') no++
    }
    return { yes, later, no, total: yes + later + no }
  }, [votingMeals, currentMemberName])

  // Score and rank meals for the Planner tab
  const scoredMeals = useMemo(() => {
    return initialMeals
      .map((m) => {
        let score = 0
        let yesCount = 0
        let laterCount = 0
        let noCount = 0
        for (const v of m.votes) {
          if (v.choice === 'YES') {
            score += 2
            yesCount++
          } else if (v.choice === 'NOT_THIS_WEEK') {
            score += 0.5
            laterCount++
          } else if (v.choice === 'NO') {
            score -= 2
            noCount++
          }
        }
        return {
          ...m,
          score,
          yesCount,
          laterCount,
          noCount,
        }
      })
      .sort((a, b) => {
        if (a.selectedForWeek !== b.selectedForWeek) {
          return a.selectedForWeek ? -1 : 1
        }
        if (b.score !== a.score) return b.score - a.score
        if (b.yesCount !== a.yesCount) return b.yesCount - a.yesCount
        return a.title.localeCompare(b.title)
      })
  }, [initialMeals])

  const selectedMealsForWeek = useMemo(
    () => scoredMeals.filter((m) => m.selectedForWeek),
    [scoredMeals]
  )

  const filteredPlannerMeals = useMemo(() => {
    return scoredMeals.filter((m) => {
      if (planFilter === 'selected') return m.selectedForWeek
      if (planFilter === 'ranked') return m.votes.length > 0 || m.selectedForWeek || m.inCurrentDeck
      return true
    })
  }, [scoredMeals, planFilter])

  // Calculate UK Supermarket Basket Comparison
  const basketComparison = useMemo(() => {
    return calculateUKBasketOptimization(initialShoppingItems, {
      activeSupermarkets: initialSettings.activeSupermarkets,
      hasTescoClubcard: initialSettings.hasTescoClubcard,
      hasSainsburysNectar: initialSettings.hasSainsburysNectar,
      hasMorrisonsMore: initialSettings.hasMorrisonsMore,
      hasLidlPlus: initialSettings.hasLidlPlus,
      splitShopMinSavingsGbp: initialSettings.splitShopMinSavingsGbp,
    })
  }, [initialShoppingItems, initialSettings])

  // Group shopping items by aisle
  const groupedShoppingItems = useMemo(() => {
    const splitAIds = new Set(
      basketComparison.bestSplitCombo?.storeAItems.map((i) => i.itemId) || []
    )
    const splitBIds = new Set(
      basketComparison.bestSplitCombo?.storeBItems.map((i) => i.itemId) || []
    )

    const filtered = initialShoppingItems.filter((item) => {
      if (shopListFilterStore === 'SPLIT_A') return splitAIds.has(item.id)
      if (shopListFilterStore === 'SPLIT_B') return splitBIds.has(item.id)
      return true
    })

    const map = new Map<string, ClientShoppingItem[]>()
    for (const aisle of AISLE_ORDER) {
      map.set(aisle, [])
    }
    for (const item of filtered) {
      const list = map.get(item.aisle) || []
      list.push(item)
      map.set(item.aisle, list)
    }
    return Array.from(map.entries()).filter(([, list]) => list.length > 0)
  }, [initialShoppingItems, shopListFilterStore, basketComparison.bestSplitCombo])

  const handleVote = (mealId: string, choice: 'YES' | 'NOT_THIS_WEEK' | 'NO') => {
    if (!currentMemberName) {
      setShowNameModal(true)
      return
    }
    startTransition(async () => {
      await castMealVote(mealId, currentMemberName, choice)
    })
  }

  const handleToggleStore = (storeId: SupermarketId) => {
    const current = initialSettings.activeSupermarkets
    const next = current.includes(storeId)
      ? current.filter((id) => id !== storeId)
      : [...current, storeId]
    if (next.length === 0) return

    startTransition(async () => {
      await updateSupermarketPreferences({
        ...initialSettings,
        activeSupermarkets: next,
      })
    })
  }

  const handleToggleLoyalty = (
    key: 'hasTescoClubcard' | 'hasSainsburysNectar' | 'hasMorrisonsMore' | 'hasLidlPlus'
  ) => {
    startTransition(async () => {
      await updateSupermarketPreferences({
        ...initialSettings,
        [key]: !initialSettings[key],
      })
    })
  }

  const currentCardMeal =
    unvotedMealsForMember[cardCursorIndex % Math.max(1, unvotedMealsForMember.length)] || null

  const neededStaplesCount = initialStaples.filter((s) => s.status !== 'IN_STOCK').length
  const activeShoppingCount = initialShoppingItems.filter(
    (i) => !i.haveInCupboard && !i.checked
  ).length

  return (
    <div className={styles.shell}>
      {/* TOP BAR */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.lcarsPill} />
          <div>
            <h1>SYS-OPS // MEALS</h1>
            <p className={styles.subtitle}>
              UK Household Meal Voter, Staples &amp; Supermarket Basket Optimizer
            </p>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.memberBadge}
            onClick={() => {
              setNameInput(currentMemberName)
              setShowNameModal(true)
            }}
          >
            <span className={styles.memberDot} />
            <span>
              {currentMemberName ? `VOTING AS: ${currentMemberName.toUpperCase()}` : 'SET YOUR NAME'}
            </span>
            <span className={styles.switchHint}>Switch</span>
          </button>
        </div>
      </header>

      {/* DESKTOP & MOBILE NAVIGATION TABS */}
      <nav className={styles.navBar}>
        <button
          type="button"
          className={`${styles.navTab} ${activeTab === 'vote' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('vote')}
        >
          <span className={styles.navIcon}>🗳️</span>
          <span className={styles.navLabel}>1. Vote Meals</span>
          <span className={styles.navBadge}>{votingMeals.length}</span>
        </button>

        <button
          type="button"
          className={`${styles.navTab} ${activeTab === 'plan' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          <span className={styles.navIcon}>📅</span>
          <span className={styles.navLabel}>2. Pick Week</span>
          <span className={styles.navBadge}>{selectedMealsForWeek.length}</span>
        </button>

        <button
          type="button"
          className={`${styles.navTab} ${activeTab === 'staples' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('staples')}
        >
          <span className={styles.navIcon}>🥛</span>
          <span className={styles.navLabel}>3. Weekly Staples</span>
          <span className={styles.navBadge}>{neededStaplesCount}</span>
        </button>

        <button
          type="button"
          className={`${styles.navTab} ${activeTab === 'shop' ? styles.navTabActive : ''}`}
          onClick={() => setActiveTab('shop')}
        >
          <span className={styles.navIcon}>🛒</span>
          <span className={styles.navLabel}>4. Shop &amp; UK Prices</span>
          <span className={styles.navBadge}>{activeShoppingCount}</span>
        </button>
      </nav>

      {/* ======================================================== */}
      {/* TAB 1: MOBILE-FIRST HOUSEHOLD MEAL VOTING                */}
      {/* ======================================================== */}
      {activeTab === 'vote' && (
        <section className={styles.section}>
          <div className={styles.toolbarCard}>
            <div className={styles.toolbarRow}>
              <div className={styles.modeToggleGroup}>
                <button
                  type="button"
                  className={`${styles.pillBtn} ${voteViewMode === 'cards' ? styles.pillBtnActive : ''}`}
                  onClick={() => setVoteViewMode('cards')}
                >
                  📱 Quick Swipe Cards ({unvotedMealsForMember.length} left)
                </button>
                <button
                  type="button"
                  className={`${styles.pillBtn} ${voteViewMode === 'list' ? styles.pillBtnActive : ''}`}
                  onClick={() => setVoteViewMode('list')}
                >
                  📋 Browse &amp; Change Votes ({votingMeals.length})
                </button>
              </div>

              <div className={styles.deckControls}>
                <button
                  type="button"
                  className={`${styles.scopeBtn} ${voteScope === 'deck' ? styles.scopeBtnActive : ''}`}
                  onClick={() => setVoteScope('deck')}
                >
                  🎲 Weekly Shortlist ({initialMeals.filter((m) => m.inCurrentDeck).length})
                </button>
                <button
                  type="button"
                  className={`${styles.scopeBtn} ${voteScope === 'all' ? styles.scopeBtnActive : ''}`}
                  onClick={() => setVoteScope('all')}
                >
                  📚 Full UK Library ({initialMeals.length})
                </button>
                <div className={styles.shuffleBox}>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    value={deckBatchInput}
                    onChange={(e) => setDeckBatchInput(Number(e.target.value) || 30)}
                    className={styles.batchNumberInput}
                    title="Number of random meals to draw"
                  />
                  <button
                    type="button"
                    className={styles.actionBtnOrange}
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        await randomizeWeeklyVotingDeck(deckBatchInput, false)
                        setCardCursorIndex(0)
                      })
                    }}
                  >
                    🔀 Shuffle {deckBatchInput} New Options
                  </button>
                </div>
              </div>
            </div>

            {/* Category & Search Filters */}
            <div className={styles.filterStrip}>
              <input
                type="search"
                placeholder="Search 215+ meals by dish, cuisine or ingredient (e.g. halloumi, chorizo, katsu)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
              <div className={styles.categoryScroll}>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`${styles.catChip} ${categoryFilter === cat ? styles.catChipActive : ''}`}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Progress Bar for Current Member */}
            <div className={styles.voteProgressRow}>
              <span>
                <strong>{currentMemberName || 'Guest'}</strong>’s votes in view:{' '}
                <span className={styles.statYes}>✅ {myVotedStats.yes} Yes</span> ·{' '}
                <span className={styles.statLater}>⏳ {myVotedStats.later} Not This Week</span> ·{' '}
                <span className={styles.statNo}>❌ {myVotedStats.no} No</span>
              </span>
              <span>
                {myVotedStats.total} / {votingMeals.length} voted
              </span>
            </div>
          </div>

          {/* CARD STACK SWIPE MODE (Ideal for Phones) */}
          {voteViewMode === 'cards' ? (
            <div className={styles.cardStage}>
              {currentCardMeal ? (
                <div className={styles.swipeCard}>
                  <div className={styles.swipeCardHeader}>
                    <span className={styles.mealEmojiLarge}>{currentCardMeal.emoji}</span>
                    <div className={styles.swipeCardBadges}>
                      <span className={styles.cuisineBadge}>{currentCardMeal.cuisine}</span>
                      <span className={styles.categoryBadge}>{currentCardMeal.category}</span>
                      <span className={styles.timeBadge}>
                        ⏱️ {currentCardMeal.prepMinutes + currentCardMeal.cookMinutes} mins
                      </span>
                    </div>
                  </div>

                  <h2 className={styles.swipeCardTitle}>{currentCardMeal.title}</h2>
                  <p className={styles.swipeCardDesc}>{currentCardMeal.description}</p>

                  <div className={styles.ingredientPillsWrap}>
                    <span className={styles.ingHeaderLabel}>Key Ingredients:</span>
                    <div className={styles.ingredientPills}>
                      {currentCardMeal.ingredients.map((ing) => (
                        <span key={ing.id} className={styles.ingPill}>
                          {ing.productName} ({ing.displayQuantity})
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Other household members who already voted on this card */}
                  {currentCardMeal.votes.length > 0 && (
                    <div className={styles.existingVotesRow}>
                      <span className={styles.ingHeaderLabel}>Household Votes:</span>
                      {currentCardMeal.votes.map((v) => (
                        <span
                          key={v.id}
                          className={`${styles.memberVoteChip} ${
                            v.choice === 'YES'
                              ? styles.voteChipYes
                              : v.choice === 'NOT_THIS_WEEK'
                              ? styles.voteChipLater
                              : styles.voteChipNo
                          }`}
                        >
                          {v.memberName}:{' '}
                          {v.choice === 'YES'
                            ? '✅ Yes'
                            : v.choice === 'NOT_THIS_WEEK'
                            ? '⏳ Not This Week'
                            : '❌ No'}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Big 3-Button Mobile Action Bar */}
                  <div className={styles.bigVoteButtons}>
                    <button
                      type="button"
                      className={styles.bigVoteNo}
                      disabled={isPending}
                      onClick={() => handleVote(currentCardMeal.id, 'NO')}
                    >
                      <span className={styles.bigVoteIcon}>❌</span>
                      <span className={styles.bigVoteMain}>NO</span>
                      <span className={styles.bigVoteSub}>Not a fan</span>
                    </button>

                    <button
                      type="button"
                      className={styles.bigVoteLater}
                      disabled={isPending}
                      onClick={() => handleVote(currentCardMeal.id, 'NOT_THIS_WEEK')}
                    >
                      <span className={styles.bigVoteIcon}>⏳</span>
                      <span className={styles.bigVoteMain}>NOT THIS WEEK</span>
                      <span className={styles.bigVoteSub}>Like it, save for later</span>
                    </button>

                    <button
                      type="button"
                      className={styles.bigVoteYes}
                      disabled={isPending}
                      onClick={() => handleVote(currentCardMeal.id, 'YES')}
                    >
                      <span className={styles.bigVoteIcon}>✅</span>
                      <span className={styles.bigVoteMain}>YES PLEASE!</span>
                      <span className={styles.bigVoteSub}>Want this week</span>
                    </button>
                  </div>

                  <div className={styles.cardSkipRow}>
                    <button
                      type="button"
                      className={styles.skipCardBtn}
                      onClick={() => setCardCursorIndex((c) => c + 1)}
                    >
                      Skip card for now →
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyDeckBox}>
                  <h3>🎉 You’ve voted on every meal in this shortlist!</h3>
                  <p>
                    You can switch to <strong>Browse &amp; Change Votes</strong> to review your picks,
                    shuffle a fresh batch of random meals from the 215+ recipe library, or head to{' '}
                    <strong>2. Pick Week</strong> to lock in this week’s menu.
                  </p>
                  <div className={styles.emptyDeckActions}>
                    <button
                      type="button"
                      className={styles.actionBtnCyan}
                      onClick={() => setVoteViewMode('list')}
                    >
                      📋 Review All Votes
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtnOrange}
                      onClick={() => {
                        startTransition(async () => {
                          await randomizeWeeklyVotingDeck(deckBatchInput, false)
                        })
                      }}
                    >
                      🔀 Draw {deckBatchInput} Fresh Random Meals
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* LIST / GRID BROWSE MODE */
            <div className={styles.mealGrid}>
              {votingMeals.map((meal) => {
                const myVote = meal.votes.find(
                  (v) => v.memberName.toLowerCase() === currentMemberName.toLowerCase()
                )
                return (
                  <div
                    key={meal.id}
                    className={`${styles.mealCard} ${
                      meal.selectedForWeek ? styles.mealCardSelected : ''
                    }`}
                  >
                    <div className={styles.mealCardTop}>
                      <div className={styles.mealTitleGroup}>
                        <span className={styles.mealEmoji}>{meal.emoji}</span>
                        <div>
                          <h4>{meal.title}</h4>
                          <span className={styles.mealMeta}>
                            {meal.cuisine} · {meal.category} · ⏱️ {meal.prepMinutes + meal.cookMinutes}m
                          </span>
                        </div>
                      </div>
                      {meal.selectedForWeek && (
                        <span className={styles.selectedPill}>SELECTED</span>
                      )}
                    </div>

                    <p className={styles.mealDescCompact}>{meal.description}</p>

                    <div className={styles.compactIngList}>
                      {meal.ingredients.map((i) => (
                        <span key={i.id} className={styles.ingChipSmall}>
                          {i.productName}
                        </span>
                      ))}
                    </div>

                    {/* Household Votes Badges */}
                    {meal.votes.length > 0 && (
                      <div className={styles.cardVoteSummary}>
                        {meal.votes.map((v) => (
                          <span
                            key={v.id}
                            className={`${styles.memberVoteChip} ${
                              v.choice === 'YES'
                                ? styles.voteChipYes
                                : v.choice === 'NOT_THIS_WEEK'
                                ? styles.voteChipLater
                                : styles.voteChipNo
                            }`}
                          >
                            {v.memberName}:{' '}
                            {v.choice === 'YES' ? '✅' : v.choice === 'NOT_THIS_WEEK' ? '⏳' : '❌'}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 3-Choice Buttons */}
                    <div className={styles.compactVoteRow}>
                      <button
                        type="button"
                        className={`${styles.compactVoteBtn} ${
                          myVote?.choice === 'YES' ? styles.compactVoteYesActive : ''
                        }`}
                        onClick={() =>
                          myVote?.choice === 'YES'
                            ? startTransition(() => clearMemberVote(meal.id, currentMemberName))
                            : handleVote(meal.id, 'YES')
                        }
                      >
                        ✅ Yes
                      </button>
                      <button
                        type="button"
                        className={`${styles.compactVoteBtn} ${
                          myVote?.choice === 'NOT_THIS_WEEK' ? styles.compactVoteLaterActive : ''
                        }`}
                        onClick={() =>
                          myVote?.choice === 'NOT_THIS_WEEK'
                            ? startTransition(() => clearMemberVote(meal.id, currentMemberName))
                            : handleVote(meal.id, 'NOT_THIS_WEEK')
                        }
                      >
                        ⏳ Not This Wk
                      </button>
                      <button
                        type="button"
                        className={`${styles.compactVoteBtn} ${
                          myVote?.choice === 'NO' ? styles.compactVoteNoActive : ''
                        }`}
                        onClick={() =>
                          myVote?.choice === 'NO'
                            ? startTransition(() => clearMemberVote(meal.id, currentMemberName))
                            : handleVote(meal.id, 'NO')
                        }
                      >
                        ❌ No
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ======================================================== */}
      {/* TAB 2: WEEKLY MEAL PLANNER & CONSENSUS SELECTOR          */}
      {/* ======================================================== */}
      {activeTab === 'plan' && (
        <section className={styles.section}>
          <div className={styles.toolbarCard}>
            <div className={styles.toolbarRow}>
              <div>
                <h2 className={styles.sectionHeading}>
                  📅 Weekly Household Menu ({selectedMealsForWeek.length} Meals Selected)
                </h2>
                <p className={styles.sectionSub}>
                  Meals are ranked by household votes (✅ Yes = +2, ⏳ Not This Week = +0.5, ❌ No =
                  -2). Selecting a meal automatically merges its ingredients into your shopping list!
                </p>
              </div>
              <div className={styles.planTopActions}>
                <button
                  type="button"
                  className={styles.actionBtnCyan}
                  onClick={() => setShowAddMealModal(true)}
                >
                  ➕ Add Custom Family Recipe
                </button>
                <button
                  type="button"
                  className={styles.actionBtnOrange}
                  onClick={() => setActiveTab('shop')}
                >
                  🛒 View Shopping List &amp; Prices →
                </button>
              </div>
            </div>

            {/* Selected This Week Strip */}
            {selectedMealsForWeek.length > 0 && (
              <div className={styles.selectedWeekStrip}>
                {selectedMealsForWeek.map((m) => (
                  <div key={m.id} className={styles.selectedMealCard}>
                    <div className={styles.selectedMealInfo}>
                      <span className={styles.mealEmoji}>{m.emoji}</span>
                      <div>
                        <strong>{m.title}</strong>
                        <div className={styles.selectedMealControls}>
                          <label>
                            Day:{' '}
                            <select
                              value={m.plannedDay || 'Any'}
                              onChange={(e) => {
                                const val = e.target.value === 'Any' ? null : e.target.value
                                startTransition(() =>
                                  updateMealSchedule(m.id, val, m.portionScale)
                                )
                              }}
                              className={styles.miniSelect}
                            >
                              {DAYS_OF_WEEK.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Portions:{' '}
                            <select
                              value={String(m.portionScale)}
                              onChange={(e) => {
                                startTransition(() =>
                                  updateMealSchedule(
                                    m.id,
                                    m.plannedDay,
                                    parseFloat(e.target.value)
                                  )
                                )
                              }}
                              className={styles.miniSelect}
                            >
                              <option value="0.5">2pl (0.5x)</option>
                              <option value="1">4pl (1x)</option>
                              <option value="1.5">6pl (1.5x)</option>
                              <option value="2">8pl (2x)</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.removeMealBtn}
                      onClick={() =>
                        startTransition(() => toggleMealSelectedForWeek(m.id, false))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.modeToggleGroup}>
              <button
                type="button"
                className={`${styles.pillBtn} ${planFilter === 'ranked' ? styles.pillBtnActive : ''}`}
                onClick={() => setPlanFilter('ranked')}
              >
                🏆 Voted &amp; Shortlisted
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${planFilter === 'selected' ? styles.pillBtnActive : ''}`}
                onClick={() => setPlanFilter('selected')}
              >
                ✅ Selected For This Week ({selectedMealsForWeek.length})
              </button>
              <button
                type="button"
                className={`${styles.pillBtn} ${planFilter === 'all' ? styles.pillBtnActive : ''}`}
                onClick={() => setPlanFilter('all')}
              >
                📚 All {initialMeals.length} Meals
              </button>
            </div>
          </div>

          <div className={styles.mealGrid}>
            {filteredPlannerMeals.map((meal) => (
              <div
                key={meal.id}
                className={`${styles.mealCard} ${
                  meal.selectedForWeek ? styles.mealCardSelected : ''
                }`}
              >
                <div className={styles.mealCardTop}>
                  <div className={styles.mealTitleGroup}>
                    <span className={styles.mealEmoji}>{meal.emoji}</span>
                    <div>
                      <h4>{meal.title}</h4>
                      <span className={styles.mealMeta}>
                        {meal.cuisine} · {meal.category}
                      </span>
                    </div>
                  </div>
                  <div className={styles.scoreBadge}>
                    Score: {meal.score > 0 ? `+${meal.score}` : meal.score}
                  </div>
                </div>

                {/* Detailed Household Votes Breakdown */}
                <div className={styles.cardVoteSummary}>
                  {meal.votes.length === 0 ? (
                    <span className={styles.noVotesYet}>No votes cast yet</span>
                  ) : (
                    meal.votes.map((v) => (
                      <span
                        key={v.id}
                        className={`${styles.memberVoteChip} ${
                          v.choice === 'YES'
                            ? styles.voteChipYes
                            : v.choice === 'NOT_THIS_WEEK'
                            ? styles.voteChipLater
                            : styles.voteChipNo
                        }`}
                      >
                        {v.memberName}:{' '}
                        {v.choice === 'YES'
                          ? '✅ Yes'
                          : v.choice === 'NOT_THIS_WEEK'
                          ? '⏳ Later'
                          : '❌ No'}
                      </span>
                    ))
                  )}
                </div>

                <div className={styles.compactIngList}>
                  {meal.ingredients.map((i) => (
                    <span key={i.id} className={styles.ingChipSmall}>
                      {i.productName} ({i.displayQuantity})
                    </span>
                  ))}
                </div>

                <div className={styles.plannerCardFooter}>
                  <button
                    type="button"
                    className={
                      meal.selectedForWeek
                        ? styles.selectWeekBtnActive
                        : styles.selectWeekBtn
                    }
                    disabled={isPending}
                    onClick={() =>
                      startTransition(() =>
                        toggleMealSelectedForWeek(meal.id, !meal.selectedForWeek)
                      )
                    }
                  >
                    {meal.selectedForWeek
                      ? '✅ Selected for This Week (Click to Remove)'
                      : '➕ Select Meal & Add Ingredients to List'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ======================================================== */}
      {/* TAB 3: WEEKLY HOUSEHOLD STAPLES ("RAN OUT" / "IN STOCK") */}
      {/* ======================================================== */}
      {activeTab === 'staples' && (
        <section className={styles.section}>
          <div className={styles.toolbarCard}>
            <div className={styles.toolbarRow}>
              <div>
                <h2 className={styles.sectionHeading}>
                  🥛 Weekly Household Staples &amp; Run-Out Tracker
                </h2>
                <p className={styles.sectionSub}>
                  Tap any item below when you run out or are running low. Anything marked{' '}
                  <strong>🔴 Ran Out</strong>, <strong>🟡 Running Low</strong>, or{' '}
                  <strong>🔵 Need Weekly</strong> is automatically added to your shopping list.
                </p>
              </div>
              <button
                type="button"
                className={styles.actionBtnCyan}
                onClick={() => startTransition(() => resetWeeklyStaplesToDefault())}
              >
                🔄 Reset Weekly Auto-Staples
              </button>
            </div>

            {/* Add New Staple Form */}
            <form
              className={styles.addStapleForm}
              onSubmit={(e) => {
                e.preventDefault()
                if (!newStapleName.trim()) return
                startTransition(async () => {
                  await addCustomStaple({
                    name: newStapleName,
                    aisle: newStapleAisle,
                    productId: newStapleProductId || undefined,
                    quantityPacks: 1,
                    autoNeedWeekly: true,
                  })
                  setNewStapleName('')
                  setNewStapleProductId('')
                })
              }}
            >
              <input
                type="text"
                placeholder="Add new household staple (e.g. Lurpak, Oat Milk, Cat Food)..."
                value={newStapleName}
                onChange={(e) => setNewStapleName(e.target.value)}
                className={styles.flexInput}
              />
              <select
                value={newStapleAisle}
                onChange={(e) => setNewStapleAisle(e.target.value)}
              >
                {AISLE_ORDER.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select
                value={newStapleProductId}
                onChange={(e) => setNewStapleProductId(e.target.value)}
              >
                <option value="">Link UK Price Product (Optional)</option>
                {productCatalog.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.packLabel})
                  </option>
                ))}
              </select>
              <button type="submit" className={styles.actionBtnOrange}>
                ➕ Add Staple
              </button>
            </form>

            <input
              type="search"
              placeholder="Filter staples..."
              value={stapleSearch}
              onChange={(e) => setStapleSearch(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.staplesGrid}>
            {initialStaples
              .filter(
                (s) =>
                  !stapleSearch.trim() ||
                  s.name.toLowerCase().includes(stapleSearch.toLowerCase()) ||
                  s.aisle.toLowerCase().includes(stapleSearch.toLowerCase())
              )
              .map((staple) => (
                <div
                  key={staple.id}
                  className={`${styles.stapleCard} ${
                    staple.status === 'OUT'
                      ? styles.stapleCardOut
                      : staple.status === 'LOW'
                      ? styles.stapleCardLow
                      : staple.status === 'NEEDED'
                      ? styles.stapleCardNeeded
                      : styles.stapleCardStock
                  }`}
                >
                  <div className={styles.stapleHeader}>
                    <div>
                      <h4>{staple.name}</h4>
                      <span className={styles.stapleAisle}>
                        {staple.aisle} · {staple.quantityPacks}x {staple.packLabel}
                      </span>
                    </div>
                    <div className={styles.stapleQtyStepper}>
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(() =>
                            updateStapleStatus(
                              staple.id,
                              staple.status,
                              Math.max(1, staple.quantityPacks - 1)
                            )
                          )
                        }
                      >
                        -
                      </button>
                      <span>{staple.quantityPacks}</span>
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(() =>
                            updateStapleStatus(staple.id, staple.status, staple.quantityPacks + 1)
                          )
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className={styles.stapleStatusButtons}>
                    <button
                      type="button"
                      className={`${styles.statusBtn} ${
                        staple.status === 'OUT' ? styles.statusBtnOutActive : ''
                      }`}
                      onClick={() =>
                        startTransition(() => updateStapleStatus(staple.id, 'OUT'))
                      }
                    >
                      🔴 Ran Out
                    </button>
                    <button
                      type="button"
                      className={`${styles.statusBtn} ${
                        staple.status === 'LOW' ? styles.statusBtnLowActive : ''
                      }`}
                      onClick={() =>
                        startTransition(() => updateStapleStatus(staple.id, 'LOW'))
                      }
                    >
                      🟡 Running Low
                    </button>
                    <button
                      type="button"
                      className={`${styles.statusBtn} ${
                        staple.status === 'NEEDED' ? styles.statusBtnNeededActive : ''
                      }`}
                      onClick={() =>
                        startTransition(() => updateStapleStatus(staple.id, 'NEEDED'))
                      }
                    >
                      🔵 Need This Wk
                    </button>
                    <button
                      type="button"
                      className={`${styles.statusBtn} ${
                        staple.status === 'IN_STOCK' ? styles.statusBtnStockActive : ''
                      }`}
                      onClick={() =>
                        startTransition(() => updateStapleStatus(staple.id, 'IN_STOCK'))
                      }
                    >
                      🟢 Have Plenty
                    </button>
                  </div>

                  <div className={styles.stapleFooter}>
                    <label className={styles.autoNeedCheck}>
                      <input
                        type="checkbox"
                        checked={staple.autoNeedWeekly}
                        onChange={(e) =>
                          startTransition(() =>
                            toggleStapleAutoWeekly(staple.id, e.target.checked)
                          )
                        }
                      />
                      <span>Auto-include every week unless marked &ldquo;Have Plenty&rdquo;</span>
                    </label>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ======================================================== */}
      {/* TAB 4: SHOPPING LIST & UK SUPERMARKET OPTIMIZER          */}
      {/* ======================================================== */}
      {activeTab === 'shop' && (
        <section className={styles.section}>
          {/* UK SUPERMARKET BASKET COMPARISON PANEL */}
          <div className={styles.optimizerPanel}>
            <div className={styles.optimizerHeader}>
              <div>
                <h2 className={styles.sectionHeading}>
                  🇬🇧 UK Supermarket Cheapest Basket &amp; Split-Shop Optimizer
                </h2>
                <p className={styles.sectionSub}>
                  Comparing <strong>{basketComparison.activeItemCount} active items</strong> across{' '}
                  {initialSettings.activeSupermarkets.length} enabled UK supermarkets (with pack-size
                  rounding &amp; loyalty card pricing).
                </p>
              </div>
              <div className={styles.optimizerHeaderBtns}>
                <button
                  type="button"
                  className={styles.pillBtn}
                  onClick={() => setShowStoreConfig(!showStoreConfig)}
                >
                  ⚙️ Select Supermarkets &amp; Loyalty Cards (
                  {initialSettings.activeSupermarkets.length}/8)
                </button>
                <button
                  type="button"
                  className={styles.actionBtnCyan}
                  onClick={() => startTransition(() => generateShoppingListNow())}
                >
                  🔄 Sync Meals + Staples
                </button>
              </div>
            </div>

            {/* Collapsible Supermarket & Loyalty Selector */}
            {showStoreConfig && (
              <div className={styles.storeSelectorDrawer}>
                <div className={styles.storeToggleGrid}>
                  {UK_SUPERMARKETS.map((s) => {
                    const enabled = initialSettings.activeSupermarkets.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`${styles.storeTogglePill} ${
                          enabled ? styles.storeTogglePillActive : ''
                        }`}
                        style={{
                          borderColor: enabled ? s.color : undefined,
                        }}
                        onClick={() => handleToggleStore(s.id)}
                      >
                        <span>{enabled ? '✅' : '⬜'}</span>
                        <strong>{s.name}</strong>
                        {s.isDiscounter && <span className={styles.discounterTag}>Discounter</span>}
                      </button>
                    )
                  })}
                </div>

                <div className={styles.loyaltyTogglesRow}>
                  <span className={styles.ingHeaderLabel}>Loyalty Pricing:</span>
                  <label className={styles.loyaltyCheckbox}>
                    <input
                      type="checkbox"
                      checked={initialSettings.hasTescoClubcard}
                      onChange={() => handleToggleLoyalty('hasTescoClubcard')}
                    />
                    <span>Tesco Clubcard</span>
                  </label>
                  <label className={styles.loyaltyCheckbox}>
                    <input
                      type="checkbox"
                      checked={initialSettings.hasSainsburysNectar}
                      onChange={() => handleToggleLoyalty('hasSainsburysNectar')}
                    />
                    <span>Sainsbury’s Nectar</span>
                  </label>
                  <label className={styles.loyaltyCheckbox}>
                    <input
                      type="checkbox"
                      checked={initialSettings.hasMorrisonsMore}
                      onChange={() => handleToggleLoyalty('hasMorrisonsMore')}
                    />
                    <span>Morrisons More</span>
                  </label>
                  <label className={styles.loyaltyCheckbox}>
                    <input
                      type="checkbox"
                      checked={initialSettings.hasLidlPlus}
                      onChange={() => handleToggleLoyalty('hasLidlPlus')}
                    />
                    <span>Lidl Plus</span>
                  </label>
                </div>
              </div>
            )}

            {/* Winner Cards: Cheapest Single Supermarket vs Cheapest 2-Shop Combination */}
            {basketComparison.bestSingleStore && (
              <div className={styles.winnerCardsGrid}>
                <div className={styles.winnerCardSingle}>
                  <div className={styles.winnerLabel}>🏆 CHEAPEST SINGLE SHOP</div>
                  <div className={styles.winnerMainRow}>
                    <h3>{basketComparison.bestSingleStore.storeName}</h3>
                    <span className={styles.winnerPrice}>
                      £{basketComparison.bestSingleStore.totalCost.toFixed(2)}
                    </span>
                  </div>
                  {basketComparison.bestSingleStore.missingItemCount > 0 ? (
                    <p className={styles.missingWarning}>
                      ⚠️ Note: {basketComparison.bestSingleStore.missingItemCount} specialty item(s)
                      ({basketComparison.bestSingleStore.missingItemNames.join(', ')}) may need a
                      substitute or top-up at a larger supermarket.
                    </p>
                  ) : (
                    <p className={styles.winnerNote}>
                      All {basketComparison.activeItemCount} items stocked in one trip.
                    </p>
                  )}
                </div>

                {basketComparison.bestSplitCombo && (
                  <div className={styles.winnerCardSplit}>
                    <div className={styles.winnerLabel}>
                      ⚡ CHEAPEST 2-SHOP COMBINATION
                      {basketComparison.bestSplitCombo.isWorthSecondStop && (
                        <span className={styles.recommendedSplitBadge}>RECOMMENDED SPLIT</span>
                      )}
                    </div>
                    <div className={styles.winnerMainRow}>
                      <h3>
                        {basketComparison.bestSplitCombo.storeAName} +{' '}
                        {basketComparison.bestSplitCombo.storeBName}
                      </h3>
                      <span className={styles.winnerPriceCyan}>
                        £{basketComparison.bestSplitCombo.combinedTotal.toFixed(2)}
                      </span>
                    </div>
                    <p className={styles.winnerNote}>
                      Saves{' '}
                      <strong>
                        £{basketComparison.bestSplitCombo.savingsVsBestSingle.toFixed(2)}
                      </strong>{' '}
                      vs. cheapest single shop (
                      {basketComparison.bestSplitCombo.storeAItems.length} items at{' '}
                      {basketComparison.bestSplitCombo.storeAName} ·{' '}
                      {basketComparison.bestSplitCombo.storeBItems.length} items at{' '}
                      {basketComparison.bestSplitCombo.storeBName}).
                    </p>
                    <div className={styles.splitFilterBtns}>
                      <button
                        type="button"
                        className={`${styles.miniFilterBtn} ${
                          shopListFilterStore === 'ALL' ? styles.miniFilterBtnActive : ''
                        }`}
                        onClick={() => setShopListFilterStore('ALL')}
                      >
                        Show Full List ({initialShoppingItems.length})
                      </button>
                      <button
                        type="button"
                        className={`${styles.miniFilterBtn} ${
                          shopListFilterStore === 'SPLIT_A' ? styles.miniFilterBtnActive : ''
                        }`}
                        onClick={() => setShopListFilterStore('SPLIT_A')}
                      >
                        Only {basketComparison.bestSplitCombo.storeAName} (
                        {basketComparison.bestSplitCombo.storeAItems.length})
                      </button>
                      <button
                        type="button"
                        className={`${styles.miniFilterBtn} ${
                          shopListFilterStore === 'SPLIT_B' ? styles.miniFilterBtnActive : ''
                        }`}
                        onClick={() => setShopListFilterStore('SPLIT_B')}
                      >
                        Only {basketComparison.bestSplitCombo.storeBName} (
                        {basketComparison.bestSplitCombo.storeBItems.length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* All Enabled UK Supermarkets Ranked Leaderboard */}
            {basketComparison.singleStoreRankings.length > 0 && (
              <div className={styles.storeLeaderboard}>
                {basketComparison.singleStoreRankings.map((rank, idx) => {
                  const cheapestCost = basketComparison.singleStoreRankings[0].totalCost
                  const diff = rank.totalCost - cheapestCost
                  return (
                    <div key={rank.storeId} className={styles.leaderboardRow}>
                      <div className={styles.leaderboardStore}>
                        <span className={styles.rankIndex}>#{idx + 1}</span>
                        <span
                          className={styles.storeColorDot}
                          style={{ backgroundColor: rank.color }}
                        />
                        <strong>{rank.storeName}</strong>
                        {rank.loyaltySavings > 0 && (
                          <span className={styles.loyaltySavedBadge}>
                            Loyalty saves £{rank.loyaltySavings.toFixed(2)}
                          </span>
                        )}
                        {rank.missingItemCount > 0 && (
                          <span className={styles.unstockedTag}>
                            {rank.missingItemCount} specialty item(s) substituted
                          </span>
                        )}
                      </div>
                      <div className={styles.leaderboardPriceGroup}>
                        {diff > 0 && (
                          <span className={styles.diffLabel}>+£{diff.toFixed(2)}</span>
                        )}
                        <strong className={styles.leaderboardTotal}>
                          £{rank.totalCost.toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ADD MANUAL EXTRA SHOPPING ITEM */}
          <form
            className={styles.manualAddBar}
            onSubmit={(e) => {
              e.preventDefault()
              if (!manualItemName.trim()) return
              startTransition(async () => {
                await addManualShoppingItem(manualItemName, manualItemAisle, 1)
                setManualItemName('')
              })
            }}
          >
            <input
              type="text"
              placeholder="Add extra one-off item to shopping list (e.g. Birthday Cake, Tin Foil, Wine)..."
              value={manualItemName}
              onChange={(e) => setManualItemName(e.target.value)}
              className={styles.flexInput}
            />
            <select
              value={manualItemAisle}
              onChange={(e) => setManualItemAisle(e.target.value)}
            >
              {AISLE_ORDER.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button type="submit" className={styles.actionBtnOrange}>
              ➕ Add Item
            </button>
          </form>

          {/* GROUPED IN-STORE SHOPPING CHECKLIST */}
          <div className={styles.aisleListContainer}>
            {groupedShoppingItems.length === 0 ? (
              <div className={styles.emptyDeckBox}>
                <h3>🛒 Your shopping list is empty</h3>
                <p>
                  Select meals in <strong>2. Pick Week</strong> or mark staples as needed in{' '}
                  <strong>3. Weekly Staples</strong> to generate your list automatically.
                </p>
              </div>
            ) : (
              groupedShoppingItems.map(([aisle, items]) => (
                <div key={aisle} className={styles.aisleBlock}>
                  <div className={styles.aisleHeader}>
                    <h3>{aisle}</h3>
                    <span>{items.length} items</span>
                  </div>
                  <div className={styles.aisleItems}>
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`${styles.shopItemRow} ${
                          item.checked ? styles.shopItemChecked : ''
                        } ${item.haveInCupboard ? styles.shopItemCupboard : ''}`}
                      >
                        <label className={styles.shopCheckLabel}>
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={(e) =>
                              startTransition(() =>
                                toggleShoppingItemChecked(item.id, e.target.checked)
                              )
                            }
                          />
                          <div className={styles.shopItemText}>
                            <div className={styles.shopItemTitleLine}>
                              <strong>{item.name}</strong>
                              <span className={styles.packBadge}>{item.unitLabel}</span>
                              <span
                                className={
                                  item.sourceType.includes('STAPLE')
                                    ? styles.sourceBadgeStaple
                                    : styles.sourceBadgeMeal
                                }
                              >
                                {item.sourceType}
                              </span>
                            </div>
                            <span className={styles.shopItemSources}>{item.sourceNotes}</span>
                          </div>
                        </label>

                        <div className={styles.shopItemRight}>
                          <div className={styles.stapleQtyStepper}>
                            <button
                              type="button"
                              onClick={() =>
                                startTransition(() => adjustShoppingItemPacks(item.id, -1))
                              }
                            >
                              -
                            </button>
                            <span>{item.packsNeeded}</span>
                            <button
                              type="button"
                              onClick={() =>
                                startTransition(() => adjustShoppingItemPacks(item.id, 1))
                              }
                            >
                              +
                            </button>
                          </div>

                          <button
                            type="button"
                            className={`${styles.cupboardBtn} ${
                              item.haveInCupboard ? styles.cupboardBtnActive : ''
                            }`}
                            onClick={() =>
                              startTransition(() =>
                                toggleShoppingItemCupboard(item.id, !item.haveInCupboard)
                              )
                            }
                            title="Tick if you already have this in the cupboard/fridge so it isn't bought"
                          >
                            {item.haveInCupboard ? '🏠 In Cupboard' : 'Have it?'}
                          </button>

                          {item.sourceType === 'MANUAL' && (
                            <button
                              type="button"
                              className={styles.deleteManualBtn}
                              onClick={() =>
                                startTransition(() => deleteShoppingItem(item.id))
                              }
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* ======================================================== */}
      {/* MODAL: HOUSEHOLD MEMBER NAME PICKER                      */}
      {/* ======================================================== */}
      {showNameModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <h3>👋 Who’s Using the Meal Planner?</h3>
            <p className={styles.modalSub}>
              Tap your name below or type it in once — your phone will remember your votes and
              preferences automatically.
            </p>

            {initialMembers.length > 0 && (
              <div className={styles.existingMembersGrid}>
                {initialMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={styles.memberQuickBtn}
                    style={{ borderColor: m.color }}
                    onClick={() => handleSelectMemberName(m.name)}
                  >
                    <span
                      className={styles.storeColorDot}
                      style={{ backgroundColor: m.color }}
                    />
                    <strong>{m.name}</strong>
                  </button>
                ))}
              </div>
            )}

            <form
              className={styles.nameForm}
              onSubmit={(e) => {
                e.preventDefault()
                handleSelectMemberName(nameInput)
              }}
            >
              <input
                type="text"
                placeholder="Type your name (e.g. Dan)..."
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
              />
              <div className={styles.modalBtnRow}>
                {currentMemberName && (
                  <button
                    type="button"
                    className={styles.pillBtn}
                    onClick={() => setShowNameModal(false)}
                  >
                    Cancel
                  </button>
                )}
                <button type="submit" className={styles.actionBtnCyan}>
                  Start Voting →
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD CUSTOM HOUSEHOLD RECIPE                       */}
      {/* ======================================================== */}
      {showAddMealModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCardLarge}>
            <h3>🍲 Add Custom Family Recipe</h3>
            <form
              className={styles.customMealForm}
              onSubmit={(e) => {
                e.preventDefault()
                if (!newMealTitle.trim()) return
                startTransition(async () => {
                  await createCustomHouseholdMeal({
                    title: newMealTitle,
                    description: newMealDesc,
                    cuisine: newMealCuisine,
                    category: newMealCategory,
                    prepMinutes: 15,
                    cookMinutes: 25,
                    emoji: newMealEmoji,
                    ingredientProductIds: selectedNewIngs,
                  })
                  setNewMealTitle('')
                  setNewMealDesc('')
                  setSelectedNewIngs([])
                  setShowAddMealModal(false)
                })
              }}
            >
              <div className={styles.formRow}>
                <input
                  type="text"
                  placeholder="Meal Title (e.g. Nan's Lamb Hotpot)"
                  value={newMealTitle}
                  onChange={(e) => setNewMealTitle(e.target.value)}
                  required
                  className={styles.flexInput}
                />
                <input
                  type="text"
                  placeholder="Emoji"
                  value={newMealEmoji}
                  onChange={(e) => setNewMealEmoji(e.target.value)}
                  style={{ width: '70px', textAlign: 'center' }}
                />
              </div>

              <textarea
                placeholder="Short description..."
                value={newMealDesc}
                onChange={(e) => setNewMealDesc(e.target.value)}
                rows={2}
              />

              <div className={styles.formRow}>
                <input
                  type="text"
                  placeholder="Cuisine (e.g. British)"
                  value={newMealCuisine}
                  onChange={(e) => setNewMealCuisine(e.target.value)}
                />
                <select
                  value={newMealCategory}
                  onChange={(e) => setNewMealCategory(e.target.value)}
                >
                  <option value="Comfort & Classics">Comfort &amp; Classics</option>
                  <option value="Quick & Midweek">Quick &amp; Midweek</option>
                  <option value="Fakeaway">Fakeaway</option>
                  <option value="Traybake & One-Pot">Traybake &amp; One-Pot</option>
                  <option value="Healthy & Fresh">Healthy &amp; Fresh</option>
                  <option value="Veggie & Plant">Veggie &amp; Plant</option>
                </select>
              </div>

              <div className={styles.ingPickerSection}>
                <label className={styles.ingHeaderLabel}>
                  Tap Ingredients to Include (links automatically to UK Supermarket Prices):
                </label>
                <div className={styles.ingPickerGrid}>
                  {productCatalog.map((prod) => {
                    const isPicked = selectedNewIngs.some((i) => i.productId === prod.id)
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        className={`${styles.ingPickBtn} ${
                          isPicked ? styles.ingPickBtnActive : ''
                        }`}
                        onClick={() => {
                          if (isPicked) {
                            setSelectedNewIngs((prev) =>
                              prev.filter((i) => i.productId !== prod.id)
                            )
                          } else {
                            setSelectedNewIngs((prev) => [
                              ...prev,
                              {
                                productId: prod.id,
                                quantity: prod.packSize,
                                displayQuantity: prod.packLabel,
                              },
                            ])
                          }
                        }}
                      >
                        {isPicked ? '✅ ' : '+ '}
                        {prod.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.modalBtnRow}>
                <button
                  type="button"
                  className={styles.pillBtn}
                  onClick={() => setShowAddMealModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.actionBtnCyan}>
                  Save Recipe &amp; Select for Week
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
