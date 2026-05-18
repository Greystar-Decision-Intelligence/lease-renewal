export type FeatureGroup = 'timing' | 'financial' | 'behavioral' | 'market' | 'channel' | 'property' | 'model-score';

export interface ModelFeature {
  key: string;
  label: string;
  description: string;
  group: FeatureGroup;
  gainPct: number;   // % of total gain
  splits: number;
}

export interface ModelMeta {
  id: string;
  name: string;
  shortName: string;
  purpose: string;
  architecture: string;
  nFeatures: number;
  nTrainRows: number;
  nValRows: number;
  trainPeriod: string;
  valPeriod: string;
  target: string;
  features: ModelFeature[];
  metrics: { label: string; value: string; sub?: string }[];
  notes: string[];
}

export const groupConfig: Record<FeatureGroup, { label: string; color: string; bg: string }> = {
  timing:       { label: 'Lease Timing',   color: '#1B3461', bg: '#EEF2FF' },
  financial:    { label: 'Financial',      color: '#065F46', bg: '#ECFDF5' },
  behavioral:   { label: 'Behavioral',     color: '#991B1B', bg: '#FEF2F2' },
  market:       { label: 'Market',         color: '#92400E', bg: '#FFFBEB' },
  channel:      { label: 'Channel',        color: '#4C1D95', bg: '#F5F3FF' },
  property:     { label: 'Property',       color: '#0E4C6E', bg: '#F0F9FF' },
  'model-score':{ label: 'M1 Score',       color: '#1F2937', bg: '#F9FAFB' },
};

export const model1: ModelMeta = {
  id: 'model1',
  name: 'Churn Hazard Model',
  shortName: 'M1',
  purpose: 'Predicts probability of churn at 1m, 3m, and 6m horizons for any active lease at any scoring month.',
  architecture: 'LightGBM binary classifier · stacked-horizon panel (single model, `horizon_months` as feature) · trained on 2022–2024 · validated on 2025+',
  nFeatures: 102,
  nTrainRows: 1491237,
  nValRows: 286508,
  trainPeriod: 'Jan 2022 – Dec 2024',
  valPeriod: 'Jan 2025 – Jun 2026',
  target: 'churn_within_{1,3,6}m (binary) — did the lease result in vacancy within the horizon?',
  features: [
    // Timing
    { key: 'horizon_months',                         label: 'Forecast Horizon',                group: 'timing',    gainPct: 42.96, splits: 557,  description: 'Model architecture param — 1m/3m/6m horizon encoded as feature enabling a single stacked model.' },
    { key: 'days_until_state_ntv_deadline',          label: 'Days to NTV Deadline',            group: 'timing',    gainPct: 24.33, splits: 515,  description: 'State-specific notice-to-vacate deadline. High gain: once past deadline, churn is near-certain.' },
    { key: 'months_until_lease_end',                 label: 'Months Until Lease Ends',         group: 'timing',    gainPct:  7.38, splits: 150,  description: 'Proximity to lease expiration. Strong short-range predictor as lease end approaches.' },
    { key: 'months_in_lease_at_scoring',             label: 'Tenure Length',                   group: 'timing',    gainPct:  2.92, splits: 234,  description: 'How long the resident has been in the unit. Longer tenures correlate with higher renewal intent.' },
    { key: 'lease_end_month',                        label: 'Lease Expiration Month',          group: 'timing',    gainPct:  0.82, splits: 1564, description: 'Seasonality in churn — summer months (May–Aug) see elevated non-renewal rates.' },
    { key: 'lease_term',                             label: 'Original Lease Term',             group: 'timing',    gainPct:  2.04, splits: 1157, description: 'Month-to-month vs fixed-term signal. M2M leases have dramatically higher churn rates.' },
    { key: 'lease_term_months',                      label: 'Lease Term (Months)',             group: 'timing',    gainPct:  0.56, splits: 337,  description: 'Continuous version of lease term — captures gradation between 6, 12, 15-month terms.' },
    // Financial
    { key: 'rent_to_income_ratio',                   label: 'Rent-to-Income Ratio',            group: 'financial', gainPct:  1.51, splits: 3629, description: 'Monthly rent ÷ annual income / 12. High ratios indicate affordability stress and elevated churn risk.' },
    { key: 'base_rent',                              label: 'Base Rent',                       group: 'financial', gainPct:  0.94, splits: 2504, description: 'Rent at lease inception. Proxy for unit tier and resident segment.' },
    { key: 'amenity_rent',                           label: 'Amenity Charges',                 group: 'financial', gainPct:  0.93, splits: 1961, description: 'Monthly add-on charges. Higher amenity loads can increase affordability pressure.' },
    { key: 'cumulative_rent_increase_pct_during_tenure', label: 'Cumulative Rent Growth',     group: 'financial', gainPct:  0.85, splits: 2132, description: '(Current rent − base rent) / base rent. Captures total rent escalation over tenure. Key renewal factor.' },
    { key: 'scheduled_rent',                         label: 'Current Scheduled Rent',          group: 'financial', gainPct:  0.84, splits: 2228, description: 'Current contracted rent. Collinear with base_rent but captures post-renewal adjustments.' },
    { key: 'recurring_concessions',                  label: 'Recurring Concessions',           group: 'financial', gainPct:  0.36, splits: 651,  description: 'Monthly rent reductions. Active concessions may mask underlying affordability risk.' },
    // Behavioral
    { key: 'eviction_filed_against_lease',           label: 'Eviction History',                group: 'behavioral', gainPct: 3.89, splits: 228,  description: 'Binary: any eviction filing in this lease. Strong churn predictor — eviction filings almost always precede non-renewal.' },
    { key: 'early_termination_flag',                 label: 'Early Termination',               group: 'behavioral', gainPct: 1.64, splits: 264,  description: 'Whether the resident initiated early termination. Direct signal of intent to vacate.' },
    // Channel
    { key: 'traffic_source',                         label: 'Acquisition Channel',             group: 'channel',   gainPct:  0.97, splits: 1179, description: '46-level categorical (Yardi primary_traffic_source). 28pp spread in 6m churn — locators/Craigslist (18%) vs referrals (12%).' },
    { key: 'traffic_category',                       label: 'Channel Category',                group: 'channel',   gainPct:  0.48, splits: 675,  description: 'Broader grouping (ILS / Paid Digital / Referral / Traditional). Paid Locators (18.7%) vs Referral (13.8%).' },
    { key: 'lease_type',                             label: 'Lease Type',                      group: 'channel',   gainPct:  1.12, splits: 515,  description: 'Fixed-term vs month-to-month. M2M leases have ~3× higher near-term churn probability.' },
    // Property
    { key: 'property_renewal_rate_t12m',             label: 'Property Renewal Rate (12m)',     group: 'property',  gainPct:  0.30, splits: 252,  description: 'Property-level trailing 12m renewal rate. Captures building culture and leasing team performance.' },
    { key: 'property_age_months_precise',            label: 'Building Age',                    group: 'property',  gainPct:  0.48, splits: 918,  description: 'Age of property in months. Newer buildings see higher initial churn as lease cohorts stabilize.' },
    { key: 'physical_occupancy_pct',                 label: 'Property Occupancy',              group: 'property',  gainPct:  0.09, splits: 147,  description: 'Current occupancy at scoring date. Low occupancy properties see higher concession pressure.' },
    // Market
    { key: 'submarket_renewal_conversion',           label: 'Submarket Renewal Rate',          group: 'market',    gainPct:  0.10, splits: 161,  description: 'RealPage submarket renewal conversion rate. Benchmark for local competitive pressure.' },
    { key: 'submarket_rent_change_t12m_pct',         label: 'Submarket Rent Trend (12m)',      group: 'market',    gainPct:  0.08, splits: 141,  description: 'YoY rent change in the submarket. Strong rent growth → higher likelihood resident considers alternatives.' },
    { key: 'compset_avg_effectiverpsf',              label: 'Comp Set Avg Rent/SF',            group: 'market',    gainPct:  0.16, splits: 366,  description: 'Average effective rent per sq ft across competitive set. Gap vs. property drives price sensitivity.' },
  ],
  metrics: [
    { label: 'AUC (3m horizon)',        value: '0.972', sub: 'val set 2025+' },
    { label: 'AUC (6m horizon)',        value: '0.882', sub: 'val set 2025+' },
    { label: 'AUC (by lease-end)',      value: '0.685', sub: 'val set 2025+' },
    { label: 'Avg Precision (6m)',      value: '53.4%', sub: 'vs 14.7% base rate' },
    { label: 'Precision @ Top 10%',     value: '33.4%', sub: '3m horizon' },
    { label: 'Brier Score (3m)',        value: '0.024', sub: 'well-calibrated' },
    { label: 'Val Rows',                value: '286,508', sub: 'Jan–Jun 2025' },
    { label: 'Train Rows',              value: '1.49M',  sub: 'Jan 2022–Dec 2024' },
  ],
  notes: [
    '`horizon_months` accounts for 43% of gain — this is structural, not a leakage issue. It enables the stacked architecture where one model serves all three horizons.',
    '`days_until_state_ntv_deadline` (24% gain) is the strongest true signal: once the NTV deadline passes, churn is legally near-irreversible.',
    'Eviction history has only 228 splits but 3.9% gain — high information per split, effectively a near-perfect churn predictor when present.',
    'Work order and NSF features (wo_count_t90d, nsf_count_*) show zero splits in training — likely too sparse or too correlated with eviction to contribute incremental signal.',
    'traffic_source is #10 by gain with 1179 splits — legitimately signals acquisition quality. Locator/Craigslist residents churn 18–18.5% vs referral residents at 12–15%.',
  ],
};

export const model2: ModelMeta = {
  id: 'model2',
  name: 'Renewal Acceptance Model',
  shortName: 'M2',
  purpose: 'At the moment a renewal offer is made, predicts P(resident accepts the offer). Used as a pricing headroom signal.',
  architecture: 'LightGBM binary classifier · offer-level panel · M1 churn scores joined at offer time · validated on 2025+ renewal events',
  nFeatures: 29,
  nTrainRows: 53221,
  nValRows: 28350,
  trainPeriod: 'Jan 2022 – Dec 2024',
  valPeriod: 'Jan 2025 – Jun 2026',
  target: 'accepted_renewal (binary) — did the resident accept the renewal offer?',
  features: [
    // M1 scores
    { key: 'churn_score_1m',                         label: 'M1 Churn Score (1-month)',        group: 'model-score', gainPct: 52.67, splits: 635, description: 'M1 predicted churn probability at 1m horizon, joined at offer date. Strongest predictor of acceptance.' },
    { key: 'churn_score_6m',                         label: 'M1 Churn Score (6-month)',        group: 'model-score', gainPct: 16.92, splits: 618, description: 'M1 predicted churn at 6m horizon. Captures longer-range intent signal not in the 1m score.' },
    { key: 'churn_score_3m',                         label: 'M1 Churn Score (3-month)',        group: 'model-score', gainPct: 15.42, splits: 391, description: 'M1 predicted churn at 3m horizon. Together the three scores explain 85% of M2\'s total gain.' },
    // Timing
    { key: 'months_until_lease_end_at_offer',        label: 'Months to Lease End at Offer',   group: 'timing',    gainPct:  3.93, splits: 287, description: 'Lead time between offer and lease expiration. Shorter lead times → more urgency, different acceptance dynamics.' },
    { key: 'months_in_lease_at_offer',               label: 'Tenure at Offer Time',            group: 'timing',    gainPct:  1.58, splits: 212, description: 'How long the resident has lived in the unit before the offer was made.' },
    { key: 'lease_end_month',                        label: 'Lease Expiration Month',          group: 'timing',    gainPct:  0.49, splits: 78,  description: 'Seasonal acceptance patterns — summer expirations see lower acceptance.' },
    // Financial
    { key: 'rent_to_income_ratio',                   label: 'Rent-to-Income Ratio',            group: 'financial', gainPct:  1.38, splits: 245, description: 'Affordability pressure at time of offer. High ratios reduce acceptance probability.' },
    { key: 'cumulative_rent_increase_pct_during_tenure', label: 'Cumulative Rent Growth',     group: 'financial', gainPct:  0.77, splits: 133, description: 'Total escalation resident has absorbed. High cumulative increases lower acceptance even if current offer is modest.' },
    { key: 'offered_increase_pct',                   label: 'Offered Rent Increase',           group: 'financial', gainPct:  0.27, splits: 47,  description: 'The increase proposed in the renewal offer. Very low gain — 99.97% of historical offers were flat (0%), so model saw no price variation.' },
    // Market
    { key: 'submarket_renewal_conversion',           label: 'Submarket Renewal Rate',          group: 'market',    gainPct:  0.85, splits: 158, description: 'Local market baseline for acceptance. High submarket conversion → resident more likely to accept.' },
    { key: 'submarket_rent_change_t12m_pct',         label: 'Submarket Rent Trend (12m)',      group: 'market',    gainPct:  0.79, splits: 140, description: 'Rising submarket rents reduce perceived value of leaving, improving acceptance odds.' },
    { key: 'market_renewal_conversion',              label: 'Market Renewal Rate',             group: 'market',    gainPct:  0.68, splits: 121, description: 'Broader market acceptance baseline (MSA level).' },
    // Property
    { key: 'kingsley_score_latest',                  label: 'Resident Satisfaction (Kingsley)', group: 'property', gainPct:  0.76, splits: 129, description: 'Property-level Kingsley satisfaction score. Higher satisfaction predicts higher acceptance.' },
    { key: 'lead_to_lease_conversion_t90d',          label: 'Leasing Velocity (90d)',          group: 'property',  gainPct:  0.82, splits: 149, description: 'Property leasing funnel conversion. High demand properties → residents feel more urgency to accept.' },
    { key: 'denial_rate_t90d',                       label: 'Application Denial Rate (90d)',   group: 'property',  gainPct:  0.60, splits: 105, description: 'High denial rates signal selective properties — residents may accept to avoid rejection risk.' },
    { key: 'physical_occupancy_pct',                 label: 'Property Occupancy',              group: 'property',  gainPct:  0.27, splits: 49,  description: 'Low occupancy → fewer alternatives nearby, slightly higher acceptance.' },
    { key: 'property_renewal_rate_t3m',              label: 'Property Renewal Rate (3m)',      group: 'property',  gainPct:  0.25, splits: 51,  description: 'Recent property-level renewal rate. Peer behavior signal.' },
  ],
  metrics: [
    { label: 'AUC',                   value: '0.736', sub: 'val set 2025+' },
    { label: 'Avg Precision',         value: '77.7%', sub: 'vs 58.9% base rate' },
    { label: 'Brier Score',           value: '0.202', sub: '' },
    { label: 'Acceptance Base Rate',  value: '58.9%', sub: 'val set 2025+' },
    { label: 'Val Rows',              value: '28,350', sub: 'renewal offer events' },
    { label: 'Train Rows',            value: '53,221', sub: 'Jan 2022–Dec 2024' },
  ],
  notes: [
    'M1 churn scores explain 85% of M2\'s total gain — M2 is fundamentally a calibration layer on top of M1.',
    '`offered_increase_pct` has only 47 splits and 0.27% gain — 99.97% of historical offers were flat renewals. M2 has no price elasticity. The pricing recommender uses rule-based tiers instead.',
    'AUC 0.736 improved from 0.651 after implementing a two-pass score fallback for offers predating the 2022 scoring window.',
    'M2\'s p_accept output is used as pricing headroom: p_accept > 0.80 → offer up to +5%; p_accept 0.65–0.80 → up to +3%; p_accept < 0.65 → flat (protect occupancy).',
  ],
};

// ── Pricing recommender summary ───────────────────────────────────────────────
export const pricingTiers = [
  {
    label: 'High Acceptance',
    condition: 'p_accept > 0.80',
    increase: 'Market trend + 3%, capped at 5%',
    count: 8800,
    sharePct: 31.0,
    medianIncrease: 3.0,
    color: '#065F46',
    bg: '#ECFDF5',
  },
  {
    label: 'Moderate Acceptance',
    condition: '0.65 ≤ p_accept ≤ 0.80',
    increase: 'Market trend + 1%, capped at 3%',
    count: 6898,
    sharePct: 24.3,
    medianIncrease: 1.0,
    color: '#92400E',
    bg: '#FFFBEB',
  },
  {
    label: 'At-Risk Flat',
    condition: 'p_accept < 0.65',
    increase: 'Flat renewal (protect occupancy)',
    count: 12652,
    sharePct: 44.6,
    medianIncrease: 0.0,
    color: '#991B1B',
    bg: '#FEF2F2',
  },
];

export const pricingStats = {
  totalRecs: 28350,
  capConstrained: 0,
  medianIncrease: 1.0,
  meanExpectedRevenue: 22790,
  totalExpectedRevenue: 646088440,
  pAcceptMean: 0.621,
  pAcceptMedian: 0.687,
};

// ── Traffic source analysis ───────────────────────────────────────────────────
export const trafficSourceAnalysis = [
  { source: 'Unattributed Source',    category: 'EXCLUDE',          n: 542700, churn6m: 13.9 },
  { source: 'Property Website',       category: 'ORGANIC DIGITAL',  n: 513351, churn6m: 17.2 },
  { source: 'Apartments.com',         category: 'ILS',              n: 137232, churn6m: 16.7 },
  { source: 'Online Business Listing',category: 'ILS',              n: 119011, churn6m: 17.2 },
  { source: 'Zillow Rental Network',  category: 'ILS',              n: 102138, churn6m: 17.3 },
  { source: 'Paid Search',            category: 'PAID DIGITAL',     n: 85652,  churn6m: 17.0 },
  { source: 'Live/Work In Area',      category: 'TRADITIONAL',      n: 79467,  churn6m: 14.4 },
  { source: 'Apartment List',         category: 'ILS',              n: 52653,  churn6m: 16.5 },
  { source: 'Apartment Locator',      category: 'PAID LOCATORS',    n: 30262,  churn6m: 18.5 },
  { source: 'Resident Referral',      category: 'REFERRAL',         n: 25826,  churn6m: 14.8 },
  { source: 'Greystar.com',           category: 'ORGANIC DIGITAL',  n: 23127,  churn6m: 15.5 },
  { source: 'Non-Paid Referral',      category: 'REFERRAL',         n: 10906,  churn6m: 11.6 },
  { source: 'Corporate Housing Agency', category: 'TRADITIONAL',    n: 9094,   churn6m: 12.1 },
  { source: 'Local Internet Source',  category: 'ILS',              n: 7868,   churn6m: 18.0 },
  { source: 'Employee Referral',      category: 'REFERRAL',         n: 3684,   churn6m: 11.2 },
];

export const categoryChurn = [
  { category: 'PAID LOCATORS',      churn6m: 18.7, n: 25948 },
  { category: 'ILS',                churn6m: 17.1, n: 282814 },
  { category: 'PAID DIGITAL',       churn6m: 17.0, n: 79783 },
  { category: 'ORGANIC DIGITAL',    churn6m: 16.9, n: 608490 },
  { category: 'TRADITIONAL',        churn6m: 14.5, n: 87039 },
  { category: 'EXCLUDE',            churn6m: 14.4, n: 642042 },
  { category: 'REFERRAL',           churn6m: 13.8, n: 48390 },
  { category: 'SOCIAL & REPUTATION',churn6m: 13.5, n: 2783 },
];

// ── Training data overview ─────────────────────────────────────────────────────
export const trainingStats = {
  cohortProperties: 121,
  cohortName: 'mf_gig',
  panelRows: 1777745,
  uniqueLeases: 81420,
  trainPeriod: 'Jan 2022 – Dec 2024',
  valPeriod: 'Jan 2025 – Jun 2026',
  baseRate3m: 8.1,
  baseRate6m: 15.9,
  baseRateLeaseEnd: 35.9,
  acceptanceRate: 58.9,
};
