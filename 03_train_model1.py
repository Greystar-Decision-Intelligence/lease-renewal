"""
Phase 3 — Train Model 1 hazard curve (churn risk).

Option A: single model with horizon_months as a feature, trained on stacked panel.

Train: scoring_month < 2025-01-01 (2022–2024)
Val:   2025-01-01 ≤ scoring_month < 2026-01-01
Test:  scoring_month ≥ 2026-01-01

Writes:
  data/model1.pkl          LightGBM model
  data/m1_scores.parquet   (lease_id, scoring_month, churn_score_1m, 3m, 6m)
  data/model1_eval.json    AUC and calibration metrics per horizon
"""
import warnings; warnings.filterwarnings('ignore')
import json, pickle
import pandas as pd
import numpy as np
from pathlib import Path

DATA = Path("data")

try:
    import lightgbm as lgb
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'lightgbm', '-q'])
    import lightgbm as lgb

from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.calibration import calibration_curve

def load_parquet(path):
    df = pd.read_parquet(path)
    for col in df.select_dtypes(include='datetimetz').columns:
        df[col] = df[col].dt.tz_localize(None)
    for col in ['property_id', 'lease_id', 'unit_id', 'primary_resident_id']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
    return df


print("Loading features...")
feat = load_parquet(DATA / "m1_features.parquet")
feat['scoring_month'] = pd.to_datetime(feat['scoring_month'])
print(f"  {len(feat):,} rows × {feat.shape[1]} columns")

# ── Feature columns ───────────────────────────────────────────────────────────
LABEL_COLS = ['churn_within_1m', 'churn_within_3m', 'churn_within_6m', 'churn_by_lease_end',
              'outcome_3way', 'churn_label', 'days_to_end', 'past_ntv_deadline',
              'lease_unclassified_flag', 'state_ntv_deadline']
ID_COLS    = ['lease_id', 'property_id', 'unit_id', 'primary_resident_id', 'resident_key',
              'scoring_month', 'yardi_property_code', 'marketid', 'submarketid',
              'realpage_propertyid']
# Also exclude _x/_y merge suffixes of any ID column
ID_COLS_EXTENDED = ID_COLS + [f'{c}_x' for c in ID_COLS] + [f'{c}_y' for c in ID_COLS]
DATE_COLS  = [c for c in feat.columns if feat[c].dtype == 'datetime64[ns]'
              or feat[c].dtype == 'object']
SKIP_COLS  = set(LABEL_COLS + ID_COLS_EXTENDED + DATE_COLS +
                 ['lease_begin_date', 'lease_end_date', 'state_ntv_deadline',
                  'renewal_offer_date', 'notice_to_vacate_date', 'notice_to_transfer_date',
                  'move_out_date', 'renewal_cancel_date', 'firstmoveindate',
                  'next_lease_id', 'previous_lease_id', 'lease_status_type_name',
                  'lease_stage', 'notice_to_vacate', 'is_renewal',
                  'renewal_rent', 'renewal_cancel_date', 'mtm_rent', 'transfer_rent',
                  'new_lease_rent', 'move_out_reason_group'])

feature_cols = [c for c in feat.columns
                if c not in SKIP_COLS
                and feat[c].dtype not in ['object', 'datetime64[ns]']
                and not c.startswith('churn_within')
                and c != 'churn_by_lease_end'
                and c != 'horizon_months']
print(f"  Feature cols: {len(feature_cols)}")

# ── Filter training data ──────────────────────────────────────────────────────
# Exclude: unclassified, past NTV deadline (not actionable), LTO events
train_mask = (
    (feat['lease_unclassified_flag'] == 0) &
    (feat['past_ntv_deadline'] == 0) &
    (feat['lto_event_in_this_lease'] == 0)
)
feat_clean = feat[train_mask].copy()
print(f"  After filters: {len(feat_clean):,} rows")

# ── Stack horizons (Option A) ─────────────────────────────────────────────────
print("Stacking horizons...")
horizon_map = [
    (1,  'churn_within_1m'),
    (3,  'churn_within_3m'),
    (6,  'churn_within_6m'),
    (None, 'churn_by_lease_end'),
]

stacked_pieces = []
for k_months, label_col in horizon_map:
    df = feat_clean.copy()
    df['horizon_months'] = k_months if k_months is not None else (
        (df['days_to_end'] / 30).clip(lower=1).round().astype(int)
    )
    df['label'] = df[label_col]
    stacked_pieces.append(df)

stacked = pd.concat(stacked_pieces, ignore_index=True)
print(f"  Stacked: {len(stacked):,} rows")

feature_cols_model = feature_cols + ['horizon_months']

# ── Train / Val / Test split ──────────────────────────────────────────────────
train = stacked[stacked['scoring_month'] <  '2025-01-01']
val   = stacked[(stacked['scoring_month'] >= '2025-01-01') &
                (stacked['scoring_month'] <  '2026-01-01')]
test  = stacked[stacked['scoring_month'] >= '2026-01-01']

print(f"  Train: {len(train):,}  Val: {len(val):,}  Test: {len(test):,}")

X_train = train[feature_cols_model].astype(float)
y_train = train['label']
X_val   = val[feature_cols_model].astype(float)
y_val   = val['label']
X_test  = test[feature_cols_model].astype(float) if len(test) > 0 else None

# ── Train LightGBM ────────────────────────────────────────────────────────────
print("Training LightGBM...")
params = dict(
    objective='binary',
    metric='auc',
    n_estimators=500,
    learning_rate=0.05,
    num_leaves=63,
    min_child_samples=50,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=5,
    reg_alpha=0.1,
    reg_lambda=0.1,
    verbose=-1,
    n_jobs=-1,
    random_state=42,
)

model = lgb.LGBMClassifier(**params)
model.fit(
    X_train, y_train,
    eval_set=[(X_val, y_val)],
    callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(100)],
)
print(f"  Best iteration: {model.best_iteration_}")

# ── Evaluate per horizon ──────────────────────────────────────────────────────
print("\nEvaluation:")
eval_results = {}

for k_months, label_col in horizon_map:
    subset = val.copy()
    subset = subset[subset['horizon_months'] == (k_months if k_months is not None else subset['horizon_months'])]
    if len(subset) == 0:
        continue
    X_sub = subset[feature_cols_model].astype(float)
    y_sub = subset[label_col]
    preds = model.predict_proba(X_sub)[:, 1]
    if y_sub.nunique() < 2:
        continue
    auc = roc_auc_score(y_sub, preds)
    label = f"{k_months}m" if k_months else "by_lease_end"
    print(f"  Val AUC ({label}): {auc:.4f}  |  base rate: {y_sub.mean():.3f}")
    eval_results[label] = {'auc': auc, 'base_rate': float(y_sub.mean()), 'n': len(subset)}

# Feature importance (top 20)
fi = pd.DataFrame({'feature': feature_cols_model,
                   'importance': model.feature_importances_})
fi = fi.sort_values('importance', ascending=False).head(20)
print("\nTop 20 features:")
print(fi.to_string(index=False))

# ── Save model ────────────────────────────────────────────────────────────────
with open(DATA / "model1.pkl", 'wb') as f:
    pickle.dump({'model': model, 'feature_cols': feature_cols_model}, f)

with open(DATA / "model1_eval.json", 'w') as f:
    json.dump(eval_results, f, indent=2)

print(f"\nModel saved → data/model1.pkl")

# ── Score full panel (all 3 horizons) ─────────────────────────────────────────
print("\nScoring full panel...")
score_rows = []
for k in [1, 3, 6]:
    score_df = feat[feat['lease_unclassified_flag'] == 0].copy()
    score_df['horizon_months'] = k
    X_score = score_df[feature_cols_model].astype(float)
    score_df[f'churn_score_{k}m'] = model.predict_proba(X_score)[:, 1]
    score_rows.append(score_df[['lease_id', 'scoring_month', f'churn_score_{k}m']])

scores = score_rows[0]
for s in score_rows[1:]:
    scores = scores.merge(s, on=['lease_id', 'scoring_month'], how='outer')

scores.to_parquet(DATA / "m1_scores.parquet", index=False)
print(f"Scores saved → data/m1_scores.parquet  ({len(scores):,} rows)")
print("Done.")
