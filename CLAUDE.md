# CLAUDE.md — Lease Renewal Project

This repo has two parts that live side by side:
- **Python model pipeline** (root-level `.py` files + CSV files)
- **Next.js dashboard** (`src/`)

Read this file before touching anything.

---

## Running the Python pipeline

Scripts must be run in order. Each one depends on outputs from the prior step.

```bash
python pull_lease_panel.py    # pulls lease_panel.parquet (~2M rows)
python pull_remaining.py      # pulls 9 supporting parquets
python 02_build_features.py   # builds m1_features.parquet (~70 features)
python 03_train_model1.py     # trains + saves model1.pkl, m1_scores.parquet
python 04_train_model2.py     # trains + saves model2.pkl, m2_features.parquet
python 05_pricing_recommender.py
python 06_evaluate.py
```

Databricks auth uses profile `Prod` via `databricks.sdk.config.Config`. The SSL workaround at the top of pull files (`REQUESTS_CA_BUNDLE = certifi.where()`) is intentional — Greystar's Fortinet proxy intercepts TLS and requires certifi's bundle. Do not remove it.

## Running the dashboard

```bash
npm install
npm run dev      # localhost:3000
```

Before writing any Next.js code, read `AGENTS.md` — this version has API changes that differ from standard Next.js training data.

---

## What NOT to commit

`data/*.parquet` and `data/*.pkl` are gitignored. Do not add them. The `data/` folder holds files up to 87MB. Only the three JSON files in `data/` are committed.

Never commit `test_cohort.csv` changes without verifying the property list against Databricks — it drives every SQL `WHERE property_id IN (...)` filter.

---

## Critical model code patterns

**Feature columns are selected by exclusion, not inclusion** (`03_train_model1.py`, `SKIP_COLS`). Any new column added to `m1_features.parquet` that isn't in `SKIP_COLS`, isn't object dtype, and isn't datetime automatically becomes a model feature. Always add new columns to `SKIP_COLS` explicitly if they're not intended as features.

**`panel_lease_months` is defined once in the work order section (§8) and reused in payments (§9).** It's `panel[['lease_id', 'scoring_month']].drop_duplicates()`. Don't reorder those blocks.

**`property_to_compset_rent_gap_pct` is hardcoded to `np.nan`** in `02_build_features.py` — the computation above it is dead code. The real implementation requires unit-level sqft from `rent_detail`. Don't treat its feature importance as meaningful.

**The `by-lease-end` horizon** sets `horizon_months` to `(days_to_end / 30).round()`. For leases far from expiry this produces values well above 6, which the model has never seen at the fixed horizons. This is a known extrapolation edge case.

**Kingsley `merge_asof`** requires the panel to be sorted by `scoring_month` before the merge. The code creates a sorted copy (`panel_sorted`) but leaves `panel` unsorted. The result is merged back via key join — this is correct but easy to misread.

**Submarket period parsing** (`sub_geo['period'].str.replace('Y','').str.replace('M','-') + '-01'`) parses `Y2022M01` format. If RealPage changes this format, the result is silently NaT — add an assertion if refreshing submarket data.

**Rolling window `.fillna(0)`** — work orders and payments fill missing windows with 0 (correct: no events = 0). If you add a new rolling feature where 0 and "no data" mean different things, handle the fill separately.

---

## Data sources reference

| Parquet | Source table | Notes |
|---------|-------------|-------|
| `lease_panel.parquet` | `stg_entrata_mf_gig_lease` × `union_entrata_mf_gig_rd_all_lease_months` | Main spine |
| `resident_attrs.parquet` | `stg_entrata_mf_gig_dim_resident` + pets/vehicles/income/evictions | FHA exclusions applied at pull time |
| `funnel_monthly.parquet` | `oaa_fact_leasing_funnel` | Property-level, gold table |
| `wo_raw.parquet` | `stg_entrata_mf_gig_work_order` | Silver; cancelled WOs filtered in Python |
| `payment_raw.parquet` | `stg_entrata_mf_gig_payment` | NSF = `payment_status_type_name == 'Returned'` |
| `kingsley_raw.parquet` | `bi_hlp_entkingsley_response_summary` | Join on `yardi_property_code`, NOT `property_id` |
| `occupancy_monthly.parquet` | `oad_occupancy` | Lagged 1 month before join for PIT correctness |
| `leasing_rent_monthly.parquet` | `oad_leasing_rent` | Same lag |
| `renewal_offers.parquet` | `stg_entrata_mf_gig_lease` filtered to `renewal_rent IS NOT NULL` | M2 spine |

All SQL queries that generate these files are in `pull_lease_panel.py` and `pull_remaining.py`.

---

## FHA hard exclusions

Never add these to any feature set or model input under any circumstances:
`gender`, `marital_status`, `birth_date`, `household_relationship`, `number_of_minor_occupants`, `number_of_children`

These are excluded at the SQL pull level. If you ever modify `RESIDENT_ATTRS_SQL`, do not re-add them.

---

## Entrata-specific gotchas

- `is_renewal` is a STRING in Entrata (`'1'` not `1`) — the SQL uses `= '1'`
- `lease_transfer_indicator` is 100% NULL — LTO signal is `notice_to_transfer_date IS NOT NULL`
- `lease_status_type_name = 'Past'` is the critical training filter — without it ~39% of apparent churn rows are cancelled leases
- `primary_resident_id` is stable across renewals in Entrata (no name-based dedup needed, unlike Yardi)
- `submarketid` is per-market, not globally unique — always join on `(marketid, submarketid)` tuples

---

## Dashboard patterns

**Risk factors and action items are computed on-demand** per resident in `src/lib/data.ts` (`expandResident()`). The dashboard loads only lightweight summaries for 28K residents. Don't move expensive computation into the summary array.

**Rent recommendation logic** is in `src/lib/rentLogic.ts`. Constraints apply in a fixed order: M2 score → risk tier adjustment → occupancy strategy cap → rent control cap. Each step is surfaced in the UI so PMs can see why a recommendation was made. Don't reorder or collapse these steps.

**No live API.** All model outputs are pre-computed into `src/data/residents.json`. Updating scores requires re-running the Python pipeline and regenerating the JSON.

**Charts are hand-rolled SVGs** — no chart library. Don't add one without checking bundle size impact.

**Hardcoded user** in `Navbar.tsx`: "Karishma Rana, Asset Manager". Update when moving to multi-user.
