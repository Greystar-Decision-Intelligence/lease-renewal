"""
Phase 5 — Renewal pricing recommendation with jurisdictional cap.

For each renewal-offer event (or any active lease), produces:
  - optimal_increase_pct: recommended rent increase
  - expected_revenue:     expected annualized rent under recommendation
  - cap_constrained:      whether the recommendation was capped

Writes:
  data/renewal_recommendations.parquet
"""
import warnings; warnings.filterwarnings('ignore')
import pickle
import pandas as pd
import numpy as np
from pathlib import Path

DATA = Path("data")

# ── Load models ───────────────────────────────────────────────────────────────
with open(DATA / "model1.pkl", 'rb') as f:
    m1 = pickle.load(f)
with open(DATA / "model2.pkl", 'rb') as f:
    m2 = pickle.load(f)

model1, feat_cols_m1 = m1['model'], m1['feature_cols']
model2, feat_cols_m2 = m2['model'], m2['feature_cols']

# ── Load renewal events with M1 scores ────────────────────────────────────────
m2_feat = pd.read_parquet(DATA / "m2_features.parquet")

# ── v1 pricing approach ───────────────────────────────────────────────────────
# M2 was trained on data where 99.97% of offers were flat renewals, so it learned
# no price elasticity — the revenue optimizer degenerates to always recommending
# the maximum increase. Instead, v1 uses M2's p_accept as a "pricing headroom"
# signal: residents likely to accept a flat offer are also likely to accept a
# modest increase, so we capture incremental revenue from them while protecting
# occupancy for at-risk residents.
#
# Tiers (before jurisdictional cap):
#   p_accept > 0.80  → raise by submarket trend + 3%, capped at 5%
#   p_accept 0.65-0.80 → raise by submarket trend + 1%, capped at 3%
#   p_accept < 0.65  → flat (protect occupancy)
#
# NOTE: p_accept is fixed (no elasticity data), so revenue estimates are upper
# bounds — actual gains will be lower as some high-p_accept residents churn at
# higher rents. Replace with elasticity-aware optimizer when A/B data is available.

RELET_DAYS = 45  # assumed vacancy days if resident churns

# Score all rows with M2 upfront (vectorised — avoids row-by-row predict overhead)
_m2_feat_cols = model2.feature_names_in_ if hasattr(model2, 'feature_names_in_') else feat_cols_m2


def _score_all(df):
    X = df[feat_cols_m2].astype(float)
    return model2.predict_proba(X)[:, 1]


def recommend_rent_increase(row):
    current_rent = row.get('rent_at_offer_time', row.get('scheduled_rent', np.nan))
    if pd.isna(current_rent) or current_rent <= 0:
        return {'optimal_increase_pct': np.nan, 'expected_revenue': np.nan,
                'cap_constrained': False, 'pricing_method': 'no_rent_data'}

    p_accept = row.get('_p_accept', np.nan)
    submarket_change = row.get('submarket_rent_change_t12m_pct', np.nan)
    market_signal = float(submarket_change) if pd.notna(submarket_change) else 0.0
    market_signal = np.clip(market_signal, 0.0, 0.05)  # ignore submarket declines

    if pd.isna(p_accept) or p_accept < 0.65:
        raw_inc = 0.0
        method = 'at_risk_flat'
    elif p_accept < 0.80:
        raw_inc = min(market_signal + 0.01, 0.03)
        method = 'moderate_acceptance'
    else:
        raw_inc = min(market_signal + 0.03, 0.05)
        method = 'high_acceptance'

    # Apply jurisdictional cap (legal review required — caps.csv is DRAFT)
    cap = row.get('jurisdiction_max_rent_increase_pct', np.nan)
    cap_constrained = False
    if pd.notna(cap) and raw_inc > cap:
        raw_inc = float(cap)
        cap_constrained = True

    relet_rev = current_rent * (365 - RELET_DAYS) / 365
    expected_rev = (p_accept * current_rent * (1 + raw_inc) * 12
                    + (1 - p_accept) * relet_rev * 12) if pd.notna(p_accept) else current_rent * 12
    return {
        'optimal_increase_pct': raw_inc,
        'expected_revenue': expected_rev,
        'cap_constrained': cap_constrained,
        'pricing_method': method,
    }


print("Generating pricing recommendations...")
# Run on the validation set (2025+) as a backtest
backtest = m2_feat[m2_feat['lease_end_date'] >= '2025-01-01'].copy()

# Score all offers with M2 upfront (vectorised) so recommend_rent_increase can read _p_accept per row
_X = backtest[feat_cols_m2].astype(float)
backtest['_p_accept'] = model2.predict_proba(_X)[:, 1]

results = backtest.apply(recommend_rent_increase, axis=1, result_type='expand')
backtest[['optimal_increase_pct', 'expected_revenue', 'cap_constrained', 'pricing_method']] = results

# Constraint adherence check
cap_violations = backtest[
    backtest['jurisdiction_max_rent_increase_pct'].notna() &
    (backtest['optimal_increase_pct'] > backtest['jurisdiction_max_rent_increase_pct'] + 0.001)
]
print(f"  Jurisdictional cap violations: {len(cap_violations)} (should be 0)")
print(f"  Cap-constrained recommendations: {backtest['cap_constrained'].sum():,}")
print(f"  Median recommended increase: {backtest['optimal_increase_pct'].median():.1%}")
print(f"  Mean recommended increase:  {backtest['optimal_increase_pct'].mean():.1%}")
print(f"\n  Risk bucket breakdown:")
for method, grp in backtest.groupby('pricing_method'):
    print(f"    {method}: {len(grp):,} ({len(grp)/len(backtest):.1%})  median_inc={grp['optimal_increase_pct'].median():.1%}")

# Backtest: compare to actual decisions
if 'accepted_renewal' in backtest.columns:
    actual_increases = backtest['offered_increase_pct'].clip(0, 0.15)
    rec_increases = backtest['optimal_increase_pct']
    print(f"\n  Actual median increase: {actual_increases.median():.1%}")
    print(f"  Model median increase:  {rec_increases.median():.1%}")

backtest.to_parquet(DATA / "renewal_recommendations.parquet", index=False)
print(f"\nRecommendations saved → data/renewal_recommendations.parquet  ({len(backtest):,} rows)")
print("Done.")
