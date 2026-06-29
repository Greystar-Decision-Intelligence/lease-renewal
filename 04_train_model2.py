"""
Phase 4 — Build Model 2 features and train renewal acceptance model.

Writes:
  data/m2_features.parquet   renewal-offer events with M1 scores + features
  data/model2.pkl            LightGBM model
  data/model2_eval.json      AUC and calibration
"""
import warnings; warnings.filterwarnings('ignore')
import json, pickle
import pandas as pd
import numpy as np
from pathlib import Path

DATA = Path("data")

try:
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'lightgbm', 'scikit-learn', '-q'])
    import lightgbm as lgb
    from sklearn.metrics import roc_auc_score

# ── Load inputs ───────────────────────────────────────────────────────────────
def load_parquet(path):
    df = pd.read_parquet(path)
    for col in df.select_dtypes(include='datetimetz').columns:
        df[col] = df[col].dt.tz_localize(None)
    for col in ['property_id', 'lease_id', 'unit_id', 'primary_resident_id']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
    return df


M1_CONTEXT_COLS = [
    'physical_occupancy_pct', 'property_renewal_rate_t3m', 'property_renewal_rate_t12m',
    'wo_count_t90d', 'nsf_count_lifetime', 'kingsley_score_latest',
    'submarket_renewal_conversion', 'submarket_rent_change_t12m_pct',
    'submarket_occupancy_pct', 'market_renewal_conversion',
    'denial_rate_t90d', 'lead_to_lease_conversion_t90d',
    'days_until_state_ntv_deadline', 'cumulative_rent_increase_pct_during_tenure',
    'state', 'fund', 'asset_class', 'geographical_region',
    'revenue_management_software', 'buildingclass', 'daily_pricing_flag',
    'market_rate_unit_share', 'pets_count', 'vehicles_count',
    'income_at_application', 'rent_to_income_ratio',
    'lease_end_month', 'lease_end_quarter', 'is_covid_era',
]

print("Loading renewal offers and M1 scores...")
offers = load_parquet(DATA / "renewal_offers.parquet")
scores = load_parquet(DATA / "m1_scores.parquet")

# Read only the columns we need — avoids loading all 156 cols (~4 GB) into RAM
import pyarrow.parquet as pq
_feat_schema_cols = pq.read_schema(DATA / "m1_features.parquet").names
_feat_cols_needed = ['lease_id', 'scoring_month'] + [c for c in M1_CONTEXT_COLS if c in _feat_schema_cols]
feat = pd.read_parquet(DATA / "m1_features.parquet", columns=_feat_cols_needed)
for col in feat.select_dtypes(include='datetimetz').columns:
    feat[col] = feat[col].dt.tz_localize(None)
if 'lease_id' in feat.columns:
    feat['lease_id'] = pd.to_numeric(feat['lease_id'], errors='coerce').astype('Int64')

offers['renewal_offer_date'] = pd.to_datetime(offers['renewal_offer_date'])
offers['lease_begin_date']   = pd.to_datetime(offers['lease_begin_date'])
offers['lease_end_date']     = pd.to_datetime(offers['lease_end_date'])
scores['scoring_month']      = pd.to_datetime(scores['scoring_month'])
feat['scoring_month']        = pd.to_datetime(feat['scoring_month'])

for df in [offers, feat]:
    for col in df.select_dtypes(include='datetimetz').columns:
        df[col] = df[col].dt.tz_localize(None)

print(f"  Offers: {len(offers):,}  |  Score rows: {len(scores):,}")

# ── Join M1 scores at renewal_offer_date ─────────────────────────────────────
# Snap offer date to month start to match scoring_month grain
offers['offer_scoring_month'] = offers['renewal_offer_date'].dt.to_period('M').dt.to_timestamp()

# m1_scores is a stacked (multi-horizon) panel so (lease_id, scoring_month) is NOT unique.
# Deduplicate first (all 3 score cols are in every row; we just need one row per key).
# Then merge all 3 columns in a single join to avoid compounding fan-out.
score_cols = ['churn_score_1m', 'churn_score_3m', 'churn_score_6m']
scores_dedup = (scores[['lease_id', 'scoring_month'] + score_cols]
                .drop_duplicates(subset=['lease_id', 'scoring_month']))
del scores
offers = offers.merge(
    scores_dedup.rename(columns={'scoring_month': 'offer_scoring_month'}),
    on=['lease_id', 'offer_scoring_month'], how='left'
)
print(f"  After score merge: {len(offers):,} rows")

# Fallback pass 1: nearest scoring_month within 90 days (handles slight misalignment)
# Fallback pass 2: lease's earliest scoring_month (handles offers that predate the scoring window)
for pass_num in [1, 2]:
    still_missing = offers[score_cols].isna().any(axis=1)
    if not still_missing.any():
        break
    for h in [1, 3, 6]:
        col = f'churn_score_{h}m'
        missing_mask = offers[col].isna()
        if missing_mask.sum() == 0:
            continue
        scores_h = scores_dedup[['lease_id', 'scoring_month', col]].dropna(subset=['scoring_month', col])
        offers_miss = (offers[missing_mask][['lease_id', 'offer_scoring_month']]
                       .pipe(lambda d: d[d['offer_scoring_month'].notna()])
                       .reset_index())
        if len(offers_miss) == 0:
            continue
        scores_sub = scores_h[scores_h['lease_id'].isin(offers_miss['lease_id'].unique())]
        merged = offers_miss.merge(scores_sub, on='lease_id', how='left')
        merged['day_diff'] = (merged['offer_scoring_month'] - merged['scoring_month']).abs()
        if pass_num == 1:
            # Only accept rows within 90 days
            merged = merged[merged['day_diff'] <= pd.Timedelta(days=90)]
        else:
            # Accept earliest available score (offer predates scoring window)
            pass
        if len(merged) > 0:
            closest = merged.sort_values('day_diff').groupby('index').first()
            offers.loc[closest.index, col] = closest[col].values

n_still_null = offers[score_cols].isna().any(axis=1).sum()
print(f"  Null churn scores after fallback: {n_still_null:,}")
del scores_dedup

# ── Join M1 feature context at offer date ─────────────────────────────────────
# Take the M1 feature row closest to the offer date for each lease.
# pandas 3.x merge_asof requires globally monotonic on-keys (not per-by-group),
# so we use a plain merge + nearest-row approach instead.
avail_context = [c for c in M1_CONTEXT_COLS if c in feat.columns]
# Narrow to only needed columns before dedup to avoid doubling the ~2GB feat DataFrame in memory
feat_for_offer_dedup = (feat[['lease_id', 'scoring_month'] + avail_context]
                        .drop_duplicates(subset=['lease_id', 'scoring_month']))
del feat  # free ~2GB before the merge

offers_with_valid_month = offers[offers['offer_scoring_month'].notna()].reset_index(drop=True)
offers_null_month = offers[offers['offer_scoring_month'].isna()].copy()

if len(offers_with_valid_month) > 0:
    offer_lease_ids = offers_with_valid_month['lease_id'].unique()
    ctx_right = (feat_for_offer_dedup
                 .dropna(subset=['scoring_month'])
                 .pipe(lambda d: d[d['lease_id'].isin(offer_lease_ids)]))
    merged_ctx = offers_with_valid_month[['lease_id', 'offer_scoring_month']].reset_index().merge(
        ctx_right, on='lease_id', how='left'
    )
    merged_ctx['_day_diff'] = (merged_ctx['offer_scoring_month'] - merged_ctx['scoring_month']).abs()
    in_window = merged_ctx[merged_ctx['_day_diff'] <= pd.Timedelta(days=90)]
    if len(in_window) > 0:
        best = in_window.loc[in_window.groupby('index')['_day_diff'].idxmin(), ['index'] + avail_context]
        offers_with_valid_month = offers_with_valid_month.merge(
            best.set_index('index')[avail_context], left_index=True, right_index=True, how='left'
        )
    else:
        for c in avail_context:
            offers_with_valid_month[c] = np.nan

for c in avail_context:
    if c not in offers_null_month.columns:
        offers_null_month[c] = np.nan

offers_with_ctx = pd.concat([offers_with_valid_month, offers_null_month], ignore_index=True)

offers_with_ctx['months_in_lease_at_offer'] = (
    (offers_with_ctx['renewal_offer_date'] - offers_with_ctx['lease_begin_date']).dt.days / 30.44
)
offers_with_ctx['months_until_lease_end_at_offer'] = (
    (offers_with_ctx['lease_end_date'] - offers_with_ctx['renewal_offer_date']).dt.days / 30.44
)

# Jurisdiction rent cap constraint for Model 2 output layer
try:
    caps = pd.read_csv("jurisdiction_rent_caps.csv")
    # needs state column in offers — merge via property
    cohort = pd.read_csv("test_cohort.csv")[['property_id', 'state']]
    offers_with_ctx = offers_with_ctx.merge(cohort, on='property_id', how='left')
    offers_with_ctx = offers_with_ctx.merge(caps, on='state', how='left')
    offers_with_ctx['jurisdiction_max_rent_increase_pct'] = offers_with_ctx['max_increase_pct'].fillna(np.nan)
except FileNotFoundError:
    offers_with_ctx['jurisdiction_max_rent_increase_pct'] = np.nan

offers_with_ctx.to_parquet(DATA / "m2_features.parquet", index=False)
print(f"M2 features saved → data/m2_features.parquet  ({len(offers_with_ctx):,} rows)")

# ── Train Model 2 ─────────────────────────────────────────────────────────────
print("\nTraining Model 2 (renewal acceptance)...")

M2_FEATURES = [
    'offered_increase_pct',
    'churn_score_1m', 'churn_score_3m', 'churn_score_6m',
    'months_in_lease_at_offer', 'months_until_lease_end_at_offer',
    'physical_occupancy_pct', 'property_renewal_rate_t3m',
    'wo_count_t90d', 'nsf_count_lifetime', 'kingsley_score_latest',
    'submarket_renewal_conversion', 'submarket_rent_change_t12m_pct',
    'market_renewal_conversion',
    'denial_rate_t90d', 'lead_to_lease_conversion_t90d',
    'cumulative_rent_increase_pct_during_tenure',
    'state', 'fund', 'asset_class', 'geographical_region',
    'revenue_management_software', 'daily_pricing_flag',
    'pets_count', 'vehicles_count', 'rent_to_income_ratio',
    'lease_end_month', 'lease_end_quarter', 'is_covid_era',
]
m2_feat_avail = [c for c in M2_FEATURES if c in offers_with_ctx.columns]

m2_data = offers_with_ctx[offers_with_ctx['accepted_renewal'].notna()].copy()
m2_data = m2_data[m2_data['offered_increase_pct'].notna()]
m2_data['offered_increase_pct'] = m2_data['offered_increase_pct'].clip(-0.5, 0.5)

# Temporal split: train < 2025, val 2025+
m2_train = m2_data[m2_data['lease_end_date'] < '2025-01-01']
m2_val   = m2_data[m2_data['lease_end_date'] >= '2025-01-01']
print(f"  M2 Train: {len(m2_train):,}  Val: {len(m2_val):,}")

X_m2_train = m2_train[m2_feat_avail].astype(float)
y_m2_train = m2_train['accepted_renewal']
X_m2_val   = m2_val[m2_feat_avail].astype(float)
y_m2_val   = m2_val['accepted_renewal']

m2_params = dict(
    objective='binary',
    metric='auc',
    n_estimators=300,
    learning_rate=0.05,
    num_leaves=31,
    min_child_samples=30,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=5,
    verbose=-1,
    n_jobs=-1,
    random_state=42,
)
model2 = lgb.LGBMClassifier(**m2_params)
model2.fit(
    X_m2_train, y_m2_train,
    eval_set=[(X_m2_val, y_m2_val)],
    callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
)

eval2 = {}
if y_m2_val.nunique() == 2:
    auc2 = roc_auc_score(y_m2_val, model2.predict_proba(X_m2_val)[:, 1])
    print(f"  M2 Val AUC: {auc2:.4f}  |  acceptance rate: {y_m2_val.mean():.3f}")
    eval2['auc'] = auc2
    eval2['acceptance_rate'] = float(y_m2_val.mean())
    eval2['n_val'] = len(m2_val)

# Feature importance
fi2 = pd.DataFrame({'feature': m2_feat_avail, 'importance': model2.feature_importances_})
fi2 = fi2.sort_values('importance', ascending=False).head(15)
print("\nTop M2 features:")
print(fi2.to_string(index=False))

with open(DATA / "model2.pkl", 'wb') as f:
    pickle.dump({'model': model2, 'feature_cols': m2_feat_avail}, f)
with open(DATA / "model2_eval.json", 'w') as f:
    json.dump(eval2, f, indent=2)

print(f"\nModel 2 saved → data/model2.pkl")
print("Done.")
