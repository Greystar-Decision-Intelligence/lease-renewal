"""
Phase 7 — Market Rent Estimation + PM Pricing Strategy.

For each active lease in the 121-property cohort, produces:
  - market_rent_estimate    what a comparable unit in this submarket rents for
  - rent_to_market_gap_pct  how far current rent is from market (negative = below market)
  - tenant_quality_score    composite payment/tenure score (0–1, higher = better tenant)
  - recommended_increase_pct risk- and quality-adjusted offer increase
  - recommended_offer_rent  dollar amount to offer at renewal
  - pricing_rationale       human-readable explanation for the PM

Writes:
  data/market_rent_model.pkl              LightGBM market rent estimator
  data/market_rent_estimates.parquet      (property_id, scoring_month, market_rent_estimate, ...)
  data/pm_pricing_recommendations.parquet full PM recommendation table
"""
import warnings; warnings.filterwarnings('ignore')
import pickle
import pandas as pd
import numpy as np
from pathlib import Path

try:
    import lightgbm as lgb
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'lightgbm', '-q'])
    import lightgbm as lgb

from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error

DATA = Path("data")


def parse_yyyymm(series):
    """Convert 'Y2022M01' → Timestamp('2022-01-01')."""
    return pd.to_datetime(
        series.str.replace('Y', '', regex=False).str.replace('M', '-', regex=False) + '-01'
    )


# ── 1. Load reference data ────────────────────────────────────────────────────

cohort = pd.read_csv('test_cohort.csv')
cohort['realpage_propertyid'] = cohort['realpage_propertyid'].astype('Int64')
cohort_rp_ids = set(cohort['realpage_propertyid'].dropna())

# Map RealPage propertyid → Greystar property_id
rp_to_gs = (cohort[['property_id', 'realpage_propertyid']]
            .dropna(subset=['realpage_propertyid'])
            .assign(realpage_propertyid=lambda d: d['realpage_propertyid'].astype(int)))

# Property attributes — static
attrs = pd.read_csv('realpage_property_attributes.csv', usecols=[
    'propertyid', 'marketid', 'submarketid', 'buildingclass', 'property_style',
    'totalunits', 'marketrateunits', 'areaperunit', 'yearbuilt', 'stories', 'dailypricing',
])
attrs['propertyid'] = attrs['propertyid'].astype(int)
attrs['property_age_years'] = (2024 - attrs['yearbuilt'].clip(1900, 2024)).fillna(30)
attrs['market_rate_unit_share'] = (attrs['marketrateunits'] / attrs['totalunits'].replace(0, np.nan)).fillna(1.0)
attrs['dailypricing_flag'] = (attrs['dailypricing'] == 'Y').astype(int)
attrs['buildingclass_enc'] = pd.Categorical(attrs['buildingclass']).codes
attrs['property_style_enc'] = pd.Categorical(attrs['property_style']).codes

# Submarket geography — monthly rent/occupancy signals
sub_geo = pd.read_csv('monthly_geography_submarke.csv')
sub_geo['scoring_month'] = parse_yyyymm(sub_geo['period'])
sub_geo = sub_geo.rename(columns={
    'effectiverent':                      'sub_effectiverent',
    'effectiverpsf':                      'sub_effectiverpsf',
    'occupancy':                          'sub_occupancy',
    'vacancyrate':                        'sub_vacancyrate',
    'concessionpercentaskingrent':        'sub_concession_pct',
    'percentofunitsofferingconcessions':  'sub_units_w_concessions',
    'yoyeffectiverentchange':             'sub_rent_yoy_chg',
    'ssyoyeffectiverentchange':           'sub_ss_rent_yoy_chg',
    'yoyoccupancychange':                 'sub_occ_yoy_chg',
})

# Submarket transactions — pricing velocity
sub_txn = pd.read_csv('monthly_transactions_submarket.csv')
sub_txn['scoring_month'] = parse_yyyymm(sub_txn['timeslice'])
sub_txn = sub_txn.rename(columns={
    'renewalconversion':              'sub_renewal_conversion',
    'newleaseratechange':             'sub_new_lease_rate_chg',
    'renewalleaseratechange':         'sub_renewal_rate_chg',
    'averagevacantdays':              'sub_avg_vacant_days',
    'medianrenttoincomeratio':        'sub_rent_to_income',
    'yoyexecutednewleasecountchange': 'sub_new_lease_yoy',
})

# Market geography — macro fallbacks
mkt_geo = pd.read_csv('monthly_geography_market.csv')
mkt_geo['scoring_month'] = parse_yyyymm(mkt_geo['period'])
mkt_geo = mkt_geo.rename(columns={
    'yoyemploymentchangepercent': 'mkt_employment_yoy',
    'annualmultifamilypermits':   'mkt_mf_permits',
    'annualunitstarts':           'mkt_unit_starts',
})

# Market transactions — macro fallbacks
mkt_txn = pd.read_csv('monthly_transactions_market.csv')
mkt_txn['scoring_month'] = parse_yyyymm(mkt_txn['timeslice'])
mkt_txn = mkt_txn.rename(columns={
    'renewalconversion':       'mkt_renewal_conversion',
    'medianrenttoincomeratio': 'mkt_rent_to_income',
})

# Property performance — training target (effectiverent per property per month)
perf = pd.read_csv('property_performance.csv')
perf['scoring_month'] = pd.to_datetime(perf['period'])
perf['propertyid'] = perf['propertyid'].astype(int)

print(f"property_performance: {len(perf):,} rows, {perf['propertyid'].nunique()} properties")


# ── 2. Assemble training dataset ──────────────────────────────────────────────

SUB_GEO_COLS = ['marketid', 'submarketid', 'scoring_month',
                'sub_effectiverent', 'sub_effectiverpsf', 'sub_occupancy',
                'sub_vacancyrate', 'sub_concession_pct', 'sub_units_w_concessions',
                'sub_rent_yoy_chg', 'sub_ss_rent_yoy_chg', 'sub_occ_yoy_chg']

SUB_TXN_COLS = ['marketid', 'submarketid', 'scoring_month',
                'sub_renewal_conversion', 'sub_new_lease_rate_chg', 'sub_renewal_rate_chg',
                'sub_avg_vacant_days', 'sub_rent_to_income', 'sub_new_lease_yoy']

MKT_GEO_COLS = ['marketid', 'scoring_month',
                'mkt_employment_yoy', 'mkt_mf_permits', 'mkt_unit_starts']

MKT_TXN_COLS = ['marketid', 'scoring_month',
                'mkt_renewal_conversion', 'mkt_rent_to_income']

ATTR_COLS = ['propertyid', 'marketid', 'submarketid',
             'buildingclass_enc', 'property_style_enc', 'property_age_years',
             'market_rate_unit_share', 'areaperunit', 'totalunits', 'stories', 'dailypricing_flag']

train_df = (
    perf
    .merge(attrs[ATTR_COLS], on='propertyid', how='inner')
    .merge(sub_geo[SUB_GEO_COLS], on=['marketid', 'submarketid', 'scoring_month'], how='left')
    .merge(sub_txn[SUB_TXN_COLS], on=['marketid', 'submarketid', 'scoring_month'], how='left')
    .merge(mkt_geo[MKT_GEO_COLS], on=['marketid', 'scoring_month'], how='left')
    .merge(mkt_txn[MKT_TXN_COLS], on=['marketid', 'scoring_month'], how='left')
)

# Market-level fallback for submarket nulls (known issue: medianrenttoincomeratio is 82.5% null)
train_df['sub_rent_to_income'] = train_df['sub_rent_to_income'].fillna(train_df['mkt_rent_to_income'])
train_df['sub_renewal_conversion'] = train_df['sub_renewal_conversion'].fillna(train_df['mkt_renewal_conversion'])

train_df['scoring_year']      = train_df['scoring_month'].dt.year
train_df['scoring_month_num'] = train_df['scoring_month'].dt.month

train_df = train_df.dropna(subset=['effectiverent'])
print(f"Training dataset: {len(train_df):,} rows, {train_df['propertyid'].nunique()} properties")


# ── 3. Train market rent model ────────────────────────────────────────────────

FEAT_COLS = [
    'sub_effectiverent', 'sub_effectiverpsf', 'sub_occupancy', 'sub_vacancyrate',
    'sub_concession_pct', 'sub_units_w_concessions', 'sub_rent_yoy_chg',
    'sub_ss_rent_yoy_chg', 'sub_occ_yoy_chg', 'sub_renewal_conversion',
    'sub_new_lease_rate_chg', 'sub_renewal_rate_chg', 'sub_avg_vacant_days',
    'sub_rent_to_income', 'sub_new_lease_yoy',
    'mkt_employment_yoy', 'mkt_mf_permits', 'mkt_unit_starts',
    'mkt_renewal_conversion', 'mkt_rent_to_income',
    'buildingclass_enc', 'property_style_enc', 'property_age_years',
    'market_rate_unit_share', 'areaperunit', 'totalunits', 'stories', 'dailypricing_flag',
    'scoring_year', 'scoring_month_num',
]

train_mask = train_df['scoring_month'] < '2025-01-01'
val_mask   = (train_df['scoring_month'] >= '2025-01-01') & (train_df['scoring_month'] < '2026-01-01')

X_train, y_train = train_df.loc[train_mask, FEAT_COLS], train_df.loc[train_mask, 'effectiverent']
X_val,   y_val   = train_df.loc[val_mask,   FEAT_COLS], train_df.loc[val_mask,   'effectiverent']

model_mkt = lgb.LGBMRegressor(
    n_estimators=800, learning_rate=0.05, num_leaves=63,
    min_child_samples=20, subsample=0.8, colsample_bytree=0.8,
    random_state=42, n_jobs=-1, verbose=-1,
)
model_mkt.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(False)],
)

val_preds = model_mkt.predict(X_val)
mae  = mean_absolute_error(y_val, val_preds)
mape = mean_absolute_percentage_error(y_val, val_preds)
print(f"Market rent model — Val MAE: ${mae:.0f}/mo  MAPE: {mape*100:.1f}%")

with open(DATA / "market_rent_model.pkl", 'wb') as f:
    pickle.dump({'model': model_mkt, 'feature_cols': FEAT_COLS}, f)


# ── 4. Score cohort properties ────────────────────────────────────────────────

cohort_perf = train_df[train_df['propertyid'].isin(cohort_rp_ids)].copy()
cohort_perf['market_rent_estimate'] = model_mkt.predict(cohort_perf[FEAT_COLS])

cohort_perf = cohort_perf.merge(
    rp_to_gs.rename(columns={'realpage_propertyid': 'propertyid'}),
    on='propertyid', how='left',
)

market_est = cohort_perf[[
    'property_id', 'propertyid', 'scoring_month',
    'effectiverent', 'effectiverpsf', 'market_rent_estimate',
    'sub_effectiverent', 'sub_occupancy', 'sub_renewal_conversion', 'sub_rent_yoy_chg',
]].copy()
market_est['rent_to_market_gap_pct'] = (
    (market_est['effectiverent'] - market_est['market_rent_estimate'])
    / market_est['market_rent_estimate']
)
market_est.to_parquet(DATA / "market_rent_estimates.parquet", index=False)
print(f"Market rent estimates: {len(market_est):,} property-month rows saved")

# ── 4b. Unit-level market rent (runs only if unit_dim.parquet has been pulled) ─
# Once pull_remaining.py is re-run, unit_dim.parquet provides bedrooms + sqft
# per unit_id. Market rent is then estimated as effectiverpsf × unit_sqft,
# which correctly accounts for unit size — a 1BR and 3BR at the same property
# are compared against genuinely comparable peers rather than the property average.
UNIT_DIM_PATH = DATA / "unit_dim.parquet"
if UNIT_DIM_PATH.exists():
    unit_dim = pd.read_parquet(UNIT_DIM_PATH)
    # Join sqft to lease panel for active leases
    lease_unit = (pd.read_parquet(DATA / "lease_panel.parquet",
                                   columns=['lease_id', 'property_id', 'unit_id', 'scoring_month'])
                    .merge(unit_dim[['unit_id', 'bedrooms', 'sqft', 'unit_type_name']],
                           on='unit_id', how='left'))
    # Unit-level market rent = market $/sqft × this unit's sqft
    lease_unit_mkt = lease_unit.merge(
        market_est[['property_id', 'scoring_month', 'effectiverpsf']],
        on=['property_id', 'scoring_month'], how='left'
    )
    lease_unit_mkt['market_rent_estimate_unit'] = (
        lease_unit_mkt['effectiverpsf'] * lease_unit_mkt['sqft']
    )
    lease_unit_mkt.to_parquet(DATA / "unit_market_rent.parquet", index=False)
    print(f"Unit-level market rent estimates: {len(lease_unit_mkt):,} rows saved")
    print(f"  Bedroom breakdown: {lease_unit_mkt['bedrooms'].value_counts().sort_index().to_dict()}")
else:
    print("unit_dim.parquet not yet pulled — market rent estimates remain at property-average level.")
    print("Re-run pull_remaining.py to get unit-level estimates.")


# ── 5. Tenant quality score ───────────────────────────────────────────────────

# Payment behavior
# payment_raw.lease_id is a different ID system — bridge via resident_id → primary_resident_id
payments = pd.read_parquet(DATA / "payment_raw.parquet")
payments['resident_id'] = pd.to_numeric(payments['resident_id'], errors='coerce').astype('Int64')

res_to_lease = (pd.read_parquet(DATA / "resident_attrs.parquet",
                                 columns=['lease_id', 'primary_resident_id'])
                  .rename(columns={'primary_resident_id': 'resident_id'})
                  .dropna(subset=['resident_id'])
                  .assign(resident_id=lambda d: d['resident_id'].astype('Int64')))

# payments.lease_id is a different ID system — drop it before bridging
payments_bridged = (payments
    .drop(columns=['lease_id'])
    .merge(res_to_lease, on='resident_id', how='inner'))

# payment_type_id=9 is the late fee charge type in Entrata
late_counts = (
    payments_bridged[payments_bridged['payment_type_id'] == 9]
    .groupby('lease_id').size().rename('late_payment_count').reset_index()
)
# 'Returned' = payment returned by bank (NSF); 'Charged Back' = chargeback
nsf_mask = payments_bridged['payment_status_type_name'].isin(['Returned', 'Charged Back'])
reversed_counts = (
    payments_bridged[nsf_mask]
    .groupby('lease_id').size().rename('nsf_or_reversed_count').reset_index()
)

# Resident static attributes (load full set needed for quality score + rent)
res_attrs = pd.read_parquet(DATA / "resident_attrs.parquet",
                             columns=['lease_id', 'scheduled_rent', 'rent_to_income_ratio'])

# Active leases at latest scoring month
panel = pd.read_parquet(DATA / "lease_panel.parquet",
                        columns=['lease_id', 'property_id', 'scoring_month',
                                 'months_in_lease_at_scoring', 'churn_label'])
panel['scoring_month'] = pd.to_datetime(panel['scoring_month'])
latest_month = panel['scoring_month'].max()
active = panel[panel['scoring_month'] == latest_month].copy()
print(f"\nActive leases at {latest_month.date()}: {len(active):,}")

active = (
    active
    .merge(late_counts,     on='lease_id', how='left')
    .merge(reversed_counts, on='lease_id', how='left')
    .merge(res_attrs,       on='lease_id', how='left')
)
active['late_payment_count']    = active['late_payment_count'].fillna(0)
active['nsf_or_reversed_count'] = active['nsf_or_reversed_count'].fillna(0)


def norm_inverse(series, cap):
    """Map 0 events → 1.0, cap+ events → 0.0."""
    return (1 - (series.clip(0, cap) / cap)).clip(0, 1)


active['payment_score'] = norm_inverse(active['late_payment_count'],    cap=6)
active['nsf_score']     = norm_inverse(active['nsf_or_reversed_count'], cap=3)
active['tenure_score']  = (active['months_in_lease_at_scoring'].clip(0, 48) / 48)

rti = active['rent_to_income_ratio'].fillna(0.35)
active['income_score'] = ((0.45 - rti.clip(0.15, 0.45)) / 0.30).clip(0, 1)

active['tenant_quality_score'] = (
    0.35 * active['payment_score']
  + 0.30 * active['nsf_score']
  + 0.25 * active['tenure_score']
  + 0.10 * active['income_score']
)
active['tenant_quality_tier'] = pd.cut(
    active['tenant_quality_score'],
    bins=[0, 0.40, 0.65, 0.85, 1.01],
    labels=['standard', 'good', 'excellent', 'exceptional'],
    right=False,
)


# ── 6. Join M1 scores, market estimates, demand signals, occupancy ────────────

m1_scores = pd.read_parquet(DATA / "m1_scores.parquet")
m1_scores['scoring_month'] = pd.to_datetime(m1_scores['scoring_month'])
latest_m1 = m1_scores[m1_scores['scoring_month'] == m1_scores['scoring_month'].max()]

latest_mkt = market_est[market_est['scoring_month'] == market_est['scoring_month'].max()].copy()

# Submarket avg_vacant_days at latest available month — demand signal
latest_sub_txn_month = sub_txn['scoring_month'].max()
sub_demand = (sub_txn[sub_txn['scoring_month'] == latest_sub_txn_month]
              [['marketid', 'submarketid', 'sub_avg_vacant_days']])

# Map property → marketid/submarketid via cohort
prop_sub = cohort[['property_id', 'marketid', 'submarketid']].dropna()

# Property-level physical occupancy
# Future months in this dataset are projections that decline unrealistically —
# use the most recent month where portfolio-average occupancy is still above 85%.
occ = pd.read_parquet(DATA / "occupancy_monthly.parquet")
occ['month_date'] = pd.to_datetime(occ['month_date'])
occ['_daily_occ'] = (occ['numerator_phys_occ'] / occ['denominator_net_phys_occ']).clip(0, 1)
monthly_avg = occ.groupby('month_date')['_daily_occ'].mean()
valid_months = monthly_avg[monthly_avg > 0.85].index
latest_occ_month = valid_months.max()
print(f"Using occupancy data from {latest_occ_month.date()} (latest valid month, avg occ: {monthly_avg[latest_occ_month]:.1%})")

occ_latest = occ[occ['month_date'] == latest_occ_month].copy()
occ_latest['property_id'] = occ_latest['property_id'].astype('int64')
occ_latest['property_occupancy_pct'] = occ_latest['_daily_occ']

# Prefer unit-level market rent if available; fall back to property average
unit_mkt_path = DATA / "unit_market_rent.parquet"
if unit_mkt_path.exists():
    unit_mkt_latest = pd.read_parquet(unit_mkt_path)
    unit_mkt_latest['scoring_month'] = pd.to_datetime(unit_mkt_latest['scoring_month'])
    unit_mkt_latest = unit_mkt_latest[
        unit_mkt_latest['scoring_month'] == unit_mkt_latest['scoring_month'].max()
    ][['lease_id', 'bedrooms', 'sqft', 'unit_type_name', 'market_rent_estimate_unit']]
else:
    unit_mkt_latest = None

pm_recs = (
    active
    .merge(latest_m1[['lease_id', 'churn_score_1m', 'churn_score_3m', 'churn_score_6m']],
           on='lease_id', how='left')
    .merge(latest_mkt[['property_id', 'market_rent_estimate',
                        'sub_occupancy', 'sub_renewal_conversion', 'sub_rent_yoy_chg']],
           on='property_id', how='left')
    .merge(prop_sub, on='property_id', how='left')
    .merge(sub_demand, on=['marketid', 'submarketid'], how='left')
    .merge(occ_latest[['property_id', 'property_occupancy_pct']],
           on='property_id', how='left')
    .rename(columns={'scheduled_rent': 'current_rent'})
)

# Overlay unit-level estimates where available
if unit_mkt_latest is not None:
    pm_recs = pm_recs.merge(unit_mkt_latest, on='lease_id', how='left')
    has_unit = pm_recs['market_rent_estimate_unit'].notna()
    pm_recs.loc[has_unit, 'market_rent_estimate'] = pm_recs.loc[has_unit, 'market_rent_estimate_unit']
    print(f"Unit-level market rent applied to {has_unit.sum():,} of {len(pm_recs):,} leases")

pm_recs['churn_score_6m']       = pm_recs['churn_score_6m'].fillna(0.5)
pm_recs['market_rent_estimate'] = pm_recs['market_rent_estimate'].fillna(pm_recs['current_rent'])

# Rent gap at the individual lease level: positive = resident pays above market
pm_recs['rent_to_market_gap_pct'] = (
    (pm_recs['current_rent'] - pm_recs['market_rent_estimate'])
    / pm_recs['market_rent_estimate']
).fillna(0)

pm_recs['risk_tier'] = pd.cut(
    pm_recs['churn_score_6m'],
    bins=[0, 0.25, 0.50, 0.75, 1.01],
    labels=['low', 'medium', 'high', 'very_high'],
    right=False,
)

# Vacancy cost: lost rent during expected relet period (dollars)
avg_vacant = pm_recs['sub_avg_vacant_days'].fillna(35)
pm_recs['vacancy_cost_estimate'] = (avg_vacant / 30 * pm_recs['market_rent_estimate']).round(0)

# Demand tier based on avg relet days in submarket
#   high   < 25 days  → vacancies fill fast, can afford turnover
#   medium 25-50 days → balanced market
#   low    > 50 days  → slow relet, vacancy is expensive
pm_recs['demand_tier'] = pd.cut(
    avg_vacant,
    bins=[0, 25, 50, float('inf')],
    labels=['high', 'medium', 'low'],
    right=False,
)

# Property occupancy modifier
#   > 94% → building is hot, can push harder (+1)
#   91–94% → at target, neutral (0)
#   < 91% → below 92% occupancy goal, protect retention (-1)
def occ_shift(pct):
    if pd.isna(pct): return 0
    if pct > 0.94:   return 1
    if pct < 0.91:   return -1
    return 0

# Demand shift: high demand → more aggressive (+1), low → more conservative (-1)
def demand_shift(tier):
    return {'high': 1, 'medium': 0, 'low': -1}.get(str(tier), 0)

pm_recs['_occ_shift']    = pm_recs['property_occupancy_pct'].map(occ_shift).astype(int)
pm_recs['_demand_shift'] = pm_recs['demand_tier'].astype(str).map(demand_shift).astype(int)
pm_recs['_total_shift']  = (pm_recs['_occ_shift'] + pm_recs['_demand_shift']).clip(-2, 2)


# ── 7. Pricing strategy ───────────────────────────────────────────────────────
#
# Base matrix: risk (rows) × tenant quality (columns, index 0–3)
# Combined shift from demand + occupancy slides the quality column ± up to 2 steps.
# A +1 shift treats the lease one quality tier higher (more aggressive);
# a -1 shift treats it one tier lower (more conservative).
#
#               | standard(0) | good(1) | excellent(2) | exceptional(3) |
# very_high (0) |     0%      |   0%    |     0%       |      0%        |
# high      (1) |     0%      |   0%    |     0%       |      1%        |
# medium    (2) |     0%      |   1%    |     2%       |      3%        |
# low       (3) |     2%      |   3%    |     4%       |      5%        |

RISK_LEVELS    = ['very_high', 'high', 'medium', 'low']
QUALITY_LEVELS = ['standard',  'good', 'excellent', 'exceptional']

INCREASE_GRID = np.array([
    [0.00, 0.00, 0.00, 0.00],  # very_high
    [0.00, 0.00, 0.00, 0.01],  # high
    [0.00, 0.01, 0.02, 0.03],  # medium
    [0.02, 0.03, 0.04, 0.05],  # low
])

JURISDICTIONAL_CAP = 0.10  # fallback; replace with jurisdiction_rent_caps.csv join for v2


def price_row(row):
    risk = str(row.get('risk_tier', 'medium'))
    qual = str(row.get('tenant_quality_tier', 'standard'))
    shift = int(row.get('_total_shift', 0))

    risk_idx = RISK_LEVELS.index(risk) if risk in RISK_LEVELS else 2
    qual_idx = QUALITY_LEVELS.index(qual) if qual in QUALITY_LEVELS else 0
    adj_qual_idx = int(np.clip(qual_idx + shift, 0, 3))

    base = INCREASE_GRID[risk_idx, adj_qual_idx]

    gap = float(row.get('rent_to_market_gap_pct') or 0)
    if gap > 0:
        # Already above market — do not raise further
        base = 0.0
    elif gap < -0.10:
        # More than 10% below market — additional 1% uplift available
        base = min(base + 0.01, 0.08)

    final = min(base, JURISDICTIONAL_CAP)
    current = float(row.get('current_rent') or row.get('market_rent_estimate') or 1500)
    vac_cost = float(row.get('vacancy_cost_estimate') or 0)
    demand = str(row.get('demand_tier', 'medium'))
    occ_pct = row.get('property_occupancy_pct')
    occ_str = f"{occ_pct*100:.0f}% occupied" if pd.notna(occ_pct) else "occupancy unknown"

    # Build rationale
    demand_note = {
        'high':   f"high-demand market (relet ~{row.get('sub_avg_vacant_days', 35):.0f} days, vacancy cost ~${vac_cost:,.0f})",
        'medium': f"moderate-demand market (relet ~{row.get('sub_avg_vacant_days', 35):.0f} days, vacancy cost ~${vac_cost:,.0f})",
        'low':    f"low-demand market (relet ~{row.get('sub_avg_vacant_days', 35):.0f} days, vacancy cost ~${vac_cost:,.0f})",
    }.get(demand, "")

    if final == 0.0 and gap > 0:
        rationale = f"Already {gap*100:.1f}% above market — hold flat"
    elif final == 0.0:
        rationale = f"High flight risk — hold flat to protect occupancy; {occ_str}, {demand_note}"
    else:
        rationale = (f"{QUALITY_LEVELS[adj_qual_idx].capitalize()} tenant, {risk.replace('_',' ')} risk "
                     f"→ {final*100:.0f}% increase; {occ_str}, {demand_note}")

    return pd.Series({
        'recommended_increase_pct': round(final, 4),
        'recommended_offer_rent':   round(current * (1 + final), 2),
        'pricing_rationale':        rationale,
    })


pm_recs = pd.concat([pm_recs, pm_recs.apply(price_row, axis=1)], axis=1)

OUT_COLS = [
    'lease_id', 'property_id', 'scoring_month', 'months_in_lease_at_scoring',
    'current_rent', 'market_rent_estimate', 'rent_to_market_gap_pct',
    'churn_score_1m', 'churn_score_3m', 'churn_score_6m', 'risk_tier',
    'tenant_quality_score', 'tenant_quality_tier',
    'late_payment_count', 'nsf_or_reversed_count',
    'demand_tier', 'sub_avg_vacant_days', 'vacancy_cost_estimate',
    'property_occupancy_pct', '_occ_shift', '_demand_shift', '_total_shift',
    'recommended_increase_pct', 'recommended_offer_rent', 'pricing_rationale',
    'sub_occupancy', 'sub_renewal_conversion', 'sub_rent_yoy_chg',
]
pm_recs[[c for c in OUT_COLS if c in pm_recs.columns]].to_parquet(
    DATA / "pm_pricing_recommendations.parquet", index=False
)
print(f"PM pricing recommendations: {len(pm_recs):,} active leases saved")

print("\n── Recommended increase distribution ──")
print(pm_recs['recommended_increase_pct'].value_counts().sort_index().to_string())
print("\n── Demand tier breakdown ──")
print(pm_recs['demand_tier'].value_counts().to_string())
print("\n── Avg vacant days by demand tier ──")
print(pm_recs.groupby('demand_tier')['sub_avg_vacant_days'].agg(['mean','min','max']).round(1).to_string())
print("\n── Occupancy shift breakdown ──")
print(pm_recs['_occ_shift'].value_counts().sort_index().to_string())
print("\n── Combined shift breakdown ──")
print(pm_recs['_total_shift'].value_counts().sort_index().to_string())
print("\n── Sample recommendations ──")
sample_cols = ['property_id','current_rent','market_rent_estimate','rent_to_market_gap_pct',
               'risk_tier','tenant_quality_tier','demand_tier','property_occupancy_pct',
               'vacancy_cost_estimate','recommended_increase_pct','pricing_rationale']
print(pm_recs[sample_cols].head(6).to_string())
