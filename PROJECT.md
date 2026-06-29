# Lease Renewal Modeling — Project Context (v4)

**Owner:** Karishma (Data Scientist, SAA team, Greystar)
**Stakeholders:** Seb (sponsor), Ganesh (data), David Bellamy (engineering)
**Phase:** v1 prototype — local Python on the Owned-book Entrata cohort
**Linear:** Renewal engine pilot milestone (SAA-227 through SAA-234)

---

## 1. What we're building

Two separate predictive models supporting an operating goal of **maintaining 92% property-level occupancy** while maximizing revenue per unit, subject to local rent-cap regulations.

### Model 1 — Churn Risk Early-Warning (hazard curve)

**Purpose:** Flag any resident at elevated risk of leaving the property entirely, at any point in their tenure, so PMs can intervene before the NTV decision.

| | |
|---|---|
| Unit of analysis | `(active_lease, scoring_month)` |
| Scoring cadence | Monthly, all active leases |
| Label | Binary churn — did this lease ultimately end in Case 3 (left property entirely)? Renewals AND LTOs both label as 0. |
| Output type | **Hazard curve** — `P(churn within k months)` for k ∈ {1, 3, 6, by-lease-end} |
| Use case | PM intervention prioritization, property-level expected-churn forecasts |

### Model 2 — Renewal Pricing

**Purpose:** Recommend an optimal rent increase at the renewal-offer event, modulated by churn risk and constrained by jurisdictional rent caps.

| | |
|---|---|
| Unit of analysis | `(lease, renewal_offer_date)` |
| Trigger | When `renewal_rent` is populated for a lease in silver Entrata staging — fires whether the offer is accepted or declined |
| Label | Binary: did this lease lead to a same-unit renewal at the offered rent? |
| Output | `P(accept | offered_increase_pct, features, churn_score)` |
| Decision layer | Combines churn score (M1) + jurisdictional cap to produce recommended rent increase |

### Outcome taxonomy (validated against data)

Three outcomes when a lease ends — confirmed empirically on the 121-property mf_gig sample (`is_valid=1`, `lease_status_type_name='Past'`, lease_end 2022-2025):

| Case | Detection signal | Counts as churn? | Sample rate (mf_gig) |
|---|---|---|---|
| **Renewal** | `next_lease.is_renewal = '1'` AND `next_lease.unit_id = current.unit_id` | ❌ Retained | 38.3% |
| **LTO** (Lease Trade Out) | `current.notice_to_transfer_date IS NOT NULL` (primary) OR same-property + different-unit chain | ❌ Retained | 5.2% |
| **Churn** | `next_lease_id` doesn't resolve to a same-property successor | ✅ Yes — prediction target | 56.3% |

LTO retains the resident at the property, so it does NOT count as churn for the 92% occupancy target.

---

## 2. Cohort (unchanged)

121 properties in `test_cohort.csv`. Derivation:
1. `prod.gold.oaa_property` filtered to active US non-affordable → 447 properties
2. Intersected with `realpage_crosswalk_v2` filtered to `num_comps = 10 AND is_realpage_reused = False` → 190 properties
3. `stage = 'Stabilized'` → 178 properties
4. Coverage thresholds (`n_leases >= 500 AND n_funnel_days >= 1100 AND renewal_rate IN [0.30, 0.65]`) → **121 properties**

Spans 19 regions, 13 funds, 18 states. **v1 is Owned book only**, predominantly `entrata_mf_gig` source system.

---

## 3. Local data inventory

| File | Rows | Grain | Status |
|---|---|---|---|
| `test_cohort.csv` | 121 | property | ✅ |
| `realpage_crosswalk.csv` | 2,937 | Greystar property | ✅ |
| `realpage_property_attributes.csv` | 48,808 | RealPage propertyid | ✅ |
| `monthly_geography_submarket.csv` | 4,947 | (market, submarket, month) | ✅ |
| `monthly_geography_market.csv` | 1,683 | (market, month) | ✅ |
| `monthly_transactions_submarket.csv` | ~4,902 | (market, submarket, month) | ⚠️ Re-pull needed |
| `monthly_transactions_market.csv` | 1,683 | (market, month) | ✅ |
| `property_performance.csv` | 59,628 | (RealPage propertyid, month) | ✅ |
| `state_ntv_deadlines.csv` | 36 | state | ✅ Starter — **needs legal review** |
| `jurisdiction_rent_caps.csv` | 17 | jurisdiction | ✅ Starter — **needs legal review** |

All RealPage refresh SQL is in `refresh_realpage_csvs.sql`.

---

## 4. DMP source systems and table choices

**The Owned book runs on Entrata, not Yardi.** Three streams, each with its own silver staging tables:

| Stream | Properties (Owned, active US non-affd) | Lease count (valid, 2022-2025) | What it is |
|---|---|---|---|
| `entrata_mf_gig` | 248 | 181K | Standard multifamily (General Investment Group) |
| `entrata_stu_edr` | 61 | 127K | Student housing — different semantics (by-the-bed, academic cycle) |
| `entrata_aa` | 52 | 28K | Active adult / senior — different semantics (age restrictions, amenity rents) |

**Pattern validation across streams** (running our renewal-detection classifier):

| Stream | Renewal | LTO | Churn | Unclassified |
|---|---|---|---|---|
| mf_gig | 38.3% | 5.2% | 56.3% | 0.2% ✅ |
| stu_edr | 11.9% | 10.1% | 75.6% | 2.4% ⚠️ |
| aa | 51.0% | 5.0% | 37.3% | 6.7% ⚠️ |

**v1 scope decision**: train on `mf_gig` only. Add stu_edr/aa as a v2 expansion after investigating their unclassified rates.

### Authoritative tables for v1 (silver-first, gold for context only)

| Table | Used for | Notes |
|---|---|---|
| `prod.silver.stg_entrata_mf_gig_lease` | **Primary lease + outcome source** | 117 cols — has `is_renewal`, `notice_to_transfer_date`, `renewal_rent`, `move_out_reason_group`, `primary_resident_id`, all the chain IDs we need |
| `prod.silver.union_entrata_mf_gig_rd_all_lease_months` | **Model 1 panel spine** | Pre-built `(lease_id, month_key)` — one row per active lease per month |
| `prod.silver.stg_entrata_mf_gig_dim_resident` | Resident attrs | Income, pets, vehicles |
| `prod.silver.stg_entrata_mf_gig_work_order` | Service experience features | Replaces `gold_work_order` |
| `prod.silver.stg_entrata_mf_gig_evictions` | Eviction events | Replaces `gold_evictions` |
| `prod.silver.stg_entrata_mf_gig_market_rent` | Comparable market rent | |
| `prod.silver.stg_entrata_mf_gig_outstanding_debt` + `stg_entrata_mf_gig_payment` | Collections / NSF / payment behavior | Replaces `oaa_collection` |
| `prod.silver.stg_entrata_mf_gig_property` | Property registry | Cross-check with `oaa_property` |
| `prod.gold.oaa_property` | Property attributes | Still useful — fund, asset_class, MSA, RM software |
| `prod.gold.oaa_fact_leasing_funnel` | Demand funnel | Still property-level, source-system agnostic |
| `prod.gold.oad_occupancy`, `oad_leasing_rent` | Property occupancy + renewals | Property-level marts |
| `prod.gold.bi_hlp_entkingsley_response_summary` | Sentiment | Join on `yardi_property_code` |
| `prod.gold.gold_renovation` | Unit renovation events | |
| `prod.gold.gold_property_excluded_units` | Off-line unit counts | |

Auth: Databricks profile `greystar` (OAuth U2M). Workspace: `https://adb-603123660205177.17.azuredatabricks.net`.

```python
from databricks import sql
conn = sql.connect(
    server_hostname="adb-603123660205177.17.azuredatabricks.net",
    http_path="/sql/1.0/warehouses/<warehouse_id>",
    credentials_provider=lambda: oauth_u2m,
)
```

**Save the lease pull + monthly aggregates as parquet locally early.** ~2M-row Model 1 panel × ~80 features = re-running DMP queries every iteration is unacceptable.

---

## 5. Critical gotchas

### Entrata-specific (newly characterized this round)

1. **`is_renewal` is the directly populated renewal flag** in `stg_entrata_<stream>_lease`. STRING type, value `'1'` for renewals, NULL otherwise. ~38% of mf_gig rows have it set. **Use this instead of self-join with renewal-inference logic.**

2. **`lease_status_type_name = 'Past'` is the critical training filter.** Without it, 39% of apparent CHURN rows are actually Cancelled leases (signed but never moved in) that should not be labeled as churn. Statuses to keep for training labels: `Past` only. Status `Current` / `Notice` are scoring-time states.

3. **`primary_resident_id` is 100% consistent across renewals in Entrata.** Unlike the Yardi situation, no name-based deduplication is needed.

4. **`notice_to_transfer_date` is the LTO signal.** `lease_transfer_indicator` is 100% NULL in both gold and silver — it's a dead column. Use `notice_to_transfer_date IS NOT NULL` instead.

5. **Self-join doesn't need source_system filter** — silver staging is already per-stream, so `nxt.lease_id = exp.next_lease_id` is sufficient.

6. **Each Entrata stream has its own staging tables.** No cross-stream joins; the model is essentially federated per source system.

### Carried forward from earlier sessions

7. **Kingsley join key**: `bi_hlp_entkingsley_response_summary.Property_ID` is Kingsley's internal 5-digit ID. Join on `yardi_property_code` (column in the table), NOT `property_id`.

8. **Period format mismatch across RealPage tables:**
   - `property_performance.period` = DATE (`2022-01-01`)
   - `monthly_geography.period` = STRING (`Y2022M01`)
   - `monthly_transactions.timeslice` = STRING (`Y2022M01`)
   - Normalize all to first-of-month DATE during feature engineering.

9. **`submarketid` is per-market** — not globally unique. Filter on `(marketid, submarketid)` tuples.

10. **`Totals/Totals` filter** on RealPage geography/transactions tables — they fan out by MarketRank × ConstructionDecade × UnitClass × StoryClass.

11. **monthly_geography submarket** also fans out by `zipcode` within submarket — filter `zipcode IS NULL`.

12. **Market rollup conventions differ:** `monthly_geography` uses `submarketid = 0`; `monthly_transactions` uses `submarketid IS NULL`.

13. **Concession nulls in `property_performance`**: null `concessionvalue` + `percentofunitsofferingconcessions = 0` → "no concessions", not missing data.

14. **`oaa_property` is the Owned book only.** v1 trains and deploys on the Owned subset.

15. **Point-in-time correctness is critical for Model 1.** Every feature at `scoring_month` must be computable strictly from data observed BEFORE that scoring_month. Run a leakage probe — fit on `scoring_month + 30 days` features and verify AUC drops to baseline.

16. **Fair Housing Act** hard exclusions — see Section 8.1.

---

## 6. Lease panel construction (the spine for Model 1)

### Step 1: Use the pre-built monthly panel from silver

```sql
-- Spine: one row per (active lease, month) — already computed
SELECT lease_id, month_key
FROM prod.silver.union_entrata_mf_gig_rd_all_lease_months
WHERE month_key BETWEEN '2022-01' AND '2026-12';
```

### Step 2: Join authoritative lease attributes + outcome classification

```sql
WITH lease_outcome AS (
  SELECT
    exp.lease_id, exp.property_id, exp.unit_id,
    exp.primary_resident_id, exp.resident_key,
    exp.lease_begin_date, exp.lease_end_date,
    exp.lease_status_type_name, exp.lease_stage, exp.lease_type,
    exp.notice_to_vacate, exp.notice_to_vacate_date,
    exp.notice_to_transfer_date,
    exp.move_out_date, exp.move_out_reason_group,
    exp.early_termination_flag,
    exp.renewal_offer_date, exp.earliest_renewal_offer_date,
    exp.renewal_rent, exp.renewal_cancel_date,
    exp.mtm_rent, exp.transfer_rent, exp.new_lease_rent,
    exp.is_renewal,
    exp.previous_lease_id, exp.next_lease_id,
    -- Outcome classification
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL                          THEN 'LTO'
      WHEN nxt.lease_id IS NULL                                             THEN 'CHURN'
      WHEN nxt.property_id <> exp.property_id                               THEN 'CHURN'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id = exp.unit_id               THEN 'RENEWAL'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id <> exp.unit_id              THEN 'LTO'
      ELSE 'UNCLASSIFIED'
    END AS outcome_3way,
    -- Binary churn label (LTO and Renewal both = 0)
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL THEN 0
      WHEN nxt.lease_id IS NOT NULL AND nxt.property_id = exp.property_id THEN 0
      ELSE 1
    END AS churn_label
  FROM prod.silver.stg_entrata_mf_gig_lease exp
  LEFT JOIN prod.silver.stg_entrata_mf_gig_lease nxt
    ON nxt.lease_id = exp.next_lease_id
  WHERE exp.property_id IN (<121 cohort property_ids>)
    AND exp.lease_status_type_name = 'Past'   -- ← excludes Cancelled, Current, Applicant, Notice, Future
    AND exp.lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
)
SELECT
  spine.lease_id,
  CAST(CONCAT(spine.month_key, '-01') AS DATE) AS scoring_month,
  lo.*,
  MONTHS_BETWEEN(CAST(CONCAT(spine.month_key,'-01') AS DATE), lo.lease_begin_date) AS months_in_lease_at_scoring,
  MONTHS_BETWEEN(lo.lease_end_date, CAST(CONCAT(spine.month_key,'-01') AS DATE))   AS months_until_lease_end
FROM prod.silver.union_entrata_mf_gig_rd_all_lease_months spine
JOIN lease_outcome lo USING (lease_id)
ORDER BY lease_id, scoring_month;
```

### Step 3: State-aware hazard label engineering (in Python after pulling parquet)

```python
import pandas as pd
state_ntv = pd.read_csv('state_ntv_deadlines.csv')

# Join states via oaa_property
panel = panel.merge(cohort[['property_id','state']], on='property_id')
panel = panel.merge(state_ntv[['state','greystar_standard_ntv_days']], on='state', how='left')

# Hazard labels at multiple horizons
panel['days_to_end'] = (panel['lease_end_date'] - panel['scoring_month']).dt.days
panel['churn_within_1m']  = ((panel['churn_label']==1) & (panel['days_to_end'] <= 30)).astype(int)
panel['churn_within_3m']  = ((panel['churn_label']==1) & (panel['days_to_end'] <= 90)).astype(int)
panel['churn_within_6m']  = ((panel['churn_label']==1) & (panel['days_to_end'] <= 180)).astype(int)
panel['churn_by_lease_end'] = panel['churn_label'].astype(int)

# Actionable window
panel['state_ntv_deadline'] = panel['lease_end_date'] - pd.to_timedelta(panel['greystar_standard_ntv_days'], unit='D')
panel['days_until_state_ntv_deadline'] = (panel['state_ntv_deadline'] - panel['scoring_month']).dt.days
panel['past_ntv_deadline'] = (panel['scoring_month'] > panel['state_ntv_deadline']).astype(int)
```

Expected panel size: ~2M rows for the 121 cohort × 2022-2026 (after Past-only filter).

### Hazard training — two approaches

**Option A — Single model with horizon as feature** (recommended for v1):
```python
panel_long = []
for k_months, label_col in [(1,'churn_within_1m'),(3,'churn_within_3m'),(6,'churn_within_6m'),(None,'churn_by_lease_end')]:
    df = panel.copy()
    df['horizon_months'] = k_months if k_months else (df['days_to_end'] // 30)
    df['label'] = df[label_col]
    panel_long.append(df)
panel_long = pd.concat(panel_long, ignore_index=True)
```

**Option B — Multiple binary classifiers, one per horizon:**
```python
models = {h: lgb.LGBMClassifier(...).fit(X_train, y_train[col]) for h,col in [(1,'churn_within_1m'),(3,'churn_within_3m'),(6,'churn_within_6m')]}
```

Start with Option A; benchmark against Option B if per-horizon calibration is off.

---

## 7. Renewal-offer events table (the spine for Model 2)

The Model 2 trigger is when a renewal_rent is populated for a lease (offer made — regardless of whether the resident accepted).

```sql
WITH renewal_offers AS (
  SELECT
    exp.lease_id, exp.property_id, exp.unit_id, exp.primary_resident_id,
    exp.lease_begin_date, exp.lease_end_date,
    exp.renewal_offer_date, exp.earliest_renewal_offer_date,
    exp.renewal_rent, exp.mtm_rent,
    exp.renewal_cancel_date,
    -- Compute offered increase pct using effective rent at offer time
    -- (need to join to a rent-history table or use scheduled rent column)
    exp.scheduled_rent AS rent_at_offer_time,
    (exp.renewal_rent - exp.scheduled_rent) / NULLIF(exp.scheduled_rent, 0) AS offered_increase_pct,
    -- Outcome: did the resident accept the offer? (same-unit chain follow-through)
    CASE
      WHEN nxt.is_renewal = '1' AND nxt.unit_id = exp.unit_id THEN 1
      ELSE 0
    END AS accepted_renewal
  FROM prod.silver.stg_entrata_mf_gig_lease exp
  LEFT JOIN prod.silver.stg_entrata_mf_gig_lease nxt
    ON nxt.lease_id = exp.next_lease_id
  WHERE exp.property_id IN (<cohort>)
    AND exp.lease_status_type_name = 'Past'
    AND exp.renewal_rent IS NOT NULL
    AND exp.renewal_rent > 0
    AND exp.lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
)
SELECT * FROM renewal_offers;
```

For each renewal-offer event, Model 2 label = `accepted_renewal` (binary). Features come from the lease panel at `renewal_offer_date` plus Model 1 hazard scores.

---

## 8. Feature catalog

Every feature: source, computation, model usage, PIT consideration.

### 8.1 Resident features (`prod.silver.stg_entrata_mf_gig_lease` + `_dim_resident` + `_resident_income`)

| Feature | Source | Computation | Model | PIT note |
|---|---|---|---|---|
| `lease_term_months` | `stg_entrata_mf_gig_lease.lease_term` | direct | Both | Lease-level constant |
| `signed_online_flag` | `stg_entrata_mf_gig_lease.online_signature_indicator` | direct | Both | Lease-level constant |
| `traffic_source` | `stg_entrata_mf_gig_lease.primary_traffic_source` | category | Both | Lease-level constant |
| `traffic_category` | `stg_entrata_mf_gig_lease.primary_traffic_category` | category | Both | Lease-level constant |
| `concessions_total` | `stg_entrata_mf_gig_lease.concessions` | direct | Both | Lease-level constant |
| `recurring_concessions` | `stg_entrata_mf_gig_lease.scheduled_recurring_concessions` | direct | Both | Lease-level constant |
| `is_m2m_lease` | `stg_entrata_mf_gig_lease.lease_type` | `LIKE '%month%'` | Both | Lease-level constant |
| `pets_count` | `stg_entrata_mf_gig_pets` aggregated by lease_id | count | Both | Lease-level constant |
| `vehicles_count` | `stg_entrata_mf_gig_vehicle` aggregated by lease_id | count | Both | Lease-level constant |
| `income_at_application` | `stg_entrata_mf_gig_resident_income` | direct, primary_resident_id | Both | Lease-level constant |
| `rent_to_income_ratio` | derived | `scheduled_rent / income` | Both | Lease-level constant |
| `prior_tenure_at_property` | derived from prior lease chain | max prior lease_end for primary_resident_id at this property | Both | Lease-level constant |
| `prior_lto_count` | derived from prior leases with `notice_to_transfer_date` | count | M1 | Resident history |

🚫 **DO NOT USE under Fair Housing Act**: gender, marital_status, household_relationship, number_of_minor_occupants, number_of_chidren (sic), birth_date, age-derived features. Hard exclusions.

⚠️ **Requires Legal review**: `employer` (occupation-based discrimination), prior_residence_zipcode (racial-origin proxy). Use only after fairness audit, flag in model card.

### 8.2 Lease pricing features (`prod.silver.stg_entrata_mf_gig_lease` + `_rent_detail` + `_scheduled_charges`)

| Feature | Source | Computation | Model | PIT note |
|---|---|---|---|---|
| `current_scheduled_rent` | `stg_entrata_mf_gig_lease.scheduled_rent` or `rent_detail` | asof scoring_month | Both | asof join |
| `current_effective_rent` | `stg_entrata_mf_gig_lease.operational_effective_rent` | asof | Both | asof join |
| `base_rent` | `stg_entrata_mf_gig_lease.base_rent` | direct | Both | Static |
| `amenity_rent` | `stg_entrata_mf_gig_lease.amenity_rent` | direct | Both | Static |
| `rent_change_t3m_pct` | derived from rent history | `(rent_now - rent_3m_ago) / rent_3m_ago` | M1 | Window |
| `rent_change_t12m_pct` | derived | YoY rent change at scoring_month | M1 | Window |
| `months_since_last_rent_increase` | derived | `DATEDIFF(scoring_month, last_increase_month)` | M1 | Window |
| **`renewal_rent_offered`** | `stg_entrata_mf_gig_lease.renewal_rent` | direct | M2 | Only at offer event |
| **`mtm_rent_alternative`** | `stg_entrata_mf_gig_lease.mtm_rent` | direct | M2 | Only at offer event |
| **`offered_increase_pct`** | derived | `(renewal_rent - current_rent) / current_rent` | M2 | Treatment variable |
| `lto_event_in_this_lease` | `notice_to_transfer_date IS NOT NULL` | flag | M1 | This lease is an LTO |
| `transfer_rent_if_lto` | `stg_entrata_mf_gig_lease.transfer_rent` | direct | M1 | LTO-context rent |

### 8.3 Property attributes (`prod.gold.oaa_property` + `realpage_property_attributes.csv`)

| Feature | Source | Computation | Model | PIT note |
|---|---|---|---|---|
| `fund` | `oaa_property.fund` | direct | Both | Static |
| `asset_class` | `oaa_property.asset_class` | direct | Both | Static |
| `msa` | `oaa_property.msa` | direct | Both | Static |
| `submarket` | `oaa_property.submarket` | direct | Both | Static |
| `community_mgmt_tenure_months` | `oaa_property` | direct | Both | Slowly varying |
| `has_bilt` | `oaa_property.has_bilt` | direct | Both | Static |
| `revenue_management_software` | `oaa_property` | AIRM/LRO/Manual | Both | Static-ish |
| `assetclass_market` | `realpage_property_attributes.assetclassmarket` | A+/A/A-/B+/... via crosswalk | Both | Static |
| `assetclass_submarket` | `realpage_property_attributes.assetclasssubmarket` | via crosswalk | Both | Static |
| `building_class` | `realpage_property_attributes.buildingclass` | Low/Mid/High-Rise | Both | Static |
| `property_style` | `realpage_property_attributes.property_style` | Garden/Podium/Tower/Wrap | Both | Static |
| `daily_pricing_flag` | `realpage_property_attributes.dailypricing` | Y/N — RM sophistication | Both | Static |
| `property_age_months_precise` | derived | `DATEDIFF(scoring_month, firstmoveindate) / 30` | Both | Time-varying |
| `market_rate_unit_share` | `realpage_property_attributes` | `marketrateunits / totalunits` | Both | Static |

```python
oaa_prop = pull_from_dmp("SELECT * FROM prod.gold.oaa_property WHERE yardi_property_code IN (...)")
xw = pd.read_csv("realpage_crosswalk.csv")[["yardi_property_code","realpage_propertyid"]]
attrs = pd.read_csv("realpage_property_attributes.csv")
prop_features = (oaa_prop
    .merge(xw, on="yardi_property_code", how="left")
    .merge(attrs, left_on="realpage_propertyid", right_on="propertyid", how="left"))
```

### 8.4 Demand / funnel features (`prod.gold.oaa_fact_leasing_funnel`)

Rolled to `(property_id, month)` with backward-only windows.

| Feature | Computation | Model |
|---|---|---|
| `denial_rate_t90d` | `count_application_denied / count_application_completed` over t90d | M1 |
| `lead_to_lease_conversion_t90d` | `count_lease_signed / count_lead_new_total` over t90d | M1 |
| `median_days_lead_to_lease_t90d` | median in t90d window | M1, M2 |
| `total_leads_t30d` | sum over t30d | M1 |
| `tour_to_application_rate_t90d` | over t90d | M1 |

```sql
SELECT
  property_id, scoring_month,
  SUM(count_lead_new_total) FILTER (WHERE day_date BETWEEN scoring_month - INTERVAL 90 DAY AND scoring_month - INTERVAL 1 DAY) AS total_leads_t90d,
  SUM(count_lease_signed)   FILTER (WHERE day_date BETWEEN scoring_month - INTERVAL 90 DAY AND scoring_month - INTERVAL 1 DAY) AS leases_signed_t90d,
  SUM(count_application_denied)    FILTER (WHERE day_date BETWEEN scoring_month - INTERVAL 90 DAY AND scoring_month - INTERVAL 1 DAY) AS denials_t90d,
  SUM(count_application_completed) FILTER (WHERE day_date BETWEEN scoring_month - INTERVAL 90 DAY AND scoring_month - INTERVAL 1 DAY) AS apps_t90d
FROM prod.gold.oaa_fact_leasing_funnel f
CROSS JOIN scoring_months sm
WHERE f.property_id IN (<cohort>)
GROUP BY property_id, scoring_month;
```

### 8.5 Property occupancy / vacancy (`prod.gold.oad_occupancy`, `prod.gold.oad_leasing_rent`)

| Feature | Source | Model |
|---|---|---|
| `physical_occupancy_pct_at_scoring` | `oad_occupancy` (t3m rolling) | Both |
| `move_in_count_t90d` | `oad_occupancy.move_in_count` summed | M1 |
| `move_out_count_t90d` | `oad_occupancy.move_out_count` summed | M1 |
| `vacancy_loss_vs_budget_pct` | `oad_occupancy` | M1 |
| `property_renewal_rate_t3m` | `oad_leasing_rent` | M1 |
| `property_renewal_rate_t12m` | `oad_leasing_rent` | M1 |
| `property_lto_rate_t12m` | derived from silver `notice_to_transfer_date` aggregated by property | M1 |
| `neighbor_churn_signal` | derived from `oad_occupancy` | M1 |

### 8.6 Service experience (`prod.silver.stg_entrata_mf_gig_work_order`) — HIGH SIGNAL

| Feature | Computation | Model |
|---|---|---|
| `wo_count_open_at_scoring` | open at scoring_month boundary | M1 |
| `wo_count_t30d` | opened during t30d | M1 |
| `wo_count_t90d` | opened during t90d | M1 |
| `wo_pest_count_t90d` | filter category like '%pest%' | M1 |
| `wo_avg_completion_days_t90d` | mean days_to_complete | M1 |
| `wo_emergency_count_t90d` | filter priority/category | M1 |
| `unit_wo_count_lifetime` | per `(lease_id, unit_id)` lifetime | M1 |

```sql
-- Note: silver Entrata WO schema differs from gold_work_order — verify column names before use
SELECT
  l.lease_id, sm.scoring_month,
  COUNT(wo.*) FILTER (WHERE wo.open_date <= sm.scoring_month AND COALESCE(wo.close_date, DATE '9999-01-01') > sm.scoring_month) AS wo_count_open,
  COUNT(wo.*) FILTER (WHERE wo.open_date BETWEEN sm.scoring_month - INTERVAL 30 DAY AND sm.scoring_month - INTERVAL 1 DAY) AS wo_count_t30d,
  COUNT(wo.*) FILTER (WHERE wo.open_date BETWEEN sm.scoring_month - INTERVAL 90 DAY AND sm.scoring_month - INTERVAL 1 DAY) AS wo_count_t90d
FROM lease_panel l
CROSS JOIN scoring_months sm
LEFT JOIN prod.silver.stg_entrata_mf_gig_work_order wo
  ON wo.unit_id = l.unit_id
WHERE sm.scoring_month BETWEEN l.lease_begin_date AND l.lease_end_date
GROUP BY l.lease_id, sm.scoring_month;
```

### 8.7 Collections / payment behavior (`prod.silver.stg_entrata_mf_gig_payment` + `_outstanding_debt`) — HIGH SIGNAL

| Feature | Computation | Model |
|---|---|---|
| `late_payment_count_t90d` | count of late fee transactions in t90d | M1 |
| `nsf_count_lifetime` | NSF for this lease | M1 |
| `nsf_count_t90d` | recent NSFs | M1 |
| `payment_velocity_t90d` | derived from payment-vs-due timing | M1 |
| `recent_balance_owed` | `stg_entrata_mf_gig_outstanding_debt` most recent | M1 |
| `eviction_filed_against_lease` | `stg_entrata_mf_gig_evictions.lease_id` | M1 |

```sql
-- Verify column names against actual silver schema for stg_entrata_mf_gig_payment + outstanding_debt
SELECT
  p.lease_id, sm.scoring_month,
  COUNT(*) FILTER (WHERE p.is_late_flag = 1 AND p.payment_date BETWEEN sm.scoring_month - INTERVAL 90 DAY AND sm.scoring_month - INTERVAL 1 DAY) AS late_t90d,
  COUNT(*) FILTER (WHERE p.is_nsf = 1 AND p.payment_date BETWEEN sm.scoring_month - INTERVAL 90 DAY AND sm.scoring_month - INTERVAL 1 DAY) AS nsf_t90d
FROM prod.silver.stg_entrata_mf_gig_payment p
JOIN scoring_months sm USING (property_id)
WHERE p.property_id IN (<cohort>)
GROUP BY p.lease_id, sm.scoring_month;
```

### 8.8 Sentiment (`prod.gold.bi_hlp_entkingsley_response_summary`)

| Feature | Source | Computation | Model |
|---|---|---|---|
| `kingsley_score_latest` | Kingsley | asof most recent ≤ scoring_month (**yardi_property_code join**) | M1, M2 |
| `kingsley_score_t12m_avg` | Kingsley | mean over t12m | M1 |
| `kingsley_score_t3m_change` | Kingsley | recent direction | M1 |
| `kingsley_n_responses_t90d` | Kingsley | recent volume | M1 |

```python
kingsley = pull_from_dmp("""
  SELECT yardi_property_code, Report_Date, AvgScoreWithoutProspect
  FROM prod.gold.bi_hlp_entkingsley_response_summary
  WHERE yardi_property_code IN (<cohort yardi codes>)
""")
panel = panel.merge(cohort[["property_id","yardi_property_code"]], on="property_id")
panel = pd.merge_asof(
    panel.sort_values("scoring_month"),
    kingsley.sort_values("Report_Date"),
    by="yardi_property_code", left_on="scoring_month", right_on="Report_Date",
    direction="backward"
)
```

### 8.9 Unit state (`prod.gold.gold_renovation`, `prod.gold.gold_property_excluded_units`)

| Feature | Source | Computation | Model |
|---|---|---|---|
| `unit_renovated_within_lease` | `gold_renovation.next_lease_id = current` | flag | Both |
| `building_renovation_intensity_t90d` | `gold_renovation` property-level | count | M1 |
| `property_pct_excluded_units` | `gold_property_excluded_units` at scoring_month | derived | M1 |

### 8.10 Submarket peer features (`monthly_geography_submarket.csv` + `monthly_transactions_submarket.csv`)

Joined at `(marketid, submarketid, period)`. Normalize period format first.

| Feature | Source | Model |
|---|---|---|
| `submarket_askingrent_psf_at_scoring` | `monthly_geography_submarket.askingrpsf` | Both |
| `submarket_effectiverent_psf_at_scoring` | `monthly_geography_submarket.effectiverpsf` | Both |
| `submarket_rent_change_t3m_pct` | derived | Both |
| `submarket_rent_change_t12m_pct` | `yoyeffectiverentchange` | Both |
| `submarket_ss_rent_change_t12m_pct` | `ssyoyeffectiverentchange` | Both |
| `submarket_occupancy_pct` | `monthly_geography_submarket.occupancy` | Both |
| `submarket_occupancy_change_t12m` | `yoyoccupancychange` | Both |
| `submarket_vacancyrate` | `monthly_geography_submarket.vacancyrate` | Both |
| `submarket_concession_pct` | `monthly_geography_submarket.concessionpercentaskingrent` | Both |
| `submarket_pct_units_w_concessions` | `monthly_geography_submarket.percentofunitsofferingconcessions` | Both |
| `submarket_renewal_conversion` | `monthly_transactions_submarket.renewalconversion` | Both — **top feature** |
| `submarket_renewal_lease_term` | `monthly_transactions_submarket.renewalleaseterm` | Both |
| `submarket_renewal_rate_change` | `monthly_transactions_submarket.renewalleaseratechange` | Both |
| `submarket_avg_vacant_days` | `monthly_transactions_submarket.averagevacantdays` | M1 |
| `submarket_rent_to_income_ratio` | `monthly_transactions_submarket.medianrenttoincomeratio` | M1 |
| `submarket_new_lease_demand_yoy` | `monthly_transactions_submarket.yoyexecutednewleasecountchange` | Both |

```python
sub_geo = pd.read_csv("monthly_geography_submarket.csv")
sub_geo["scoring_month"] = pd.to_datetime(
    sub_geo["period"].str.replace("Y","").str.replace("M","-") + "-01"
)
sub_txn = pd.read_csv("monthly_transactions_submarket.csv")
sub_txn["scoring_month"] = pd.to_datetime(
    sub_txn["timeslice"].str.replace("Y","").str.replace("M","-") + "-01"
)
prop_to_sub = pd.read_csv("test_cohort.csv")[["property_id","marketid","submarketid"]]
panel = (panel
    .merge(prop_to_sub, on="property_id", how="left")
    .merge(sub_geo, on=["marketid","submarketid","scoring_month"], how="left")
    .merge(sub_txn, on=["marketid","submarketid","scoring_month"], how="left", suffixes=("","_txn")))
```

### 8.11 Market macros (`monthly_geography_market.csv` + `monthly_transactions_market.csv`)

Fallbacks for submarket nulls (especially `medianrenttoincomeratio` — 82.5% null at submarket grain).

| Feature | Source | Model |
|---|---|---|
| `market_employment_change_yoy` | `monthly_geography_market.yoyemploymentchangepercent` | Both |
| `market_multifamily_permits_yoy` | `monthly_geography_market.multifamilypermitschange` | M1 |
| `market_unit_starts_annual` | `monthly_geography_market.annualunitstarts` | M1 |
| `market_renewal_conversion` | `monthly_transactions_market.renewalconversion` | Both (fallback) |
| `market_rent_to_income_ratio` | `monthly_transactions_market.medianrenttoincomeratio` | Both (fallback) |

### 8.12 Comp-set features (`realpage_crosswalk.csv` + `property_performance.csv`)

For each subject property, take 10 RealPage comps and aggregate their `property_performance` rows.

| Feature | Computation | Model |
|---|---|---|
| `compset_avg_effectiverent_psf_at_scoring` | mean of 10 comps' `effectiverpsf` | Both |
| `property_to_compset_rent_gap_pct` | `(subject_rent - compset_avg) / compset_avg` | Both — **top feature** |
| `compset_avg_occupancy` | mean of 10 comps' occupancy | Both |
| `compset_concession_intensity` | mean `percentofunitsofferingconcessions` | Both |
| `compset_rent_change_t3m_pct` | mean of comps' rent change | Both |
| `compset_rent_change_t12m_pct` | mean of comps' YoY rent change | Both |
| `compset_data_quality_flag` | 1 if fewer than 7 comps have data at scoring_month | Both |

```python
xw = pd.read_csv("realpage_crosswalk.csv")
comp_cols = [f"realpage_compnumber{w}" for w in ["one","two","three","four","five","six","seven","eight","nine","ten"]]
comps_long = xw.melt(id_vars=["realpage_propertyid"], value_vars=comp_cols,
    var_name="comp_slot", value_name="comp_realpage_propertyid").dropna()
comps_long["comp_realpage_propertyid"] = comps_long["comp_realpage_propertyid"].astype(int)

perf = pd.read_csv("property_performance.csv")
perf["scoring_month"] = pd.to_datetime(perf["period"])

comp_perf = comps_long.merge(perf, left_on="comp_realpage_propertyid", right_on="propertyid", how="left")
compset_features = (comp_perf
    .groupby(["realpage_propertyid","scoring_month"])
    .agg(
        compset_avg_effectiverpsf=("effectiverpsf","mean"),
        compset_avg_occupancy=("occupancy","mean"),
        compset_concession_intensity=("percentofunitsofferingconcessions","mean"),
        compset_n_comps_with_data=("propertyid","count"),
    ).reset_index())
compset_features["compset_data_quality_flag"] = (compset_features["compset_n_comps_with_data"] < 7).astype(int)
```

### 8.13 Seasonality / time features

| Feature | Computation | Model |
|---|---|---|
| `lease_end_month` | `MONTH(lease_end_date)` | Both — strong seasonal signal |
| `lease_end_quarter` | `QUARTER(lease_end_date)` | Both |
| `scoring_month_calendar` | `MONTH(scoring_month)` | M1 |
| `is_covid_era` | `lease_begin_date BETWEEN '2020-03-01' AND '2021-12-31'` | Both |
| `months_in_lease_at_scoring` | from panel | M1 — strong predictor |
| `months_until_lease_end_at_scoring` | from panel | M1 — strong predictor |
| `horizon_months` (for Option A training) | label horizon: 1, 3, 6, or until-lease-end | M1 — stacked panel |
| `days_until_state_ntv_deadline` | from state_ntv_deadlines.csv | M1 — actionable window |
| `is_past_state_ntv_deadline` | flag | M1 — drop or downweight |

### 8.14 Jurisdiction / pricing constraint features (`state_ntv_deadlines.csv`, `jurisdiction_rent_caps.csv`)

| Feature | Source | Model |
|---|---|---|
| `state_minimum_ntv_days` | `state_ntv_deadlines.csv` | M1 — reference |
| `greystar_standard_ntv_days` | `state_ntv_deadlines.csv` | M1 — labeling + deadline feature |
| `jurisdiction_max_rent_increase_pct` | `jurisdiction_rent_caps.csv` | M2 — **constraint on output** |
| `jurisdiction_has_rent_cap_flag` | flag | Both |
| `jurisdiction_cap_category` | Statewide / Local / None | Both |

```python
caps = pd.read_csv("jurisdiction_rent_caps.csv")
ntv = pd.read_csv("state_ntv_deadlines.csv")
panel = panel.merge(ntv, on="state", how="left")
panel = panel.merge(caps, on=["state","city"], how="left")
panel["jurisdiction_max_rent_increase_pct"] = panel["max_increase_pct"].fillna(10.0)
```

### 8.15 Derived / engineered features

| Feature | Computation | Model |
|---|---|---|
| `rent_to_market_gap_pct` | `(current_rent - submarket_effectiverent) / submarket_effectiverent` | Both — pricing pressure |
| `rent_burden_trend_t12m` | YoY change in `rent_to_income_ratio` | M1 |
| `cumulative_rent_increase_pct_during_tenure` | `(current_rent - rent_at_lease_begin) / rent_at_lease_begin` | M1 |
| `expected_days_to_relet` | from funnel features | Both |
| `churn_score_1m`, `churn_score_3m`, `churn_score_6m` (M1 outputs) | from Model 1 hazard curve | **M2 features** |
| `lto_propensity` | derived from prior LTO history × resident features | M1 |

### 8.16 Data-quality features (used as features or filters)

| Feature | Computation | Model |
|---|---|---|
| `realpage_join_quality_flag` | `is_realpage_reused = True OR num_comps < 10` | Both |
| `compset_data_quality_flag` | <7 comps with data at scoring_month | Both |
| `kingsley_data_age_months` | months since most recent Kingsley response | M1 |
| `submarket_sample_size_low` | `propertiessampled < 30` in submarket-month | Both |
| `lease_unclassified_flag` | `outcome_3way = 'UNCLASSIFIED'` | Both — exclude from training |

---

## 9. Starter data files (legal review required)

### `state_ntv_deadlines.csv`
36 states with state-minimum NTV days + assumed 60-day Greystar standard. 🔴 **legal_review_status = DRAFT** on every row.

### `jurisdiction_rent_caps.csv`
17 jurisdictions: CA AB-1482 (10%), OR SB 608 (10%), WA HB 1217 (10%, 2025), plus 10+ city/county ordinances. Several entries have NULL `max_increase_pct` because the cap formula is CPI-based — need annual refresh. 🔴 **legal_review_status = DRAFT**.

---

## 10. v1 prototype workflow

### Phase 1 — Materialize core panels (one-time, ~30 min)

```
1. lease_outcome.parquet         # silver Entrata lease + 3-way outcome (~190K mf_gig past leases)
2. lease_panel.parquet           # spine joined to outcome (~2M rows after Past filter)
3. renewal_offers.parquet        # leases with renewal_rent populated (Model 2 spine, ~40K rows)
4. funnel_monthly.parquet        # (property_id, month) windowed agg
5. wo_monthly.parquet            # (lease_id, month) work-order activity
6. collection_monthly.parquet    # (lease_id, month) payment behavior
7. kingsley_monthly.parquet      # (yardi_property_code, month) sentiment
8. occupancy_monthly.parquet     # property-level occupancy
9. resident_attrs.parquet        # static lease-level resident features
```

### Phase 2 — Assemble Model 1 feature view

```python
m1_features = (lease_panel
    .pipe(merge_static_property_attrs)       # 8.3
    .pipe(merge_resident_attrs)              # 8.1
    .pipe(asof_merge_rent_history)           # 8.2
    .pipe(merge_funnel_monthly)              # 8.4
    .pipe(merge_occupancy_monthly)           # 8.5
    .pipe(merge_wo_monthly)                  # 8.6
    .pipe(merge_collection_monthly)          # 8.7
    .pipe(asof_merge_kingsley)               # 8.8
    .pipe(merge_unit_state)                  # 8.9
    .pipe(merge_submarket_features)          # 8.10
    .pipe(merge_market_macros)               # 8.11
    .pipe(merge_compset_features)            # 8.12
    .pipe(add_seasonality_features)          # 8.13
    .pipe(merge_jurisdiction_features)       # 8.14
    .pipe(add_engineered_features)           # 8.15
    .pipe(add_data_quality_flags))           # 8.16
```

### Phase 3 — Train Model 1 hazard curve

```python
m1_long = stack_for_hazard_curve(m1_features, horizons=[1, 3, 6, None])
# Train: 2022-2024, Val: 2025, Test: 2026+
# GroupKFold by lease_id, drop past_ntv_deadline=1 and unclassified rows
import lightgbm as lgb
model_m1 = lgb.LGBMClassifier(...).fit(X_train, y_train['label'])
```

### Phase 4 — Score panel + build Model 2 features

```python
hazard_scores = {}
for h in [1, 3, 6]:
    test_h = m1_features.copy()
    test_h['horizon_months'] = h
    hazard_scores[h] = model_m1.predict_proba(test_h)[:,1]

m2_events = pd.read_parquet("renewal_offers.parquet")
m2_features = (m2_events
    .merge(m1_features, on=["lease_id", "scoring_month"], how="left")
    .merge(hazard_scores_at_offer_date, on=["lease_id", "renewal_offer_date"]))
model_m2 = lgb.LGBMClassifier(...).fit(X_m2_train, y_accepted_renewal)
```

### Phase 5 — Pricing recommendation with jurisdictional cap

```python
def recommend_rent_increase(lease_features, churn_scores, jurisdiction_cap_pct):
    cap = min(jurisdiction_cap_pct, 0.10)
    candidate_increases = np.arange(0.0, cap, 0.005)
    expected_revenue = []
    for inc in candidate_increases:
        features = {**lease_features,
                    "offered_increase_pct": inc,
                    "churn_score_1m": churn_scores[1],
                    "churn_score_3m": churn_scores[3],
                    "churn_score_6m": churn_scores[6]}
        p_accept = model_m2.predict_proba(features)[:,1]
        new_rent = lease_features["current_rent"] * (1 + inc)
        expected_rev = (p_accept * new_rent * 12
                        + (1 - p_accept) * model_relet_revenue(features))
        expected_revenue.append(expected_rev)
    optimal_idx = np.argmax(expected_revenue)
    return candidate_increases[optimal_idx], expected_revenue[optimal_idx]
```

### Phase 6 — Evaluation

**Model 1 hazard curve:**
- AUC at each horizon (1m, 3m, 6m, by-lease-end)
- Calibration at each horizon
- Property-level: predicted-vs-actual churn count per property per month (drives 92% occupancy planning)
- Intervention precision: of top-X% risk residents, what fraction actually churned?
- Fairness audit on race/ethnicity proxies (`prior_residence_zipcode`, `employer` pending legal review)

**Model 2:**
- AUC, calibration
- **Counterfactual evaluation**: backtest recommendation vs actual historical decisions
- Constraint adherence: 100% of recommendations must respect `jurisdiction_max_rent_increase_pct`

---

## 11. Open decisions / waiting on

### Blocking for v1 training
- 🔴 **Legal review of `state_ntv_deadlines.csv` and `jurisdiction_rent_caps.csv`**
- 🔴 **Legal review of Fair Housing carve-outs** (`employer`, `prior_residence_zipcode`)

### Resolved this session ✅
- ~~Cohort source system is unknown~~ → All Entrata (mf_gig dominant). v1 = mf_gig only.
- ~~Renewal-detection logic for Entrata~~ → Working pattern documented in Section 6.
- ~~Is renewal_rent populated for all offers or only accepted ones?~~ → Populated for offers made (regardless of acceptance), based on the 38% population rate matching the renewal rate.
- ~~Need name-based dedup for resident continuity?~~ → No, `primary_resident_id` is 100% reliable in Entrata.
- ~~Is `lease_transfer_indicator` the LTO signal?~~ → No, it's 100% NULL. Use `notice_to_transfer_date` instead.
- ~~How to filter cancelled/applicant leases?~~ → `lease_status_type_name = 'Past'`.

### Non-blocking but resolve before scaling
- Ganesh: supply-pipeline / new-construction-deliveries data source
- Seb: clarification on "806 NYC" and "GEHF" — never surfaced as named properties
- Promote `test.gold.hello_data_comps` → prod with daily snapshots
- EVICTION feature audit — feature or exclusion?
- **stu_edr investigation** — 2.4% unclassified, lower renewal rate (12%) due to academic cycle; the pattern works but semantics differ
- **aa investigation** — 6.7% unclassified rate is the surprise. Worth tracing before including in v2

### Architecture decisions during prototyping
- Option A (stacked horizon) vs Option B (multiple binary classifiers) for hazard curve
- How to weight LTO features in M1 — should LTO history reduce churn risk (resident is staying)?
- Should M2 incorporate `mtm_rent` as a feature (option-value of M2M)?

---

## 12. Cohort scope evolution path

- **v1**: 121 mf_gig stabilized properties (current)
- **v2 stage A**: Add aa stream (52 properties) after investigating 6.7% unclassified
- **v2 stage B**: Add stu_edr stream (61 properties) with student-housing-aware label adjustments
- **v3**: Expand to all 436 Owned-book active US properties (relax `n_leases ≥ 500`)
- **v4**: Cross-distribution generalization to Managed properties (train on Owned, score Managed with reduced feature set)

---

## 13. Karishma's working preferences

- MacBook (Mac paths: `~/Library/Group Containers/UBF8T346G9.Office/...` for Office automation)
- Writing style for drafts: warm + high-energy. "Hi [Name]!" opener. Soft-launch with "Just wanted to...". Tasteful emoji. Closer: "Thanks!" or "Have a great weekend". Signs as "Karishma" only.
- Linear is the tracker — **Renewal engine pilot** milestone (SAA-227 through SAA-234)
- External deployment guardrail skill is active: no deploys to Vercel/Supabase/Netlify/etc. without explicit Greystar IT/D2AI approval

## 14. Custom skills available
- `greystar-deck-gen` — branded PowerPoint generation
- `greystar-brand` — design system tokens (Navy #0A2245, Ocean #0077D4, etc.)
- `weekly-recap` — Mon–Fri cross-tool digest
- `decision-council` — 5-advisor pressure-test
- `greystar-external-deployment-guardrail` — blocks external deploys
