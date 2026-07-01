# Lease Renewal — Churn Prediction & Pricing Engine

**Owner:** Karishma Rana, Data Scientist — SAA Team, Greystar  
**Status:** v1 prototype — Owned-book mf_gig cohort (121 properties)  
**Linear:** Renewal engine pilot — SAA-227 through SAA-234

---

## What This Is

Two-part system for improving lease renewal outcomes across Greystar's multifamily portfolio:

1. **Python model pipeline** — Two LightGBM models that predict churn risk and recommend optimal rent increases, trained on Entrata (mf_gig) data from 121 stabilized properties
2. **Next.js dashboard** (`src/`) — PM-facing UI that surfaces model outputs for 28,350 residents across those properties

The operating goal is maintaining **92% property-level occupancy** while maximizing revenue per unit, subject to local rent-cap regulations.

---

## Architecture

```
Databricks Prod (silver/gold Entrata tables)
        │
        ├── pull_lease_panel.py      → data/lease_panel.parquet       (~2M rows)
        └── pull_remaining.py        → data/*.parquet                  (9 tables)
                │
                └── 02_build_features.py  → data/m1_features.parquet  (~70 features)
                          │
                          ├── 03_train_model1.py   → data/model1.pkl  (churn hazard)
                          │         │
                          │         └── data/m1_scores.parquet
                          │
                          ├── 04_train_model2.py   → data/model2.pkl  (renewal acceptance)
                          ├── 05_pricing_recommender.py
                          ├── 06_evaluate.py        → data/evaluation_report.json
                          └── 07_market_price_model.py
                                    │
                              residents.json  →  src/data/residents.json
                              properties.json →  src/data/properties.json
                                    │
                              Next.js dashboard (src/)
```

---

## Model 1 — Churn Risk Hazard Curve

Predicts `P(churn within k months)` for k ∈ {1, 3, 6, by-lease-end} for every active lease, scored monthly.

| | |
|---|---|
| Algorithm | LightGBM (binary, stacked horizons) |
| Train period | 2022–2024 |
| Val period | 2025 |
| Test period | 2026+ |
| Val AUC (3m horizon) | 0.972 |
| Val AUC (6m horizon) | 0.882 |
| Training rows | ~1.49M (after stacking 4 horizons) |
| Features | ~70 (see `FEATURE_CATALOG.md`) |

**Outcome taxonomy:**

| Outcome | Signal | Churn? |
|---------|--------|--------|
| Renewal | `next_lease.is_renewal = '1'` AND same unit | No |
| LTO (Lease Trade Out) | `notice_to_transfer_date IS NOT NULL` | No — resident stays at property |
| Churn | No same-property successor | Yes — prediction target |

**Training exclusions:** rows where `lease_unclassified_flag = 1`, `lto_event_in_this_lease = 1`, or `past_ntv_deadline = 1`.

## Model 2 — Renewal Acceptance

Predicts `P(resident accepts renewal offer | offered_increase_pct, features, churn_score)`.

| | |
|---|---|
| Algorithm | LightGBM (binary) |
| Trigger | When `renewal_rent` is populated for a lease in Entrata |
| Label | `accepted_renewal`: same-unit chain follow-through |
| Val AUC | 0.736 |
| Top features | M1 churn scores (85% of gain) |

**Pricing recommendation tiers** (rule-based in v1):

| p_accept | Max recommended increase |
|----------|-------------------------|
| > 0.80 | Up to +5% |
| 0.65–0.80 | Up to +3% |
| < 0.65 | Flat (occupancy protection) |

Constraints applied in order: risk adjustment → occupancy strategy → rent control cap.

---

## Cohort

121 properties from `test_cohort.csv`. Derivation:

1. `prod.gold.oaa_property` active US non-affordable → 447 properties
2. Intersect with `realpage_crosswalk_v2` where `num_comps = 10 AND is_realpage_reused = False` → 190
3. Filter `stage = 'Stabilized'` → 178
4. Coverage thresholds (`n_leases ≥ 500`, `n_funnel_days ≥ 1100`, `renewal_rate ∈ [0.30, 0.65]`) → **121**

Spans 19 regions, 13 funds, 18 states. v1 is Owned book only, `entrata_mf_gig` source system.

---

## Dashboard (src/)

**Stack:** Next.js 16 / React 19 / TypeScript 5 / Tailwind CSS 4

**Routes:**

| Route | What it shows |
|-------|--------------|
| `/` | Portfolio dashboard — 28,350 residents, risk tier filters, KPI strip, search/sort, trends tab |
| `/residents/[id]` | Resident detail — risk gauge, ranked renewal factors, rent recommendation with constraints, action items, cost-savings panel |
| `/model` | Model intelligence — M1/M2 architecture, feature importances, pricing logic, AUC stats, compliance notes |

**Data:** Pre-computed model outputs loaded from `src/data/residents.json` (10.5MB) and `src/data/properties.json`. No live API — all scores are baked in at build time.

**Design tokens** (`globals.css`):
```
--gs-navy: #0E2044
--gs-gold: #C8A951
--gs-bg:   #F4F5F8
```

---

## Setup

### Python pipeline

```bash
# Requires Python 3.10+, Databricks CLI configured with profile "Prod"
pip install pandas pyarrow lightgbm scikit-learn databricks-sql-connector databricks-sdk certifi

# Step 1 — Pull base lease panel from Databricks
python pull_lease_panel.py

# Step 2 — Pull all supporting tables
python pull_remaining.py

# Step 3 — Build feature view (~70 features, ~2M rows)
python 02_build_features.py

# Step 4 — Train Model 1 (churn hazard)
python 03_train_model1.py

# Step 5 — Train Model 2 (renewal acceptance)
python 04_train_model2.py

# Step 6 — Generate pricing recommendations
python 05_pricing_recommender.py

# Step 7 — Evaluate
python 06_evaluate.py

# Step 8 — Market rent estimates + PM pricing strategy
# (needs m1_scores.parquet from Step 4 plus the RealPage CSVs at repo root)
python 07_market_price_model.py
```

Data files land in `data/`. All parquets and pickles are gitignored — only eval JSON files are committed.

**Databricks connection:**
- Workspace: `adb-8721937917042291.11.azuredatabricks.net`
- Auth: OAuth U2M via Databricks CLI profile `Prod`

### Dashboard

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run lint      # ESLint (eslint-config-next)
```

Note: this repo pins Next.js 16, which has breaking API changes vs. older versions — see `AGENTS.md`.

To update the dashboard with new model outputs, regenerate `src/data/residents.json` and `src/data/properties.json` from the model pipeline outputs and restart.

---

## Repository Structure

```
lease-renewal/
├── src/                          Next.js dashboard
│   ├── app/
│   │   ├── page.tsx              Portfolio dashboard
│   │   ├── model/page.tsx        Model intelligence page
│   │   └── residents/[id]/       Resident detail
│   ├── components/               UI components
│   ├── lib/
│   │   ├── data.ts               JSON loading + risk factor computation
│   │   ├── rentLogic.ts          Pricing constraint logic
│   │   ├── modelMeta.ts          M1/M2 feature definitions
│   │   └── types.ts              TypeScript interfaces
│   └── data/
│       ├── residents.json        28,350 pre-scored resident records
│       └── properties.json       121 property metadata records
│
├── pull_lease_panel.py           Databricks pull: lease outcomes + monthly panel
├── pull_remaining.py             Databricks pull: all supporting tables
├── 02_build_features.py          Feature engineering (~70 features)
├── 03_train_model1.py            Train churn hazard model
├── 04_train_model2.py            Train renewal acceptance model
├── 05_pricing_recommender.py     Generate rent recommendations
├── 06_evaluate.py                Evaluation + reporting
├── 07_market_price_model.py      Market rent estimates by unit type
│
├── test_cohort.csv               121-property cohort definition
├── realpage_crosswalk.csv        Greystar → RealPage property ID mapping
├── realpage_property_attributes.csv  Building class, style, unit counts
├── monthly_geography_market.csv      RealPage market-level metrics
├── monthly_geography_submarke.csv    RealPage submarket-level metrics
├── monthly_transactions_market.csv   RealPage market transaction metrics
├── monthly_transactions_submarket.csv
├── property_performance.csv          RealPage per-property performance
│
├── PROJECT.md                    Full project context, decisions, gotchas
├── FEATURE_CATALOG.md            Complete feature documentation
├── AGENTS.md                     Next.js 16 breaking-changes notice for coding agents
├── CLAUDE.md                     Guidance for Claude Code in this repo
├── data/                         Gitignored — parquets + pickles live here
│   ├── model1_eval.json          Committed — training-time M1 AUC per horizon (03_train_model1.py)
│   ├── model2_eval.json          Committed — training-time M2 AUC (04_train_model2.py)
│   └── evaluation_report.json    Committed — full holdout eval (06_evaluate.py; source of the AUCs quoted above)
└── .gitignore
```

---

## Compliance

**FHA hard exclusions** — never include in any model or feature: `gender`, `marital_status`, `birth_date`, `household_relationship`, `number_of_minor_occupants`, `number_of_children`

**Pending legal review before v1 ship:**
- `state_ntv_deadlines.csv` — all rows marked DRAFT; currently defaulting to 60-day Greystar standard
- `jurisdiction_rent_caps.csv` — 17 jurisdictions; several CPI-indexed caps need annual refresh
- `prior_zip_latitude` / `prior_zip_longitude` — racial-origin proxies; fairness audit required

**Flags for v2:**
- Traffic source feature has a 28pp spread in 6m churn across source types — potential FHA proxy for student/military housing
- Eviction feature — decision pending on whether it's a valid feature or an exclusion

---

## Open Items

**Blocking for v1 ship:**
- Legal review of NTV deadlines and rent caps CSVs

**Data gaps (v2):**
- `stg_entrata_mf_gig_outstanding_debt` — SHA ResidentKey has no join path to `lease_id` (flagged for Ganesh)
- `gold_renovation` — unit renovation features not yet pulled
- `stg_entrata_mf_gig_rent_detail` — needed for `rent_change_t3m/t12m` and rent-psf comp-set gap

**Architecture:**
- Pricing optimizer v2: move from rule-based tiers to continuous optimization once price elasticity data exists (99.97% of historical offers were flat, so no signal yet)

**Expansion roadmap:**
- v2 stage A: Add `aa` stream (52 active adult properties) after investigating 6.7% unclassified rate
- v2 stage B: Add `stu_edr` stream (61 student housing) with academic-cycle label adjustments
- v3: Expand to all 436 Owned-book properties
- v4: Cross-distribution generalization to Managed properties
