"""
Phase 6 — Model evaluation summary.

Prints a comprehensive eval report and saves:
  data/evaluation_report.json
"""
import warnings; warnings.filterwarnings('ignore')
import json, pickle
import pandas as pd
import numpy as np
from pathlib import Path

DATA = Path("data")

try:
    from sklearn.metrics import roc_auc_score, brier_score_loss, average_precision_score
    from sklearn.calibration import calibration_curve
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'scikit-learn', '-q'])
    from sklearn.metrics import roc_auc_score, brier_score_loss, average_precision_score

report = {}


def load_parquet(path):
    df = pd.read_parquet(path)
    for col in df.select_dtypes(include='datetimetz').columns:
        df[col] = df[col].dt.tz_localize(None)
    for col in ['property_id', 'lease_id', 'unit_id', 'primary_resident_id']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
    return df


# ── Load models & features ────────────────────────────────────────────────────
with open(DATA / "model1.pkl", 'rb') as f:
    m1 = pickle.load(f)
with open(DATA / "model2.pkl", 'rb') as f:
    m2 = pickle.load(f)

model1, feat_cols_m1 = m1['model'], m1['feature_cols']
model2, feat_cols_m2 = m2['model'], m2['feature_cols']

feat = load_parquet(DATA / "m1_features.parquet")
feat['scoring_month'] = pd.to_datetime(feat['scoring_month'])

scores = load_parquet(DATA / "m1_scores.parquet")
scores['scoring_month'] = pd.to_datetime(scores['scoring_month'])

m2_feat = load_parquet(DATA / "m2_features.parquet")

# ── Model 1 evaluation ────────────────────────────────────────────────────────
print("=" * 60)
print("MODEL 1 — Churn Risk Hazard Curve")
print("=" * 60)

# Use 2025 as validation year
val = feat[
    (feat['scoring_month'] >= '2025-01-01') &
    (feat['scoring_month'] < '2026-01-01') &
    (feat['lease_unclassified_flag'] == 0) &
    (feat['past_ntv_deadline'] == 0)
].copy()

report['model1'] = {}
horizon_map = [(1, 'churn_within_1m'), (3, 'churn_within_3m'),
               (6, 'churn_within_6m'), (None, 'churn_by_lease_end')]

for k, label_col in horizon_map:
    horizon_label = f"{k}m" if k else "by_lease_end"
    score_col = f'churn_score_{k}m' if k else None

    subset = val.copy()
    if k:
        subset['horizon_months'] = k
    else:
        subset['horizon_months'] = (subset['days_to_end'] / 30).clip(lower=1).round().astype(int)

    X = subset[feat_cols_m1].astype(float)
    y_true = subset[label_col]
    y_pred = model1.predict_proba(X)[:, 1]

    if y_true.nunique() < 2:
        continue

    auc   = roc_auc_score(y_true, y_pred)
    ap    = average_precision_score(y_true, y_pred)
    brier = brier_score_loss(y_true, y_pred)

    # Calibration: compare mean predicted prob to observed rate in deciles
    fraction_pos, mean_pred = calibration_curve(y_true, y_pred, n_bins=10)
    calib_error = np.mean(np.abs(fraction_pos - mean_pred))

    print(f"\nHorizon: {horizon_label}")
    print(f"  AUC:            {auc:.4f}")
    print(f"  Avg Precision:  {ap:.4f}")
    print(f"  Brier Score:    {brier:.4f}")
    print(f"  Calib Error:    {calib_error:.4f}  (mean |observed - predicted| across deciles)")
    print(f"  Base Rate:      {y_true.mean():.3f}")
    print(f"  N:              {len(subset):,}")

    report['model1'][horizon_label] = {
        'auc': auc, 'avg_precision': ap, 'brier': brier,
        'calibration_error': calib_error,
        'base_rate': float(y_true.mean()), 'n': len(subset)
    }

# Property-level expected churn count accuracy
print("\n--- Property-level churn forecasting (92% occupancy use case) ---")
val_prop = val.copy()
val_prop['horizon_months'] = 3
val_prop['pred_churn_3m'] = model1.predict_proba(val_prop[feat_cols_m1].astype(float))[:, 1]
prop_agg = val_prop.groupby(['property_id', 'scoring_month']).agg(
    n_leases=('lease_id', 'count'),
    actual_churn=('churn_within_3m', 'sum'),
    predicted_churn=('pred_churn_3m', 'sum')
).reset_index()
prop_mae = (prop_agg['predicted_churn'] - prop_agg['actual_churn']).abs().mean()
print(f"  Property-month mean absolute error in churn count: {prop_mae:.2f} leases")
report['model1']['property_level_mae_3m'] = float(prop_mae)

# Intervention precision: of top-10% risk leases, what fraction actually churned?
val_top10 = val.copy()
val_top10['horizon_months'] = 3
val_top10['score'] = model1.predict_proba(val_top10[feat_cols_m1].astype(float))[:, 1]
threshold = val_top10['score'].quantile(0.90)
top10 = val_top10[val_top10['score'] >= threshold]
precision_at_10 = top10['churn_within_3m'].mean()
print(f"  Intervention precision (top-10% risk): {precision_at_10:.3f}  (base rate: {val['churn_within_3m'].mean():.3f})")
report['model1']['precision_at_top10_pct_3m'] = float(precision_at_10)

# ── Model 2 evaluation ────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("MODEL 2 — Renewal Acceptance")
print("=" * 60)

m2_val = m2_feat[m2_feat['lease_end_date'] >= '2025-01-01'].copy()
m2_val = m2_val[m2_val['accepted_renewal'].notna() & m2_val['offered_increase_pct'].notna()]

report['model2'] = {}
if len(m2_val) > 0 and m2_val['accepted_renewal'].nunique() == 2:
    X_m2 = m2_val[feat_cols_m2].astype(float)
    y_m2 = m2_val['accepted_renewal']
    y_m2_pred = model2.predict_proba(X_m2)[:, 1]

    auc2   = roc_auc_score(y_m2, y_m2_pred)
    ap2    = average_precision_score(y_m2, y_m2_pred)
    brier2 = brier_score_loss(y_m2, y_m2_pred)

    frac2, mpred2 = calibration_curve(y_m2, y_m2_pred, n_bins=10)
    calib2 = np.mean(np.abs(frac2 - mpred2))

    print(f"  AUC:            {auc2:.4f}")
    print(f"  Avg Precision:  {ap2:.4f}")
    print(f"  Brier Score:    {brier2:.4f}")
    print(f"  Calib Error:    {calib2:.4f}")
    print(f"  Acceptance Rate:{y_m2.mean():.3f}")
    print(f"  N:              {len(m2_val):,}")

    # Constraint adherence
    if DATA.joinpath("renewal_recommendations.parquet").exists():
        recs = pd.read_parquet(DATA / "renewal_recommendations.parquet")
        capped = recs[recs['jurisdiction_max_rent_increase_pct'].notna()]
        violations = (capped['optimal_increase_pct'] > capped['jurisdiction_max_rent_increase_pct'] + 0.001).sum()
        print(f"\n  Cap constraint adherence: {len(capped) - violations}/{len(capped)} ({(1 - violations/max(len(capped),1)):.1%})")
        report['model2']['cap_violations'] = int(violations)

    report['model2'] = {
        'auc': auc2, 'avg_precision': ap2, 'brier': brier2,
        'calibration_error': calib2,
        'acceptance_rate': float(y_m2.mean()), 'n': len(m2_val)
    }

# ── Save report ───────────────────────────────────────────────────────────────
with open(DATA / "evaluation_report.json", 'w') as f:
    json.dump(report, f, indent=2)

print(f"\n\nEvaluation report saved → data/evaluation_report.json")
print("\n⚠️  Reminder: state_ntv_deadlines.csv and jurisdiction_rent_caps.csv are DRAFT.")
print("    Legal review required before using Model 2 recommendations in production.")
print("    FHA audit (race/ethnicity proxy features) also required before deployment.")
