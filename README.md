# Lendrac Meals (`meals.lendrac-labs.net`)

**Household Meal Voter, Weekly Staples Tracker & UK Supermarket Basket Optimizer**

Built with Next.js 14 (App Router, Server Actions, standalone Docker output), Prisma + PostgreSQL (CloudNativePG `meals_db`), and the Lendrac Labs LCARS/Cyberpunk interface.

---

## Key Capabilities

1. **Mobile-First Household Voting (No Login Required)**
   - Family members open `meals.lendrac-labs.net` on their phones, type or tap their name once (persisted in `localStorage`), and vote on meals using large touch-friendly swipe cards or list view:
     - ✅ **Yes (`YES`)** — Want this meal this week (+2 score)
     - ⏳ **Not This Week (`NOT_THIS_WEEK`)** — Like the meal in general, save for a future week (+0.5 score)
     - ❌ **No (`NO`)** — Do not want (-2 score)
2. **215+ Pre-Populated UK Household Meals & Random Shortlist**
   - Comes pre-seeded with **215+ UK meals** (`src/lib/uk-meals-seed.ts`) across *Comfort & Classics*, *Fakeaway*, *Quick & Midweek*, *Traybake & One-Pot*, *Healthy & Fresh*, and *Veggie & Plant*.
   - **Shuffle / Draw N Random Options**: Draw a randomized weekly shortlist (e.g. 30 meals) from the 215+ library at any time, or search/filter the full library.
3. **Weekly Planner & Automatic Ingredient Aggregation**
   - Ranks meals by household consensus score and displays every family member's vote badge (`Dan: ✅`, `Sarah: ⏳`).
   - Selecting meals for the week automatically scales and merges all required ingredients into the shopping list, rounded up to real UK supermarket pack sizes.
4. **Weekly Household Staples ("Ran Out" / "Running Low" / "Have Plenty")**
   - Pre-seeded with 19 recurring household staples (Milk, Eggs, Bread, Lurpak/Butter, Cheddar, Bananas, Coffee, Yorkshire Tea, Toilet Roll, Dishwasher Tabs, etc.).
   - Anyone in the household can tap **🔴 Ran Out**, **🟡 Running Low**, **🔵 Need This Week**, or **🟢 Have Plenty** on their phone, immediately syncing with the shopping list.
5. **UK Supermarket Price Comparison & 2-Shop Split Optimizer**
   - Compares your exact shopping list across **all 8 major UK supermarkets**:
     - **Aldi, Lidl, Asda, Tesco, Sainsbury's, Morrisons, Ocado, Waitrose**
   - Toggle which supermarkets you have access to and which loyalty cards you hold (**Tesco Clubcard, Sainsbury's Nectar, Morrisons More, Lidl Plus**).
   - **Single-Shop Leaderboard** + **Cheapest 2-Shop Split Calculator** (e.g. *Aldi + Tesco* or *Lidl + Sainsbury's*) that splits your checklist by store and tells you whether a second stop saves enough money to be worth the trip.
