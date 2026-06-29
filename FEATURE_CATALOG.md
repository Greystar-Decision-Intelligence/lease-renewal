# Lease Renewal Model — Feature Catalog

**Generated from:** `02_build_features.py`, `pull_lease_panel.py`, `pull_remaining.py`, `03_train_model1.py`, `04_train_model2.py`  
**Total features in m1_features.parquet:** ~70  
**Models:** M1 = Churn Risk Hazard Curve · M2 = Renewal Acceptance / Pricing

---

## Legend

| Symbol | Meaning |
|--------|---------|
| **Raw** | Pulled directly from source; no transformation beyond type casting |
| **Derived** | Computed in Python from one or more raw columns |
| **Rolled** | Aggregated over a backward-looking time window (no future leakage) |
| **Encoded** | Categorical column label-encoded (`.cat.codes`) |
| 🚫 | Hard FHA exclusion — never use |
| ⚠️ | Pending legal review before use |

---

## 1. Lease / Outcome Panel (from `pull_lease_panel.py`)

Source: `prod.silver.stg_entrata_mf_gig_lease` (self-joined on `next_lease_id`) × `prod.silver.union_entrata_mf_gig_rd_all_lease_months`

These form the **spine** of the panel. Every model row is one `(lease_id, scoring_month)`.

| Feature | Type | Source column | Notes |
|---------|------|---------------|-------|
| `lease_id` | ID | `stg_entrata_mf_gig_lease.lease_id` | Row key |
| `property_id` | ID | `stg_entrata_mf_gig_lease.property_id` | |
| `unit_id` | ID | `stg_entrata_mf_gig_lease.unit_id` | |
| `primary_resident_id` | ID | `stg_entrata_mf_gig_lease.primary_resident_id` | Stable across renewals in Entrata |
| `scoring_month` | Date | `union_entrata_mf_gig_rd_all_lease_months.month_key` | Snapped to month-start; spine join key |
| `lease_begin_date` | Date | `stg_entrata_mf_gig_lease.lease_begin_date` | Raw |
| `lease_end_date` | Date | `stg_entrata_mf_gig_lease.lease_end_date` | Raw |
| `lease_type` | Encoded | `stg_entrata_mf_gig_lease.lease_type` | Label-encoded |
| `lease_stage` | Raw | `stg_entrata_mf_gig_lease.lease_stage` | Excluded from training (ID-adjacent) |
| `lease_status_type_name` | Raw | `stg_entrata_mf_gig_lease.lease_status_type_name` | Training filter = 'Past'; excluded as feature |
| `early_termination_flag` | Raw | `stg_entrata_mf_gig_lease.early_termination_flag` | |
| `renewal_offer_date` | Date | `stg_entrata_mf_gig_lease.renewal_offer_date` | Used as join key for M2; excluded from M1 features |
| `move_out_reason_group` | Encoded | `stg_entrata_mf_gig_lease.move_out_reason_group` | Excluded from M1 training (post-hoc label) |
| `months_in_lease_at_scoring` | **Derived** | `MONTHS_BETWEEN(scoring_month, lease_begin_date)` | Computed in SQL on panel pull; strong M1 predictor |
| `months_until_lease_end` | **Derived** | `MONTHS_BETWEEN(lease_end_date, scoring_month)` | Computed in SQL; strong M1 predictor |

---

## 2. Labels (`02_build_features.py` §1)

These are the **targets** — not fed as model features.

| Label | Type | How engineered |
|-------|------|----------------|
| `outcome_3way` | Raw | 3-way SQL CASE: `LTO` / `RENEWAL` / `CHURN` / `UNCLASSIFIED` using self-join on `next_lease_id` |
| `churn_label` | **Derived** | 1 if outcome = CHURN (no same-property successor); 0 for Renewal and LTO |
| `churn_within_1m` | **Derived** | `churn_label == 1 AND days_to_end ≤ 30` |
| `churn_within_3m` | **Derived** | `churn_label == 1 AND days_to_end ≤ 90` |
| `churn_within_6m` | **Derived** | `churn_label == 1 AND days_to_end ≤ 180` |
| `churn_by_lease_end` | **Derived** | Alias of `churn_label` |
| `horizon_months` | **Derived** | Stacked-panel encoding: 1 / 3 / 6 / (days_to_end ÷ 30) per copy; fed as feature in M1 Option A |

### Exclusion flags (not model features — used to filter training rows)

| Flag | Engineering |
|------|-------------|
| `lease_unclassified_flag` | `outcome_3way == 'UNCLASSIFIED'` → exclude from training |
| `lto_event_in_this_lease` | `notice_to_transfer_date IS NOT NULL` → exclude from M1 training |
| `past_ntv_deadline` | `scoring_month > state_ntv_deadline` → exclude (no longer actionable) |

---

## 3. Hazard Timing Features (`02_build_features.py` §1)

Source: `state_ntv_deadlines.csv` ⚠️ (draft — needs legal review)

| Feature | Type | Engineering |
|---------|------|-------------|
| `days_to_end` | **Derived** | `(lease_end_date − scoring_month).days` |
| `greystar_standard_ntv_days` | Raw | From `state_ntv_deadlines.csv`; default 60 days if file missing |
| `state_ntv_deadline` | **Derived** | `lease_end_date − greystar_standard_ntv_days` (date column; excluded from features) |
| `days_until_state_ntv_deadline` | **Derived** | `(state_ntv_deadline − scoring_month).days` |

---

## 4. Jurisdiction / Rent Cap Features (`02_build_features.py` §2)

Source: `jurisdiction_rent_caps.csv` ⚠️ (draft — needs legal review)

| Feature | Type | Engineering |
|---------|------|-------------|
| `jurisdiction_has_rent_cap_flag` | **Derived** | 1 if `max_increase_pct` is not null for this state |
| `jurisdiction_max_rent_increase_pct` | Raw | `max_increase_pct` from caps file; NaN if no cap found |

---

## 5. Resident / Lease Static Features (`02_build_features.py` §3)

Source: `prod.silver.stg_entrata_mf_gig_lease` + `stg_entrata_mf_gig_dim_resident` + `stg_entrata_mf_gig_resident_income` + `stg_entrata_mf_gig_pets` + `stg_entrata_mf_gig_vehicle` + `stg_entrata_mf_gig_evictions`

Pulled via `RESIDENT_ATTRS_SQL` in `pull_remaining.py`; stored in `data/resident_attrs.parquet`.

| Feature | Type | Source column / Engineering | Model |
|---------|------|-----------------------------|-------|
| `lease_term` | Raw | `stg_entrata_mf_gig_lease.lease_term` | Both |
| `lease_term_months` | Raw | Alias — same column | Both |
| `signed_online_flag` | Raw | `stg_entrata_mf_gig_lease.online_signature_indicator` | Both |
| `traffic_source` | Encoded | `stg_entrata_mf_gig_lease.primary_traffic_source` | Both |
| `traffic_category` | Encoded | `stg_entrata_mf_gig_lease.primary_traffic_category` | Both |
| `concessions_total` | Raw | `stg_entrata_mf_gig_lease.concessions` | Both |
| `recurring_concessions` | Raw | `stg_entrata_mf_gig_lease.scheduled_recurring_concessions` | Both |
| `base_rent` | Raw | `stg_entrata_mf_gig_lease.base_rent` | Both |
| `amenity_rent` | Raw | `stg_entrata_mf_gig_lease.amenity_rent` | Both |
| `scheduled_rent` | Raw | `stg_entrata_mf_gig_lease.scheduled_rent` | Both |
| `is_m2m_lease` | **Derived** | `LOWER(lease_type) LIKE '%month%'` → 1/0 | Both |
| `annual_employer_income` | Raw | `stg_entrata_mf_gig_dim_resident.annual_employer_income` | Both |
| `rent_or_own` | Raw | `stg_entrata_mf_gig_dim_resident.rent_or_own` | Both |
| `prior_zip_latitude` | Raw ⚠️ | `stg_entrata_mf_gig_dim_resident.prior_zip_latitude` | Pending legal review — racial-origin proxy |
| `prior_zip_longitude` | Raw ⚠️ | `stg_entrata_mf_gig_dim_resident.prior_zip_longitude` | Pending legal review — racial-origin proxy |
| `pets_count` | **Rolled** | COUNT of `stg_entrata_mf_gig_pets` by `primary_resident_id`; COALESCE(0) | Both |
| `vehicles_count` | **Rolled** | COUNT of `stg_entrata_mf_gig_vehicle` by `lease_id`; COALESCE(0) | Both |
| `income_at_application` | **Rolled** | MAX(`stg_entrata_mf_gig_resident_income.amount`) by `resident_id` | Both |
| `rent_to_income_ratio` | **Derived** | `scheduled_rent / income_at_application`; inf → NaN | Both |
| `eviction_filed_against_lease` | Raw | 1 if `lease_id` appears in `stg_entrata_mf_gig_evictions`; else 0 | M1 |

🚫 **FHA hard exclusions (never include):** `gender`, `marital_status`, `birth_date`, `household_relationship`, `number_of_minor_occupants`, `number_of_children`

---

## 6. Property Attributes (`02_build_features.py` §4)

Source: `test_cohort.csv` (from `prod.gold.oaa_property`) + `realpage_crosswalk.csv` + `realpage_property_attributes.csv`

| Feature | Type | Source / Engineering | Model |
|---------|------|----------------------|-------|
| `state` | Encoded | `test_cohort.csv` (from `oaa_property`) | Both |
| `fund` | Encoded | `test_cohort.csv` | Both |
| `asset_class` | Encoded | `test_cohort.csv` | Both |
| `assetclassmarket` | Encoded | `test_cohort.csv` + `realpage_property_attributes.csv` | Both |
| `geographical_region` | Encoded | `test_cohort.csv` | Both |
| `msa` | Raw | `test_cohort.csv` | Both |
| `revenue_management_software` | Encoded | `test_cohort.csv` (AIRM / LRO / Manual) | Both |
| `realpage_propertyid` | ID | `test_cohort.csv` / `realpage_crosswalk.csv` | Join key |
| `marketid` | ID | `test_cohort.csv` | Join key for submarket |
| `submarketid` | ID | `test_cohort.csv` | Join key for submarket |
| `buildingclass` | Encoded | `realpage_property_attributes.csv.buildingclass` (Low/Mid/High-Rise) | Both |
| `property_style` | Encoded | `realpage_property_attributes.csv.property_style` (Garden/Podium/Tower/Wrap) | Both |
| `daily_pricing_flag` | **Derived** | `realpage_property_attributes.csv.dailypricing == 'Y'` → 1/0 | Both |
| `market_rate_unit_share` | **Derived** | `marketrateunits / totalunits` (from RealPage attrs) | Both |
| `assetclasssubmarket` | Raw | `realpage_property_attributes.csv.assetclasssubmarket` | Both |
| `firstmoveindate` | Date | `realpage_property_attributes.csv.firstmoveindate` | Used only to derive age |
| `property_age_months_precise` | **Derived** | `(scoring_month − firstmoveindate).days / 30.44`, clipped ≥ 0 | Both |

---

## 7. Seasonality Features (`02_build_features.py` §5)

All engineered from existing date columns; no additional source needed.

| Feature | Engineering | Model |
|---------|-------------|-------|
| `lease_end_month` | `lease_end_date.dt.month` (1–12) | Both |
| `lease_end_quarter` | `lease_end_date.dt.quarter` (1–4) | Both |
| `scoring_month_calendar` | `scoring_month.dt.month` (1–12) | M1 |
| `is_covid_era` | `lease_begin_date ∈ [2020-03-01, 2021-12-31]` → 1/0 | Both |

---

## 8. Demand / Funnel Features (`02_build_features.py` §6)

Source: `prod.gold.oaa_fact_leasing_funnel` → `data/funnel_monthly.parquet`  
Grain: `(property_id, month)`

**Rolling method:** Panel is shifted forward by 1–3 months so scoring_month `t` sees data from months `t−1` through `t−3` only (no leakage).

### Raw monthly sums (t30d and t90d windows)

| Feature | Window | Engineering |
|---------|--------|-------------|
| `leads_total_t30d` | 30 days | Sum of `count_lead_new_total` for offset = 1 month back |
| `tours_first_t30d` | 30 days | Sum of `count_tour_first` |
| `apps_completed_t30d` | 30 days | Sum of `count_application_completed` |
| `apps_denied_t30d` | 30 days | Sum of `count_application_denied` |
| `leases_signed_t30d` | 30 days | Sum of `count_lease_signed` |
| `leads_total_t90d` | 90 days | Same, offsets 1–3 months |
| `tours_first_t90d` | 90 days | |
| `apps_completed_t90d` | 90 days | |
| `apps_denied_t90d` | 90 days | |
| `leases_signed_t90d` | 90 days | |

### Derived funnel ratios

| Feature | Engineering | Model |
|---------|-------------|-------|
| `denial_rate_t90d` | `apps_denied_t90d / apps_completed_t90d` | M1 |
| `lead_to_lease_conversion_t90d` | `leases_signed_t90d / leads_total_t90d` | M1 |
| `tour_to_application_rate_t90d` | `apps_completed_t90d / tours_first_t90d` | M1 |

---

## 9. Occupancy Features (`02_build_features.py` §7)

Source: `prod.gold.oad_occupancy` → `data/occupancy_monthly.parquet`  
Source: `prod.gold.oad_leasing_rent` → `data/leasing_rent_monthly.parquet`  
Grain: `(property_id, month)`

**PIT shift:** All occupancy data is lagged by 1 month before joining (data published at end of month; scoring is at start of next month).

| Feature | Type | Engineering | Model |
|---------|------|-------------|-------|
| `physical_occupancy_pct` | **Derived** | `numerator_phys_occ / denominator_net_phys_occ` (month prior to scoring) | Both |
| `actual_vacancy_loss` | Raw | `oad_occupancy.actual_vacancy_loss` (1-month lag) | M1 |
| `budget_vacancy_loss` | Raw | `oad_occupancy.budget_vacancy_loss` (1-month lag) | M1 |
| `vacancy_loss_vs_budget_pct` | **Derived** | `(actual_vacancy_loss − budget_vacancy_loss) / budget_vacancy_loss` | M1 |
| `property_renewal_rate_t3m` | **Rolled** | `SUM(renewed_signed_lease_cnt) / SUM(expiring_lease_cnt)` over prior 3 months | M1 |
| `property_renewal_rate_t12m` | **Rolled** | Same ratio over prior 12 months | M1 |

---

## 10. Work Order Features (`02_build_features.py` §8)

Source: `prod.silver.stg_entrata_mf_gig_work_order` → `data/wo_raw.parquet`  
Grain: `(lease_id, service_request_date)`  
**Filter applied at load:** Cancelled work orders (`cancelled == 1`) are excluded.

**Rolling method:** Monthly event counts are shifted forward 1–3 months before joining, giving backward-only windows.

| Feature | Window | Engineering | Model |
|---------|--------|-------------|-------|
| `wo_count_t30d` | 30 days | Count of non-cancelled WOs opened in prior month (by `lease_id`) | M1 |
| `wo_count_t90d` | 90 days | Count over prior 3 months | M1 |
| `wo_pest_count_t90d` | 90 days | WOs where `category LIKE '%pest%'` | M1 |
| `wo_emergency_count_t90d` | 90 days | WOs where `work_order_priority == 'Emergency'` | M1 |
| `unit_wo_count_lifetime` | Lifetime | Total non-cancelled WOs per `lease_id` across all time | M1 |

---

## 11. Payment / Collections Features (`02_build_features.py` §9)

Source: `prod.silver.stg_entrata_mf_gig_payment` → `data/payment_raw.parquet`  
Date range pulled: 2021-10-01 to 2026-12-31 (extra 90-day buffer for rolling windows).

| Feature | Window | Engineering | Model |
|---------|--------|-------------|-------|
| `nsf_count_t30d` | 30 days | Count of payments where `payment_status_type_name == 'Returned'` in prior month | M1 |
| `nsf_count_t90d` | 90 days | Same over prior 3 months | M1 |
| `reversed_count_t30d` | 30 days | Count of payments where `is_reversed == 1` | M1 |
| `reversed_count_t90d` | 90 days | Same over prior 3 months | M1 |
| `nsf_count_lifetime` | Lifetime | Total returned payments per `lease_id` across all time | M1 |

---

## 12. Resident Sentiment (`02_build_features.py` §10)

Source: `prod.gold.bi_hlp_entkingsley_response_summary` → `data/kingsley_raw.parquet`  
**Join key:** `yardi_property_code` (NOT `property_id` — Kingsley uses a different internal ID)  
**Join method:** `pd.merge_asof` with `direction='backward'`, `tolerance=2 years` — takes the most recent Kingsley report on or before each `scoring_month`.

| Feature | Type | Engineering | Model |
|---------|------|-------------|-------|
| `kingsley_score_latest` | Raw | `AvgScoreWithoutProspect` from most recent report ≤ scoring_month | M1, M2 |
| `kingsley_n_responses` | Raw | `NumSurveysWithoutProspects` from same report | M1 |
| `kingsley_data_age_months` | **Derived** | `(scoring_month − Report_Date).days / 30.44` — data quality signal | M1 |

---

## 13. Submarket Features (`02_build_features.py` §11)

Source: `monthly_geography_submarke.csv` + `monthly_transactions_submarket.csv` (RealPage)  
**PIT shift:** Both files have their `scoring_month` shifted forward 1 month (data reflects end of prior month).  
**Join keys:** `(marketid, submarketid, scoring_month)` — note `submarketid` is per-market, not globally unique.

### Geography file (`monthly_geography_submarke.csv`)

| Feature | Raw column | Engineering |
|---------|------------|-------------|
| `submarket_askingrent_psf` | `askingrpsf` | Direct (raw) |
| `submarket_effectiverent_psf` | `effectiverpsf` | Direct (raw) |
| `submarket_rent_change_t12m_pct` | `yoyeffectiverentchange` | Direct (raw) |
| `submarket_ss_rent_change_t12m_pct` | `ssyoyeffectiverentchange` | Same-store YoY rent change |
| `submarket_occupancy_pct` | `occupancy` | Direct (raw) |
| `submarket_occupancy_change_t12m` | `yoyoccupancychange` | Direct (raw) |
| `submarket_vacancyrate` | `vacancyrate` | Direct (raw) |
| `submarket_concession_pct` | `concessionpercentaskingrent` | Direct (raw) |
| `submarket_pct_units_w_concessions` | `percentofunitsofferingconcessions` | Direct (raw) |
| `submarket_properties_sampled` | `propertiessampled` | Used for quality flag only |
| `submarket_sample_size_low` | — | **Derived:** `propertiessampled < 30` → 1/0 |

### Transactions file (`monthly_transactions_submarket.csv`)

| Feature | Raw column | Notes |
|---------|------------|-------|
| `submarket_renewal_conversion` | `renewalconversion` | **Top feature** |
| `submarket_renewal_rate_change` | `renewalleaseratechange` | |
| `submarket_renewal_lease_term` | `renewalleaseterm` | |
| `submarket_avg_vacant_days` | `averagevacantdays` | |
| `submarket_rent_to_income_ratio` | `medianrenttoincomeratio` | Falls back to market-level if null |
| `submarket_new_lease_demand_yoy` | `yoyexecutednewleasecountchange` | |

---

## 14. Market Macro Features (`02_build_features.py` §12)

Source: `monthly_geography_market.csv` + `monthly_transactions_market.csv` (RealPage)  
**PIT shift:** Same +1 month shift as submarket.  
**Join key:** `(marketid, scoring_month)`

| Feature | Raw column | Notes |
|---------|------------|-------|
| `market_employment_change_yoy` | `yoyemploymentchangepercent` | |
| `market_multifamily_permits_yoy` | `annualmultifamilypermits` | |
| `market_unit_starts_annual` | `annualunitstarts` | |
| `market_renewal_conversion` | `renewalconversion` | Fallback when submarket null |
| `market_rent_to_income_ratio` | `medianrenttoincomeratio` | Fills `submarket_rent_to_income_ratio` nulls |

---

## 15. Comp-Set Features (`02_build_features.py` §13)

Source: `realpage_crosswalk.csv` (10 comp IDs per property) + `property_performance.csv`  
**Method:** Melt comp columns → long format → join each comp to their `property_performance` row at matching `scoring_month` → aggregate across up to 10 comps.

| Feature | Engineering | Model |
|---------|-------------|-------|
| `compset_avg_effectiverpsf` | Mean `effectiverpsf` across all comps with data at `scoring_month` | Both |
| `compset_avg_occupancy` | Mean `occupancy` across comps | Both |
| `compset_concession_intensity` | Mean `percentofunitsofferingconcessions` across comps | Both |
| `compset_rent_change_t12m_pct` | Mean `yoyeffectiverentchange` across comps | Both |
| `compset_n_comps_with_data` | Count of comps that had data at this scoring_month | Data quality |
| `compset_data_quality_flag` | `compset_n_comps_with_data < 7` → 1/0 | Both |
| `property_to_compset_rent_gap_pct` | **Placeholder — NaN in v1.** Full computation requires `rent_detail` psf; not yet pulled. | Both |

---

## 16. Derived / Engineered Cross-Features (`02_build_features.py` §14)

| Feature | Engineering | Model |
|---------|-------------|-------|
| `rent_to_market_gap_pct` | `(scheduled_rent − submarket_effectiverent_psf × avg_unit_sqft) / (submarket_effectiverent_psf × avg_unit_sqft)` — NaN when `avg_unit_sqft` not available; flagged by `submarket_sample_size_low` | Both |
| `cumulative_rent_increase_pct_during_tenure` | `(scheduled_rent − base_rent) / base_rent` — total rent growth since lease signed | M1 |

---

## 17. Data Quality Flags (`02_build_features.py` §15–16)

| Feature | Engineering |
|---------|-------------|
| `realpage_join_quality_flag` | Hard-coded 0 for v1 (all cohort properties have valid RealPage crosswalk) |
| `compset_data_quality_flag` | See §15 above |
| `kingsley_data_age_months` | See §12 above |
| `submarket_sample_size_low` | See §13 above |
| `lease_unclassified_flag` | See §2 above (training exclusion, not a model feature) |

---

## 18. Categorical Encoding (`02_build_features.py` §16)

The following columns are label-encoded with `pd.Categorical().cat.codes` (−1 mapped to NaN):

`state`, `fund`, `asset_class`, `assetclassmarket`, `geographical_region`, `revenue_management_software`, `buildingclass`, `property_style`, `traffic_source`, `traffic_category`, `lease_type`, `move_out_reason_group`

---

## 19. Model 2 — Additional Inputs (`04_train_model2.py`)

Model 2 (renewal acceptance) uses a subset of M1 features plus offer-specific columns and M1 hazard scores.

### Renewal offer event columns (from `renewal_offers.parquet`)

Source: `prod.silver.stg_entrata_mf_gig_lease` filtered to rows where `renewal_rent IS NOT NULL AND renewal_rent > 0`

| Feature | Type | Engineering |
|---------|------|-------------|
| `renewal_rent` | Raw | `stg_entrata_mf_gig_lease.renewal_rent` |
| `rent_at_offer_time` | Raw | `stg_entrata_mf_gig_lease.scheduled_rent` at offer time |
| `offered_increase_pct` | **Derived** | `(renewal_rent − scheduled_rent) / scheduled_rent` — the treatment variable |
| `mtm_rent` | Raw | `stg_entrata_mf_gig_lease.mtm_rent` — month-to-month alternative |
| `accepted_renewal` | **Derived** | 1 if `next_lease.is_renewal = '1' AND next_lease.unit_id = current.unit_id` — M2 label |

### M1 hazard scores (from `m1_scores.parquet`)

| Feature | Engineering |
|---------|-------------|
| `churn_score_1m` | M1 output: P(churn within 1 month) at `offer_scoring_month` |
| `churn_score_3m` | M1 output: P(churn within 3 months) |
| `churn_score_6m` | M1 output: P(churn within 6 months) |

### M1 context features carried into M2

`physical_occupancy_pct`, `property_renewal_rate_t3m`, `property_renewal_rate_t12m`, `wo_count_t90d`, `nsf_count_lifetime`, `kingsley_score_latest`, `submarket_renewal_conversion`, `submarket_rent_change_t12m_pct`, `submarket_occupancy_pct`, `market_renewal_conversion`, `denial_rate_t90d`, `lead_to_lease_conversion_t90d`, `days_until_state_ntv_deadline`, `cumulative_rent_increase_pct_during_tenure`, `state`, `fund`, `asset_class`, `geographical_region`, `revenue_management_software`, `buildingclass`, `daily_pricing_flag`, `market_rate_unit_share`, `pets_count`, `vehicles_count`, `income_at_application`, `rent_to_income_ratio`, `lease_end_month`, `lease_end_quarter`, `is_covid_era`

---

## 20. Features Skipped in v1 (Planned for v2)

| Feature | Why skipped | Data needed |
|---------|-------------|-------------|
| `rent_change_t3m_pct` | Requires rent history time series | `stg_entrata_mf_gig_rent_detail` |
| `rent_change_t12m_pct` | Same | `stg_entrata_mf_gig_rent_detail` |
| `property_to_compset_rent_gap_pct` | Requires unit sqft for $/psf conversion | `stg_entrata_mf_gig_dim_unit` (pulled but not joined) |
| `unit_renovated_within_lease` | Renovation table not yet pulled | `prod.gold.gold_renovation` |
| `building_renovation_intensity_t90d` | Same | `prod.gold.gold_renovation` |
| `outstanding_debt_amount` | SHA ResidentKey has no join path to `lease_id` — flagged for Ganesh | `stg_entrata_mf_gig_outstanding_debt` |
| `wo_avg_completion_days_t90d` | Not computed in v1 — only counts, not durations | `wo_raw.parquet` (already pulled) |
| `delinquency_events` | Pulled (`data/delinquency_events_raw.parquet`) but not yet joined | `hlp_entrata_mf_gig_delinquency_event_lease_interval` |

---

## Summary Count

| Feature group | Approx. count | Model |
|---------------|--------------|-------|
| Lease/tenure timing | 5 | M1 |
| Hazard timing | 3 | M1 |
| Jurisdiction | 2 | Both |
| Resident / lease static | 17 | Both |
| Property attributes | 12 | Both |
| Seasonality | 4 | Both |
| Funnel (raw + derived) | 13 | M1 |
| Occupancy + renewal rate | 6 | Both |
| Work orders | 5 | M1 |
| Payments / NSF | 5 | M1 |
| Sentiment (Kingsley) | 3 | Both |
| Submarket | 12 | Both |
| Market macro | 5 | Both |
| Comp-set | 5 | Both |
| Derived cross-features | 2 | Both |
| Data quality flags | 4 | Both |
| M2-specific (offer + scores) | 6 | M2 only |
| **Total (approx.)** | **~109** | |
