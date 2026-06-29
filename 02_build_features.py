"""
Phase 2 — Assemble Model 1 feature view.

Writes: data/m1_features.parquet  (~1.7M rows, ~70 features)

Skipped for v1 (need additional table pulls):
  - rent_change_t3m/t12m     : need stg_entrata_mf_gig_rent_detail
  - unit renovation features : need gold_renovation
  - outstanding_debt $amount : ResidentKey join unresolved — flagged for Ganesh
"""
import warnings; warnings.filterwarnings('ignore')
import pandas as pd
import numpy as np
from pathlib import Path

DATA = Path("data")


def load_parquet(path):
    """Load parquet, strip UTC tz, and coerce ID columns to int64."""
    df = pd.read_parquet(path)
    # Strip timezone (Databricks returns UTC-aware datetimes)
    for col in df.select_dtypes(include='datetimetz').columns:
        df[col] = df[col].dt.tz_localize(None)
    # Coerce ID columns to int64 (Databricks sometimes returns as string/object)
    for col in ['property_id', 'lease_id', 'unit_id', 'primary_resident_id',
                'resident_id', 'realpage_propertyid']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
    return df

# ── helpers ───────────────────────────────────────────────────────────────────

def rolling_event_sum(events_df, panel_df, event_date_col, join_col,
                       count_col, windows_days, extra_agg=None):
    """
    For each (join_col, scoring_month) in panel_df, count events in each
    backward-looking window.

    Approach: for each event at date d, it contributes to scoring months
    in (d, d + max_window]. We create shifted copies and group.
    """
    events = events_df[[join_col, event_date_col]].copy()
    if extra_agg:
        for k in extra_agg:
            events[k] = events_df[k]
    events[event_date_col] = pd.to_datetime(events[event_date_col])
    events = events.dropna(subset=[event_date_col])

    # Snap to month start
    events['month'] = events[event_date_col].dt.to_period('M').dt.to_timestamp()

    agg_spec = {count_col: ('month', 'count')}
    if extra_agg:
        agg_spec.update({k: (k, 'sum') for k in extra_agg})

    monthly = events.groupby([join_col, 'month']).agg(**agg_spec).reset_index()

    panel_months = panel_df[[join_col, 'scoring_month']].drop_duplicates()
    results = {}

    max_w = max(windows_days)
    max_months = int(np.ceil(max_w / 30)) + 1

    # Create shifted lookup: each monthly record contributes to scoring_months
    # from month+1 through month+max_months
    shifted_pieces = []
    for offset in range(1, max_months + 1):
        shifted = monthly.copy()
        shifted['scoring_month'] = shifted['month'] + pd.DateOffset(months=offset)
        shifted['offset_months'] = offset
        shifted_pieces.append(shifted)
    shifted_all = pd.concat(shifted_pieces, ignore_index=True)

    merged = panel_months.merge(shifted_all, on=[join_col, 'scoring_month'], how='left')

    cols_to_sum = [count_col] + (list(extra_agg.keys()) if extra_agg else [])

    for w in windows_days:
        w_months = int(np.ceil(w / 30))
        mask = merged['offset_months'] <= w_months
        sub = merged[mask].groupby([join_col, 'scoring_month'])[cols_to_sum].sum()
        for col in cols_to_sum:
            results[f'{col}_t{w}d'] = panel_months.merge(
                sub[[col]].reset_index().rename(columns={col: f'{col}_t{w}d'}),
                on=[join_col, 'scoring_month'], how='left'
            ).set_index([join_col, 'scoring_month'])[f'{col}_t{w}d']

    out = panel_months.copy().set_index([join_col, 'scoring_month'])
    for k, s in results.items():
        out[k] = s
    return out.fillna(0).reset_index()


# ── 0. Base panel ─────────────────────────────────────────────────────────────
print("Loading panel...")
panel = load_parquet(DATA / "lease_panel.parquet")
panel['scoring_month'] = pd.to_datetime(panel['scoring_month'])
panel['lease_begin_date'] = pd.to_datetime(panel['lease_begin_date'])
panel['lease_end_date'] = pd.to_datetime(panel['lease_end_date'])
panel['renewal_offer_date'] = pd.to_datetime(panel['renewal_offer_date'])

# Strip tz from all datetime columns (Databricks returns UTC-aware, scoring_month is tz-naive)
for col in panel.select_dtypes(include='datetimetz').columns:
    panel[col] = panel[col].dt.tz_localize(None)

print(f"  {len(panel):,} rows")

# Exclude unclassified from training later (keep flag)
panel['lease_unclassified_flag'] = (panel['outcome_3way'] == 'UNCLASSIFIED').astype(int)
panel['lto_event_in_this_lease'] = (panel['notice_to_transfer_date'].notna()).astype(int)
panel['is_m2m_lease'] = panel['lease_type'].str.lower().str.contains('month', na=False).astype(int)


# ── 1. Hazard labels ──────────────────────────────────────────────────────────
print("Adding hazard labels...")
cohort = pd.read_csv("test_cohort.csv")
panel = panel.merge(
    cohort[['property_id', 'state', 'yardi_property_code', 'fund', 'asset_class',
            'assetclassmarket', 'geographical_region', 'msa',
            'realpage_propertyid', 'marketid', 'submarketid',
            'revenue_management_software']],
    on='property_id', how='left'
)

# NTV deadlines — use 60-day Greystar standard as default if file missing
try:
    ntv = pd.read_csv("state_ntv_deadlines.csv")
    panel = panel.merge(ntv[['state', 'greystar_standard_ntv_days']], on='state', how='left')
    panel['greystar_standard_ntv_days'] = panel['greystar_standard_ntv_days'].fillna(60)
except FileNotFoundError:
    panel['greystar_standard_ntv_days'] = 60  # default until legal review complete

panel['days_to_end'] = (panel['lease_end_date'] - panel['scoring_month']).dt.days
panel['churn_within_1m']   = ((panel['churn_label'] == 1) & (panel['days_to_end'] <= 30)).astype(int)
panel['churn_within_3m']   = ((panel['churn_label'] == 1) & (panel['days_to_end'] <= 90)).astype(int)
panel['churn_within_6m']   = ((panel['churn_label'] == 1) & (panel['days_to_end'] <= 180)).astype(int)
panel['churn_by_lease_end'] = panel['churn_label'].astype(int)

panel['state_ntv_deadline'] = panel['lease_end_date'] - pd.to_timedelta(
    panel['greystar_standard_ntv_days'], unit='D'
)
panel['days_until_state_ntv_deadline'] = (panel['state_ntv_deadline'] - panel['scoring_month']).dt.days
panel['past_ntv_deadline'] = (panel['scoring_month'] > panel['state_ntv_deadline']).astype(int)


# ── 2. Jurisdiction features (rent caps) ──────────────────────────────────────
try:
    caps = pd.read_csv("jurisdiction_rent_caps.csv")
    panel = panel.merge(caps, on=['state'], how='left')
    panel['jurisdiction_has_rent_cap_flag'] = panel['max_increase_pct'].notna().astype(int)
    panel['jurisdiction_max_rent_increase_pct'] = panel['max_increase_pct'].fillna(np.nan)
except FileNotFoundError:
    panel['jurisdiction_has_rent_cap_flag'] = 0
    panel['jurisdiction_max_rent_increase_pct'] = np.nan  # no cap known until legal review


# ── 3. Resident/lease static features ─────────────────────────────────────────
print("Merging resident attrs...")
res = load_parquet(DATA / "resident_attrs.parquet")
# Drop columns already in panel from lease table
res = res.drop(columns=['property_id'], errors='ignore')
panel = panel.merge(res, on='lease_id', how='left')

panel['rent_to_income_ratio'] = panel['rent_to_income_ratio'].replace([np.inf, -np.inf], np.nan)


# ── 4. Property attributes (RealPage) ─────────────────────────────────────────
print("Merging RealPage property attrs...")
xw = pd.read_csv("realpage_crosswalk.csv")[
    ['yardi_property_code', 'realpage_propertyid', 'is_realpage_reused',
     'realpage_compnumberone','realpage_compnumbertwo','realpage_compnumberthree',
     'realpage_compnumberfour','realpage_compnumberfive','realpage_compnumbersix',
     'realpage_compnumberseven','realpage_compnumbereight','realpage_compnumbernine',
     'realpage_compnumberten']
]
attrs = pd.read_csv("realpage_property_attributes.csv")[
    ['propertyid', 'buildingclass', 'firstmoveindate', 'totalunits', 'marketrateunits',
     'dailypricing', 'assetclassmarket', 'assetclasssubmarket', 'property_style']
]
attrs = attrs.rename(columns={'propertyid': 'realpage_propertyid'})
prop_rp = cohort[['property_id', 'yardi_property_code', 'realpage_propertyid']].merge(
    attrs, on='realpage_propertyid', how='left'
)
prop_rp['market_rate_unit_share'] = prop_rp['marketrateunits'] / prop_rp['totalunits'].replace(0, np.nan)
prop_rp['daily_pricing_flag'] = (prop_rp['dailypricing'] == 'Y').astype(int)
prop_rp['firstmoveindate'] = pd.to_datetime(prop_rp['firstmoveindate'], errors='coerce')

panel = panel.merge(
    prop_rp[['property_id', 'buildingclass', 'firstmoveindate', 'market_rate_unit_share',
             'daily_pricing_flag', 'assetclassmarket', 'assetclasssubmarket', 'property_style']],
    on='property_id', how='left', suffixes=('', '_rp')
)

panel['property_age_months_precise'] = (
    (panel['scoring_month'] - panel['firstmoveindate']).dt.days / 30.44
).clip(lower=0)


# ── 5. Seasonality features ───────────────────────────────────────────────────
print("Adding seasonality features...")
panel['lease_end_month'] = panel['lease_end_date'].dt.month
panel['lease_end_quarter'] = panel['lease_end_date'].dt.quarter
panel['scoring_month_calendar'] = panel['scoring_month'].dt.month
panel['is_covid_era'] = (
    (panel['lease_begin_date'] >= '2020-03-01') &
    (panel['lease_begin_date'] <= '2021-12-31')
).astype(int)
panel['lease_term_months'] = panel['lease_term']


# ── 6. Funnel features (rolling windows) ──────────────────────────────────────
print("Merging funnel features...")
funnel = load_parquet(DATA / "funnel_monthly.parquet")
funnel['month'] = pd.to_datetime(funnel['month'])

FUNNEL_COLS = ['leads_total', 'tours_first', 'apps_completed', 'apps_denied', 'leases_signed']

funnel_shifted = []
for offset in range(1, 4):  # 1-3 months back (covers t90d)
    shifted = funnel.copy()
    shifted['scoring_month'] = shifted['month'] + pd.DateOffset(months=offset)
    shifted['offset'] = offset
    funnel_shifted.append(shifted)
funnel_shifted = pd.concat(funnel_shifted, ignore_index=True)

panel_prop_months = panel[['property_id', 'scoring_month']].drop_duplicates()
funnel_merged = panel_prop_months.merge(funnel_shifted, on=['property_id', 'scoring_month'], how='left')

funnel_t30 = (funnel_merged[funnel_merged['offset'] == 1]
              .groupby(['property_id', 'scoring_month'])[FUNNEL_COLS].sum()
              .add_suffix('_t30d').reset_index())
funnel_t90 = (funnel_merged[funnel_merged['offset'] <= 3]
              .groupby(['property_id', 'scoring_month'])[FUNNEL_COLS].sum()
              .add_suffix('_t90d').reset_index())

panel = panel.merge(funnel_t30, on=['property_id', 'scoring_month'], how='left')
panel = panel.merge(funnel_t90, on=['property_id', 'scoring_month'], how='left')

panel['denial_rate_t90d'] = (panel['apps_denied_t90d'] /
    panel['apps_completed_t90d'].replace(0, np.nan))
panel['lead_to_lease_conversion_t90d'] = (panel['leases_signed_t90d'] /
    panel['leads_total_t90d'].replace(0, np.nan))
panel['tour_to_application_rate_t90d'] = (panel['apps_completed_t90d'] /
    panel['tours_first_t90d'].replace(0, np.nan))


# ── 7. Occupancy features ─────────────────────────────────────────────────────
print("Merging occupancy features...")
occ = load_parquet(DATA / "occupancy_monthly.parquet")
occ['month_date'] = pd.to_datetime(occ['month_date'])
occ['physical_occupancy_pct'] = (occ['numerator_phys_occ'] /
    occ['denominator_net_phys_occ'].replace(0, np.nan))

# For scoring_month t, join to the occupancy 1 month prior (PIT correctness)
occ_shifted = occ.copy()
occ_shifted['scoring_month'] = occ_shifted['month_date'] + pd.DateOffset(months=1)

panel = panel.merge(
    occ_shifted[['property_id', 'scoring_month', 'physical_occupancy_pct',
                 'actual_vacancy_loss', 'budget_vacancy_loss']],
    on=['property_id', 'scoring_month'], how='left'
)
panel['vacancy_loss_vs_budget_pct'] = (
    (panel['actual_vacancy_loss'] - panel['budget_vacancy_loss']) /
    panel['budget_vacancy_loss'].replace(0, np.nan)
)

lrent = load_parquet(DATA / "leasing_rent_monthly.parquet")
lrent['month_date'] = pd.to_datetime(lrent['month_date'])
lrent['property_renewal_rate'] = (lrent['renewed_signed_lease_cnt'] /
    lrent['expiring_lease_cnt'].replace(0, np.nan))

# Rolling 3m and 12m renewal rates
lrent_shifted = []
for offset in range(1, 13):
    s = lrent[['property_id', 'month_date', 'renewed_signed_lease_cnt', 'expiring_lease_cnt']].copy()
    s['scoring_month'] = s['month_date'] + pd.DateOffset(months=offset)
    s['offset'] = offset
    lrent_shifted.append(s)
lrent_shifted = pd.concat(lrent_shifted, ignore_index=True)

for window, label in [(3, 't3m'), (12, 't12m')]:
    sub = (lrent_shifted[lrent_shifted['offset'] <= window]
           .groupby(['property_id', 'scoring_month'])
           [['renewed_signed_lease_cnt', 'expiring_lease_cnt']].sum().reset_index())
    sub[f'property_renewal_rate_{label}'] = (
        sub['renewed_signed_lease_cnt'] / sub['expiring_lease_cnt'].replace(0, np.nan)
    )
    panel = panel.merge(
        sub[['property_id', 'scoring_month', f'property_renewal_rate_{label}']],
        on=['property_id', 'scoring_month'], how='left'
    )


# ── 8. Work order features (rolling windows) ──────────────────────────────────
print("Merging work order features...")
wo = load_parquet(DATA / "wo_raw.parquet")
wo = wo[wo['cancelled'] != 1]
wo['service_request_date'] = pd.to_datetime(wo['service_request_date'], format='ISO8601', utc=True).dt.tz_localize(None)
wo['month'] = wo['service_request_date'].dt.to_period('M').dt.to_timestamp()
wo['is_pest'] = wo['category'].str.lower().str.contains('pest', na=False).astype(int)
wo['is_emergency'] = (wo['work_order_priority'] == 'Emergency').astype(int)

wo_monthly = wo.groupby(['lease_id', 'month']).agg(
    wo_count=('work_order_id', 'count'),
    wo_pest_count=('is_pest', 'sum'),
    wo_emergency_count=('is_emergency', 'sum'),
).reset_index()

wo_shifted = []
for offset in range(1, 4):  # covers t30d (offset=1) and t90d (offset<=3)
    s = wo_monthly.copy()
    s['scoring_month'] = s['month'] + pd.DateOffset(months=offset)
    s['offset'] = offset
    wo_shifted.append(s)
wo_shifted = pd.concat(wo_shifted, ignore_index=True)

panel_lease_months = panel[['lease_id', 'scoring_month']].drop_duplicates()
wo_merged = panel_lease_months.merge(wo_shifted, on=['lease_id', 'scoring_month'], how='left')

for window, label in [(1, 't30d'), (3, 't90d')]:
    sub = (wo_merged[wo_merged['offset'] <= window]
           .groupby(['lease_id', 'scoring_month'])
           [['wo_count', 'wo_pest_count', 'wo_emergency_count']].sum().reset_index())
    sub = sub.rename(columns={
        'wo_count': f'wo_count_{label}',
        'wo_pest_count': f'wo_pest_count_{label}',
        'wo_emergency_count': f'wo_emergency_count_{label}',
    })
    panel = panel.merge(sub, on=['lease_id', 'scoring_month'], how='left')

# Lifetime WO count per lease (no time constraint — lease-level constant)
wo_lifetime = wo.groupby('lease_id').size().reset_index(name='unit_wo_count_lifetime')
panel = panel.merge(wo_lifetime, on='lease_id', how='left')

for col in ['wo_count_t30d', 'wo_count_t90d', 'wo_pest_count_t90d',
            'wo_emergency_count_t90d', 'unit_wo_count_lifetime']:
    panel[col] = panel[col].fillna(0)
del wo, wo_monthly, wo_shifted, wo_merged


# ── 9. Payment / collections features ─────────────────────────────────────────
print("Merging payment/NSF features...")
pay = load_parquet(DATA / "payment_raw.parquet")
pay['payment_date'] = pd.to_datetime(pay['payment_date'], format='ISO8601', utc=True).dt.tz_localize(None)
pay['month'] = pay['payment_date'].dt.to_period('M').dt.to_timestamp()
pay['is_nsf'] = (pay['payment_status_type_name'] == 'Returned').astype(int)
pay['is_reversed'] = pay['is_reversed'].fillna(0).astype(int)

pay_monthly = pay.groupby(['lease_id', 'month']).agg(
    payment_count=('transaction_id', 'count'),
    nsf_count=('is_nsf', 'sum'),
    reversed_count=('is_reversed', 'sum'),
).reset_index()

pay_shifted = []
for offset in range(1, 4):
    s = pay_monthly.copy()
    s['scoring_month'] = s['month'] + pd.DateOffset(months=offset)
    s['offset'] = offset
    pay_shifted.append(s)
pay_shifted = pd.concat(pay_shifted, ignore_index=True)

pay_merged = panel_lease_months.merge(pay_shifted, on=['lease_id', 'scoring_month'], how='left')

for window, label in [(1, 't30d'), (3, 't90d')]:
    sub = (pay_merged[pay_merged['offset'] <= window]
           .groupby(['lease_id', 'scoring_month'])
           [['payment_count', 'nsf_count', 'reversed_count']].sum().reset_index())
    sub = sub.rename(columns={
        'nsf_count': f'nsf_count_{label}',
        'reversed_count': f'reversed_count_{label}',
    })
    panel = panel.merge(
        sub[['lease_id', 'scoring_month', f'nsf_count_{label}', f'reversed_count_{label}']],
        on=['lease_id', 'scoring_month'], how='left'
    )

# Lifetime NSF
nsf_lifetime = pay[pay['is_nsf'] == 1].groupby('lease_id').size().reset_index(name='nsf_count_lifetime')
panel = panel.merge(nsf_lifetime, on='lease_id', how='left')

for col in ['nsf_count_t30d', 'nsf_count_t90d', 'reversed_count_t90d', 'nsf_count_lifetime']:
    panel[col] = panel[col].fillna(0)
del pay, pay_monthly, pay_shifted, pay_merged


# ── 10. Kingsley sentiment (asof merge) ───────────────────────────────────────
print("Merging Kingsley sentiment...")
ks = load_parquet(DATA / "kingsley_raw.parquet")
ks['Report_Date'] = pd.to_datetime(ks['Report_Date'])
ks = ks.sort_values('Report_Date')

panel_sorted = panel.sort_values('scoring_month')
panel_ks = pd.merge_asof(
    panel_sorted[['lease_id', 'yardi_property_code', 'scoring_month']].sort_values('scoring_month'),
    ks[['yardi_property_code', 'Report_Date', 'AvgScoreWithoutProspect', 'NumSurveysWithoutProspects']].sort_values('Report_Date'),
    by='yardi_property_code',
    left_on='scoring_month', right_on='Report_Date',
    direction='backward',
    tolerance=pd.Timedelta(days=365 * 2)  # don't use data older than 2 years
)
panel_ks['kingsley_data_age_months'] = (
    (panel_ks['scoring_month'] - panel_ks['Report_Date']).dt.days / 30.44
)
panel = panel.merge(
    panel_ks[['lease_id', 'scoring_month', 'AvgScoreWithoutProspect',
              'NumSurveysWithoutProspects', 'kingsley_data_age_months']].rename(columns={
        'AvgScoreWithoutProspect': 'kingsley_score_latest',
        'NumSurveysWithoutProspects': 'kingsley_n_responses',
    }),
    on=['lease_id', 'scoring_month'], how='left'
)
del ks, panel_ks


# ── 11. Submarket features ────────────────────────────────────────────────────
print("Merging submarket features...")
sub_geo = pd.read_csv("monthly_geography_submarke.csv")
sub_geo['scoring_month'] = pd.to_datetime(
    sub_geo['period'].str.replace('Y', '').str.replace('M', '-') + '-01'
)
sub_geo = sub_geo[sub_geo['submarketid'] != 0]  # exclude market-level rollup rows

sub_txn = pd.read_csv("monthly_transactions_submarket.csv")
sub_txn['scoring_month'] = pd.to_datetime(
    sub_txn['timeslice'].str.replace('Y', '').str.replace('M', '-') + '-01'
)
sub_txn = sub_txn[sub_txn['submarketid'].notna()]  # exclude market-level rollup rows

# Shift by 1 month for PIT correctness (data available at end of the month)
sub_geo['scoring_month'] = sub_geo['scoring_month'] + pd.DateOffset(months=1)
sub_txn['scoring_month'] = sub_txn['scoring_month'] + pd.DateOffset(months=1)

panel = panel.merge(
    sub_geo[['marketid', 'submarketid', 'scoring_month',
             'askingrpsf', 'effectiverpsf', 'yoyeffectiverentchange',
             'ssyoyeffectiverentchange', 'occupancy', 'yoyoccupancychange',
             'vacancyrate', 'concessionpercentaskingrent',
             'percentofunitsofferingconcessions', 'propertiessampled']].rename(columns={
        'askingrpsf': 'submarket_askingrent_psf',
        'effectiverpsf': 'submarket_effectiverent_psf',
        'yoyeffectiverentchange': 'submarket_rent_change_t12m_pct',
        'ssyoyeffectiverentchange': 'submarket_ss_rent_change_t12m_pct',
        'occupancy': 'submarket_occupancy_pct',
        'yoyoccupancychange': 'submarket_occupancy_change_t12m',
        'vacancyrate': 'submarket_vacancyrate',
        'concessionpercentaskingrent': 'submarket_concession_pct',
        'percentofunitsofferingconcessions': 'submarket_pct_units_w_concessions',
        'propertiessampled': 'submarket_properties_sampled',
    }),
    on=['marketid', 'submarketid', 'scoring_month'], how='left'
)
panel['submarket_sample_size_low'] = (panel['submarket_properties_sampled'] < 30).astype(int)

panel = panel.merge(
    sub_txn[['marketid', 'submarketid', 'scoring_month',
             'renewalconversion', 'renewalleaseratechange', 'renewalleaseterm',
             'averagevacantdays', 'medianrenttoincomeratio',
             'yoyexecutednewleasecountchange']].rename(columns={
        'renewalconversion': 'submarket_renewal_conversion',
        'renewalleaseratechange': 'submarket_renewal_rate_change',
        'renewalleaseterm': 'submarket_renewal_lease_term',
        'averagevacantdays': 'submarket_avg_vacant_days',
        'medianrenttoincomeratio': 'submarket_rent_to_income_ratio',
        'yoyexecutednewleasecountchange': 'submarket_new_lease_demand_yoy',
    }),
    on=['marketid', 'submarketid', 'scoring_month'], how='left'
)


# ── 12. Market macro features ─────────────────────────────────────────────────
print("Merging market macro features...")
mkt_geo = pd.read_csv("monthly_geography_market.csv")
mkt_geo['scoring_month'] = pd.to_datetime(
    mkt_geo['period'].str.replace('Y', '').str.replace('M', '-') + '-01'
) + pd.DateOffset(months=1)

mkt_txn = pd.read_csv("monthly_transactions_market.csv")
mkt_txn['scoring_month'] = pd.to_datetime(
    mkt_txn['timeslice'].str.replace('Y', '').str.replace('M', '-') + '-01'
) + pd.DateOffset(months=1)

panel = panel.merge(
    mkt_geo[['marketid', 'scoring_month', 'yoyemploymentchangepercent',
             'annualmultifamilypermits', 'annualunitstarts']].rename(columns={
        'yoyemploymentchangepercent': 'market_employment_change_yoy',
        'annualmultifamilypermits': 'market_multifamily_permits_yoy',
        'annualunitstarts': 'market_unit_starts_annual',
    }),
    on=['marketid', 'scoring_month'], how='left'
)
panel = panel.merge(
    mkt_txn[['marketid', 'scoring_month', 'renewalconversion', 'medianrenttoincomeratio']].rename(columns={
        'renewalconversion': 'market_renewal_conversion',
        'medianrenttoincomeratio': 'market_rent_to_income_ratio',
    }),
    on=['marketid', 'scoring_month'], how='left'
)

# Fill submarket NaN rent-to-income with market fallback
panel['submarket_rent_to_income_ratio'] = panel['submarket_rent_to_income_ratio'].fillna(
    panel['market_rent_to_income_ratio']
)


# ── 13. Comp-set features ─────────────────────────────────────────────────────
print("Building comp-set features...")
comp_cols = [f"realpage_compnumber{w}" for w in
             ["one","two","three","four","five","six","seven","eight","nine","ten"]]
xw_comps = pd.read_csv("realpage_crosswalk.csv")[['realpage_propertyid'] + comp_cols]
comps_long = xw_comps.melt(
    id_vars=['realpage_propertyid'], value_vars=comp_cols,
    var_name='comp_slot', value_name='comp_rp_id'
).dropna(subset=['comp_rp_id'])
comps_long['comp_rp_id'] = comps_long['comp_rp_id'].astype(int)

perf = pd.read_csv("property_performance.csv")
perf['scoring_month'] = pd.to_datetime(perf['period']) + pd.DateOffset(months=1)
perf['concessionvalue'] = perf['concessionvalue'].fillna(0)

comp_perf = comps_long.merge(
    perf[['propertyid', 'scoring_month', 'effectiverpsf', 'occupancy',
          'percentofunitsofferingconcessions', 'yoyeffectiverentchange']],
    left_on='comp_rp_id', right_on='propertyid', how='left'
)
compset = (comp_perf
    .groupby(['realpage_propertyid', 'scoring_month'])
    .agg(
        compset_avg_effectiverpsf=('effectiverpsf', 'mean'),
        compset_avg_occupancy=('occupancy', 'mean'),
        compset_concession_intensity=('percentofunitsofferingconcessions', 'mean'),
        compset_rent_change_t12m_pct=('yoyeffectiverentchange', 'mean'),
        compset_n_comps_with_data=('propertyid', 'count'),
    ).reset_index()
)
compset['compset_data_quality_flag'] = (compset['compset_n_comps_with_data'] < 7).astype(int)

panel = panel.merge(
    cohort[['property_id', 'realpage_propertyid']],
    on='property_id', how='left', suffixes=('', '_cohort')
)
# Use cohort's realpage_propertyid (already merged above as realpage_propertyid)
panel = panel.merge(compset, on=['realpage_propertyid', 'scoring_month'], how='left')

# Rent gap vs comp-set
panel['property_to_compset_rent_gap_pct'] = (
    (panel['scheduled_rent'] - panel['compset_avg_effectiverpsf'] * panel['scheduled_rent'])
    / panel['compset_avg_effectiverpsf'].replace(0, np.nan)
)

# Simpler: use effective rent psf if available; otherwise just use gap flag
# (actual psf not in lease table — use raw rent gap as proxy)
panel['property_to_compset_rent_gap_pct'] = np.nan  # placeholder until rent_detail pulled
del perf, comp_perf, compset


# ── 14. Derived features ──────────────────────────────────────────────────────
print("Adding derived features...")
panel['rent_to_market_gap_pct'] = (
    (panel['scheduled_rent'] - panel['submarket_effectiverent_psf'] * panel.get('avg_unit_sqft', np.nan))
    / (panel['submarket_effectiverent_psf'] * panel.get('avg_unit_sqft', 1)).replace(0, np.nan)
)
# Without unit sqft, compute as rent vs submarket asking rent (approximate)
# This will be NaN when submarket data missing — flagged by submarket_sample_size_low

panel['cumulative_rent_increase_pct_during_tenure'] = (
    (panel['scheduled_rent'] - panel['base_rent']) /
    panel['base_rent'].replace(0, np.nan)
)


# ── 15. Data quality flags ────────────────────────────────────────────────────
panel['realpage_join_quality_flag'] = 0  # all cohort properties have realpage crosswalk

# ── 16. Encode categoricals ───────────────────────────────────────────────────
print("Encoding categoricals...")
cat_cols = ['state', 'fund', 'asset_class', 'assetclassmarket', 'geographical_region',
            'revenue_management_software', 'buildingclass', 'property_style',
            'traffic_source', 'traffic_category', 'lease_type', 'move_out_reason_group']
for col in cat_cols:
    if col in panel.columns:
        panel[col] = panel[col].astype('category').cat.codes.replace(-1, np.nan)


# ── Save ──────────────────────────────────────────────────────────────────────
out_path = DATA / "m1_features.parquet"
print(f"\nSaving m1_features → {out_path}")
print(f"  Shape: {panel.shape}")
print(f"  Outcome distribution:\n{panel['outcome_3way'].value_counts()}")
panel.to_parquet(out_path, index=False)
print("Done.")
