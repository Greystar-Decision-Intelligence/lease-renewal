"""
Phase 1 — Pull lease_outcome and lease_panel from Databricks Prod.

Outputs:
  data/lease_outcome.parquet   (~190K mf_gig past leases with 3-way outcome)
  data/lease_panel.parquet     (~2M rows: outcome joined to monthly spine)
"""

import os, pathlib
import certifi
# Fortinet SSL inspection proxy on Greystar network intercepts TLS.
# Force requests/urllib3 to use certifi's bundle instead of the macOS system keychain.
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import pandas as pd
from databricks import sql

HOSTNAME = "adb-8721937917042291.11.azuredatabricks.net"
HTTP_PATH = "/sql/1.0/warehouses/0b4bb1545620e462"
OUT_DIR = pathlib.Path("data")
OUT_DIR.mkdir(exist_ok=True)

cohort = pd.read_csv("test_cohort.csv")
property_ids = ", ".join(str(int(x)) for x in cohort["property_id"].dropna().unique())


def get_connection():
    from databricks.sdk.config import Config
    config = Config(profile="Prod")
    token = config.authenticate()["Authorization"].removeprefix("Bearer ")
    return sql.connect(
        server_hostname=HOSTNAME,
        http_path=HTTP_PATH,
        access_token=token,
    )


LEASE_OUTCOME_SQL = f"""
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
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL                         THEN 'LTO'
      WHEN nxt.lease_id IS NULL                                            THEN 'CHURN'
      WHEN nxt.property_id <> exp.property_id                              THEN 'CHURN'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id = exp.unit_id              THEN 'RENEWAL'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id <> exp.unit_id             THEN 'LTO'
      ELSE 'UNCLASSIFIED'
    END AS outcome_3way,
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL THEN 0
      WHEN nxt.lease_id IS NOT NULL AND nxt.property_id = exp.property_id THEN 0
      ELSE 1
    END AS churn_label
  FROM prod.silver.stg_entrata_mf_gig_lease exp
  LEFT JOIN prod.silver.stg_entrata_mf_gig_lease nxt
    ON nxt.lease_id = exp.next_lease_id
  WHERE exp.property_id IN ({property_ids})
    AND exp.lease_status_type_name = 'Past'
    AND exp.lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
)
SELECT * FROM lease_outcome
"""

LEASE_PANEL_SQL = f"""
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
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL                         THEN 'LTO'
      WHEN nxt.lease_id IS NULL                                            THEN 'CHURN'
      WHEN nxt.property_id <> exp.property_id                              THEN 'CHURN'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id = exp.unit_id              THEN 'RENEWAL'
      WHEN nxt.is_renewal = '1' AND nxt.unit_id <> exp.unit_id             THEN 'LTO'
      ELSE 'UNCLASSIFIED'
    END AS outcome_3way,
    CASE
      WHEN exp.notice_to_transfer_date IS NOT NULL THEN 0
      WHEN nxt.lease_id IS NOT NULL AND nxt.property_id = exp.property_id THEN 0
      ELSE 1
    END AS churn_label
  FROM prod.silver.stg_entrata_mf_gig_lease exp
  LEFT JOIN prod.silver.stg_entrata_mf_gig_lease nxt
    ON nxt.lease_id = exp.next_lease_id
  WHERE exp.property_id IN ({property_ids})
    AND exp.lease_status_type_name = 'Past'
    AND exp.lease_end_date BETWEEN DATE '2022-01-01' AND DATE '2026-12-31'
)
SELECT
  CAST(CONCAT(spine.month_key, '-01') AS DATE) AS scoring_month,
  lo.*,
  MONTHS_BETWEEN(
    CAST(CONCAT(spine.month_key, '-01') AS DATE),
    lo.lease_begin_date
  ) AS months_in_lease_at_scoring,
  MONTHS_BETWEEN(
    lo.lease_end_date,
    CAST(CONCAT(spine.month_key, '-01') AS DATE)
  ) AS months_until_lease_end
FROM prod.silver.union_entrata_mf_gig_rd_all_lease_months spine
JOIN lease_outcome lo ON spine.lease_id = lo.lease_id
WHERE spine.month_key BETWEEN '2022-01' AND '2026-12'
ORDER BY lo.lease_id, scoring_month
"""


def pull(conn, label, sql_query, out_path):
    print(f"Pulling {label}...")
    with conn.cursor() as cur:
        cur.execute(sql_query)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
    df = pd.DataFrame(rows, columns=cols)
    print(f"  {len(df):,} rows — saving to {out_path}")
    df.to_parquet(out_path, index=False)
    return df


if __name__ == "__main__":
    conn = get_connection()
    try:
        if not (OUT_DIR / "lease_outcome.parquet").exists():
            pull(conn, "lease_outcome", LEASE_OUTCOME_SQL, OUT_DIR / "lease_outcome.parquet")
        else:
            print("lease_outcome.parquet already exists, skipping.")
        pull(conn, "lease_panel", LEASE_PANEL_SQL, OUT_DIR / "lease_panel.parquet")
    finally:
        conn.close()
    print("Done.")
