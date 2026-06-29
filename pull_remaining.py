"""
Phase 1 — Pull remaining parquet files from Databricks Prod.

  data/renewal_offers.parquet       Model 2 spine
  data/funnel_monthly.parquet       (property_id, month) leasing funnel counts
  data/wo_raw.parquet               raw work orders for cohort properties
  data/payment_raw.parquet          raw payments for cohort leases
  data/delinquency_events_raw.parquet delinquency notice events per lease (replaces outstanding_debt
                                      which uses SHA ResidentKey with no join path — flagged for Ganesh)
  data/kingsley_raw.parquet         Kingsley survey responses (asof in Python)
  data/occupancy_monthly.parquet    property-level occupancy
  data/leasing_rent_monthly.parquet property-level leasing/renewal rent metrics
  data/resident_attrs.parquet       static lease-level resident features
  data/unit_dim.parquet             unit-level attributes (bedrooms, sqft, unit type) — needed for
                                    unit-level market rent estimates in 07_market_price_model.py
"""

import os, pathlib, certifi
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import pandas as pd
from databricks import sql
from databricks.sdk.config import Config

HOSTNAME = "adb-8721937917042291.11.azuredatabricks.net"
HTTP_PATH = "/sql/1.0/warehouses/0b4bb1545620e462"
OUT_DIR = pathlib.Path("data")
OUT_DIR.mkdir(exist_ok=True)

cohort = pd.read_csv("test_cohort.csv")
property_ids = ", ".join(str(int(x)) for x in cohort["property_id"].dropna().unique())
yardi_codes = ", ".join(f"'{c}'" for c in cohort["yardi_property_code"].dropna().unique())

# Load resident_keys and lease_ids from already-pulled lease_outcome
lease_outcome = pd.read_parquet("data/lease_outcome.parquet")
lease_ids = ", ".join(str(int(x)) for x in lease_outcome["lease_id"].dropna().unique())


def get_connection():
    config = Config(profile="Prod")
    token = config.authenticate()["Authorization"].removeprefix("Bearer ")
    return sql.connect(
        server_hostname=HOSTNAME,
        http_path=HTTP_PATH,
        access_token=token,
    )


def pull(conn, label, sql_query, out_path):
    out_path = pathlib.Path(out_path)
    if out_path.exists():
        print(f"  {out_path.name} already exists — skipping.")
        return
    print(f"Pulling {label}...")
    with conn.cursor() as cur:
        cur.execute(sql_query)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
    df = pd.DataFrame(rows, columns=cols)
    print(f"  {len(df):,} rows → {out_path}")
    df.to_parquet(out_path, index=False)


RENEWAL_OFFERS_SQL = f"""
WITH renewal_offers AS (
  SELECT
    exp.lease_id, exp.property_id, exp.unit_id, exp.primary_resident_id,
    exp.lease_begin_date, exp.lease_end_date,
    exp.renewal_offer_date, exp.earliest_renewal_offer_date,
    exp.renewal_rent, exp.mtm_rent, exp.renewal_cancel_date,
    exp.scheduled_rent AS rent_at_offer_time,
    (exp.renewal_rent - exp.scheduled_rent) / NULLIF(exp.scheduled_rent, 0) AS offered_increase_pct,
    CASE
      WHEN nxt.is_renewal = '1' AND nxt.unit_id = exp.unit_id THEN 1
      ELSE 0
    END AS accepted_renewal
  FROM prod.silver.stg_entrata_mf_gig_lease exp
  LEFT JOIN prod.silver.stg_entrata_mf_gig_lease nxt
    ON nxt.lease_id = exp.next_lease_id
  WHERE exp.property_id IN ({property_ids})
    AND exp.lease_status_type_name = 'Past'
    AND exp.renewal_rent IS NOT NULL
    AND exp.renewal_rent > 0
    AND exp.lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
)
SELECT * FROM renewal_offers
"""

# Extra 90-day buffer on both ends for rolling window features
FUNNEL_MONTHLY_SQL = f"""
SELECT
  property_id,
  DATE_TRUNC('month', day_date) AS month,
  SUM(count_lead_new_total)               AS leads_total,
  SUM(count_tour_first)                   AS tours_first,
  SUM(count_tour_total)                   AS tours_total,
  SUM(count_application_completed)        AS apps_completed,
  SUM(count_application_approved)         AS apps_approved,
  SUM(count_application_denied)           AS apps_denied,
  SUM(count_lease_signed)                 AS leases_signed
FROM prod.gold.oaa_fact_leasing_funnel
WHERE property_id IN ({property_ids})
  AND day_date BETWEEN DATE '2021-10-01' AND DATE '2026-12-31'
GROUP BY property_id, DATE_TRUNC('month', day_date)
"""

WO_RAW_SQL = f"""
SELECT
  work_order_id, property_id, unit_id, lease_id,
  service_request_date, service_complete_date,
  category, subcategory, work_order_priority,
  cancelled, mpri_name
FROM prod.silver.stg_entrata_mf_gig_work_order
WHERE property_id IN ({property_ids})
"""

PAYMENT_RAW_SQL = f"""
SELECT
  transaction_id, property_id, lease_id, resident_id,
  payment_date, payment_amount, payment_type_id,
  payment_status_type_name, is_reversed
FROM prod.silver.stg_entrata_mf_gig_payment
WHERE property_id IN ({property_ids})
  AND payment_date BETWEEN DATE '2021-10-01' AND DATE '2026-12-31'
"""

# stg_entrata_mf_gig_outstanding_debt uses a SHA ResidentKey with no join path to
# our lease/resident IDs. Using hlp_entrata_mf_gig_delinquency_event_lease_interval
# instead — has lease_id, captures when aged-receivables notices were sent.
# Flag for Ganesh: find the correct ResidentKey → resident_id mapping if
# recent_balance_owed (dollar amount) is needed for v1.
DELINQUENCY_EVENTS_SQL = f"""
SELECT
  d.lease_id,
  d.date_aged_receivables_sent
FROM prod.silver.hlp_entrata_mf_gig_delinquency_event_lease_interval d
JOIN (
  SELECT DISTINCT lease_id
  FROM prod.silver.stg_entrata_mf_gig_lease
  WHERE property_id IN ({property_ids})
    AND lease_status_type_name = 'Past'
    AND lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
) l ON d.lease_id = l.lease_id
"""

KINGSLEY_SQL = f"""
SELECT
  yardi_property_code, Report_Date,
  NumSurveysWithoutProspects,
  AvgScoreWithoutProspect,
  TotalScoreWithoutProspect
FROM prod.gold.bi_hlp_entkingsley_response_summary
WHERE yardi_property_code IN ({yardi_codes})
"""

OCCUPANCY_MONTHLY_SQL = f"""
SELECT
  property_id, yardi_property_code, month_date,
  number_of_units,
  numerator_phys_occ, denominator_net_phys_occ,
  month_last_day_unit_count,
  month_last_day_units_excluded,
  month_last_day_units_occupied,
  actual_gross_rent, actual_vacancy_loss,
  budget_gross_rent, budget_vacancy_loss
FROM prod.gold.oad_occupancy
WHERE property_id IN ({property_ids})
  AND month_date BETWEEN DATE '2021-10-01' AND DATE '2026-12-31'
"""

LEASING_RENT_MONTHLY_SQL = f"""
SELECT
  property_id, yardi_property_code, month_date,
  number_of_units,
  expiring_lease_cnt, gross_lease_cnt, net_lease_cnt,
  renewed_signed_lease_cnt,
  total_renewal_rent_excl_concessions,
  total_renewal_rent_incl_concessions,
  gross_lease_cnt_prior_month,
  net_lease_cnt_prior_month,
  expiring_lease_cnt_prior_month,
  renewed_signed_lease_cnt_prior_month
FROM prod.gold.oad_leasing_rent
WHERE property_id IN ({property_ids})
  AND month_date BETWEEN DATE '2021-10-01' AND DATE '2026-12-31'
"""

# Static lease-level resident features — FHA hard exclusions applied:
# gender, marital_status, birth_date, household_relationship omitted
RESIDENT_ATTRS_SQL = f"""
WITH pets AS (
  SELECT p.resident_id, COUNT(*) AS pets_count
  FROM prod.silver.stg_entrata_mf_gig_pets p
  GROUP BY p.resident_id
),
vehicles AS (
  SELECT v.lease_id, COUNT(*) AS vehicles_count
  FROM prod.silver.stg_entrata_mf_gig_vehicle v
  GROUP BY v.lease_id
),
income AS (
  SELECT
    ri.resident_id,
    MAX(ri.amount) AS income_at_application
  FROM prod.silver.stg_entrata_mf_gig_resident_income ri
  GROUP BY ri.resident_id
),
eviction_flag AS (
  SELECT lease_id, 1 AS eviction_filed_flag
  FROM prod.silver.stg_entrata_mf_gig_evictions
  WHERE property_id IN ({property_ids})
)
SELECT
  l.lease_id, l.property_id, l.primary_resident_id,
  l.lease_term,
  l.online_signature_indicator AS signed_online_flag,
  l.primary_traffic_source     AS traffic_source,
  l.primary_traffic_category   AS traffic_category,
  l.concessions                AS concessions_total,
  l.scheduled_recurring_concessions AS recurring_concessions,
  l.base_rent, l.amenity_rent, l.scheduled_rent,
  CASE WHEN LOWER(l.lease_type) LIKE '%month%' THEN 1 ELSE 0 END AS is_m2m_lease,
  rd.annual_employer_income,
  rd.rent_or_own,
  rd.prior_zip_latitude,
  rd.prior_zip_longitude,
  COALESCE(p.pets_count, 0)    AS pets_count,
  COALESCE(v.vehicles_count, 0) AS vehicles_count,
  ic.income_at_application,
  CASE WHEN ic.income_at_application > 0
       THEN l.scheduled_rent / ic.income_at_application
       ELSE NULL
  END AS rent_to_income_ratio,
  COALESCE(ef.eviction_filed_flag, 0) AS eviction_filed_against_lease
FROM prod.silver.stg_entrata_mf_gig_lease l
LEFT JOIN prod.silver.stg_entrata_mf_gig_dim_resident rd
  ON rd.resident_id = l.primary_resident_id
LEFT JOIN pets p
  ON p.resident_id = l.primary_resident_id
LEFT JOIN vehicles v
  ON v.lease_id = l.lease_id
LEFT JOIN income ic
  ON ic.resident_id = l.primary_resident_id
LEFT JOIN eviction_flag ef
  ON ef.lease_id = l.lease_id
WHERE l.lease_id IN ({lease_ids})
"""


# Unit dimension — bedrooms, square footage, unit type per unit_id.
# Used in 07_market_price_model.py to produce unit-level market rent estimates
# (market_rent = effectiverpsf × unit_sqft) instead of property-wide averages.
# NOTE: verify exact column names against stg_entrata_mf_gig_dim_unit with Ganesh
# before running — common Entrata names listed here but may differ in this stream.
unit_ids = ", ".join(str(int(x)) for x in lease_outcome["unit_id"].dropna().unique())
UNIT_DIM_SQL = f"""
SELECT DISTINCT
  u.unit_id,
  u.property_id,
  u.unit_type_name,
  u.bedrooms,
  u.bathrooms,
  u.unit_size          AS sqft,
  u.floor_plan_name
FROM prod.silver.stg_entrata_mf_gig_dim_unit u
WHERE u.unit_id IN ({unit_ids})
"""

PULLS = [
    ("renewal_offers",        RENEWAL_OFFERS_SQL,        OUT_DIR / "renewal_offers.parquet"),
    ("funnel_monthly",        FUNNEL_MONTHLY_SQL,         OUT_DIR / "funnel_monthly.parquet"),
    ("wo_raw",                WO_RAW_SQL,                 OUT_DIR / "wo_raw.parquet"),
    ("payment_raw",           PAYMENT_RAW_SQL,            OUT_DIR / "payment_raw.parquet"),
    ("delinquency_events_raw",DELINQUENCY_EVENTS_SQL,     OUT_DIR / "delinquency_events_raw.parquet"),
    ("kingsley_raw",          KINGSLEY_SQL,               OUT_DIR / "kingsley_raw.parquet"),
    ("occupancy_monthly",     OCCUPANCY_MONTHLY_SQL,      OUT_DIR / "occupancy_monthly.parquet"),
    ("leasing_rent_monthly",  LEASING_RENT_MONTHLY_SQL,   OUT_DIR / "leasing_rent_monthly.parquet"),
    ("resident_attrs",        RESIDENT_ATTRS_SQL,         OUT_DIR / "resident_attrs.parquet"),
    ("unit_dim",              UNIT_DIM_SQL,               OUT_DIR / "unit_dim.parquet"),
]

if __name__ == "__main__":
    conn = get_connection()
    try:
        for label, query, path in PULLS:
            try:
                pull(conn, label, query, path)
            except Exception as e:
                print(f"  ERROR on {label}: {e}")
    finally:
        conn.close()
    print("\nAll done.")
