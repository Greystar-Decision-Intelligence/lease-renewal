import { Navbar } from '@/components/Navbar';
import {
  model1, model2, groupConfig,
  pricingTiers, pricingStats,
  trafficSourceAnalysis, categoryChurn,
  trainingStats,
  ModelFeature,
} from '@/lib/modelMeta';

// ── Helpers ───────────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--gs-border)', backgroundColor: 'var(--gs-card)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--gs-text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--gs-navy)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>{sub}</p>}
    </div>
  );
}

function GroupBadge({ group }: { group: ModelFeature['group'] }) {
  const cfg = groupConfig[group];
  return (
    <span
      className="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

function FeatureImportanceRow({
  feature,
  maxGain,
  rank,
  note,
}: {
  feature: ModelFeature;
  maxGain: number;
  rank: number;
  note?: string;
}) {
  const barWidth = (feature.gainPct / maxGain) * 100;
  const cfg = groupConfig[feature.group];

  return (
    <div className="py-3.5 border-b last:border-0" style={{ borderColor: '#F1F3F8' }}>
      <div className="flex items-start gap-3">
        {/* Rank */}
        <span
          className="text-xs font-bold w-6 text-right shrink-0 mt-0.5"
          style={{ color: 'var(--gs-text-muted)' }}
        >
          {rank}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--gs-navy)' }}>
              {feature.label}
            </span>
            <GroupBadge group={feature.group} />
            {note && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                {note}
              </span>
            )}
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--gs-text-muted)' }}>
            {feature.description}
          </p>
          {/* Bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${barWidth}%`, backgroundColor: cfg.color, opacity: 0.85 }}
              />
            </div>
            <span
              className="text-xs font-bold tabular-nums w-12 text-right shrink-0"
              style={{ color: cfg.color }}
            >
              {feature.gainPct.toFixed(2)}%
            </span>
            <span className="text-xs tabular-nums w-16 text-right shrink-0" style={{ color: 'var(--gs-text-muted)' }}>
              {feature.splits.toLocaleString()} splits
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-bold" style={{ color: 'var(--gs-navy)' }}>{title}</h2>
      {sub && <p className="text-sm mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>{sub}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ModelPage() {
  const m1TopFeatures = model1.features.slice(0, 15);
  const m2TopFeatures = model2.features.slice(0, 12);
  const m1MaxGain = m1TopFeatures[0].gainPct;
  const m2MaxGain = m2TopFeatures[0].gainPct;

  const maxCategoryChurn = Math.max(...categoryChurn.map((c) => c.churn6m));
  const maxSourceChurn = Math.max(...trafficSourceAnalysis.map((s) => s.churn6m));

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--gs-bg)' }}>
      <Navbar
        breadcrumb={[
          { label: 'Dashboard', href: '/' },
          { label: 'Model Intelligence' },
        ]}
      />

      {/* Hero */}
      <div className="px-8 py-10" style={{ backgroundColor: 'var(--gs-navy)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--gs-gold)' }}>
            Model Intelligence
          </p>
          <h1 className="text-3xl font-bold text-white mb-2">Lease Renewal Model</h1>
          <p className="text-sm max-w-2xl" style={{ color: 'var(--gs-gold-light)' }}>
            Two-stage LightGBM system — M1 scores churn hazard at 1m/3m/6m horizons, M2 predicts renewal
            acceptance at offer time. Together they drive risk scoring, retention verdicts, and rent recommendations.
          </p>

          {/* Training overview stats */}
          <div className="grid grid-cols-5 gap-6 mt-8">
            {[
              { label: 'Cohort Properties',   value: trainingStats.cohortProperties.toString() },
              { label: 'Panel Rows',           value: (trainingStats.panelRows / 1e6).toFixed(1) + 'M' },
              { label: 'Train Period',         value: '2022–2024' },
              { label: 'Val Period',           value: '2025–2026' },
              { label: 'Val Recommendations',  value: pricingStats.totalRecs.toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--gs-gold)' }}>
                  {label}
                </p>
                <p className="text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-10">

        {/* ── Model Overview Cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          {[model1, model2].map((m) => (
            <div
              key={m.id}
              className="rounded-xl border p-6"
              style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--gs-navy)', color: 'var(--gs-gold-light)' }}
                    >
                      {m.shortName}
                    </span>
                    <h3 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>{m.name}</h3>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{m.purpose}</p>
                </div>
              </div>

              <div
                className="text-xs rounded-lg px-3 py-2.5 mb-4 font-mono"
                style={{ backgroundColor: '#F8F9FB', color: 'var(--gs-navy)', border: '1px solid var(--gs-border)' }}
              >
                {m.architecture}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {m.metrics.slice(0, 4).map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--gs-border)' }}>
                    <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{label}</p>
                    <p className="text-lg font-bold" style={{ color: 'var(--gs-navy)' }}>{value}</p>
                    {sub && <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{sub}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Base Rates ───────────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="Dataset & Base Rates"
            sub={`${trainingStats.cohortName} cohort · ${trainingStats.cohortProperties} properties · ${(trainingStats.panelRows / 1e6).toFixed(1)}M scored rows`}
          />
          <div className="grid grid-cols-3 gap-4 mb-4">
            <MetricCard label="3m Churn Base Rate"      value={`${trainingStats.baseRate3m}%`}  sub="val set" />
            <MetricCard label="6m Churn Base Rate"      value={`${trainingStats.baseRate6m}%`}  sub="val set" />
            <MetricCard label="Lease-End Churn Rate"    value={`${trainingStats.baseRateLeaseEnd}%`} sub="val set" />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="All Metrics — Train Rows"  value="1.49M" sub={trainingStats.trainPeriod} />
            <MetricCard label="M1 Val Rows"               value="286,508" sub={trainingStats.valPeriod} />
            <MetricCard label="M2 Val Rows (offers)"      value="28,350" sub="renewal events" />
            <MetricCard label="Renewal Acceptance Rate"   value={`${trainingStats.acceptanceRate}%`} sub="val set base rate" />
          </div>
        </div>

        {/* ── M1 Feature Importance ────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="M1 Feature Importance — Churn Hazard Model"
            sub="Ranked by LightGBM gain (information gain per split). Shows top 15 of 102 features."
          />

          {/* Group legend */}
          <div className="flex flex-wrap gap-2 mb-5">
            {Object.entries(groupConfig).filter(([k]) => k !== 'model-score').map(([key, cfg]) => (
              <span
                key={key}
                className="text-xs font-semibold px-2 py-1 rounded"
                style={{ color: cfg.color, backgroundColor: cfg.bg }}
              >
                {cfg.label}
              </span>
            ))}
          </div>

          <div>
            {m1TopFeatures.map((f, i) => (
              <FeatureImportanceRow
                key={f.key}
                feature={f}
                maxGain={m1MaxGain}
                rank={i + 1}
                note={f.key === 'horizon_months' ? 'arch param' : undefined}
              />
            ))}
          </div>

          {/* Notes */}
          <div className="mt-5 space-y-2">
            {model1.notes.map((note, i) => (
              <div key={i} className="flex gap-2 text-xs" style={{ color: 'var(--gs-text-muted)' }}>
                <span className="shrink-0 mt-0.5" style={{ color: 'var(--gs-gold)' }}>›</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── M2 Feature Importance ────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="M2 Feature Importance — Renewal Acceptance Model"
            sub="Ranked by LightGBM gain. Shows top 12 of 29 features. M1 churn scores explain 85% of total gain."
          />

          <div className="flex flex-wrap gap-2 mb-5">
            {Object.entries(groupConfig).map(([key, cfg]) => (
              <span
                key={key}
                className="text-xs font-semibold px-2 py-1 rounded"
                style={{ color: cfg.color, backgroundColor: cfg.bg }}
              >
                {cfg.label}
              </span>
            ))}
          </div>

          <div>
            {m2TopFeatures.map((f, i) => (
              <FeatureImportanceRow
                key={f.key}
                feature={f}
                maxGain={m2MaxGain}
                rank={i + 1}
              />
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {model2.notes.map((note, i) => (
              <div key={i} className="flex gap-2 text-xs" style={{ color: 'var(--gs-text-muted)' }}>
                <span className="shrink-0 mt-0.5" style={{ color: 'var(--gs-gold)' }}>›</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing Recommender ──────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="Pricing Recommender — v1 Strategy"
            sub="Rule-based tiers using M2 p_accept as pricing headroom. No price elasticity data available; optimizer will be replaced when A/B data exists."
          />

          {/* Overall stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <MetricCard label="Recommendations"    value={pricingStats.totalRecs.toLocaleString()} sub="val set 2025+" />
            <MetricCard label="Median Increase"    value={`${pricingStats.medianIncrease.toFixed(1)}%`} sub="across all tiers" />
            <MetricCard label="Cap-Constrained"    value={pricingStats.capConstrained.toString()} sub="jurisdiction caps applied" />
            <MetricCard label="Mean Expected Rev"  value={`$${pricingStats.meanExpectedRevenue.toLocaleString()}`} sub="per unit / year" />
          </div>

          {/* Tier breakdown */}
          <div className="space-y-3">
            {pricingTiers.map((tier) => (
              <div
                key={tier.label}
                className="rounded-lg border p-4"
                style={{ borderColor: 'var(--gs-border)', backgroundColor: tier.bg }}
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold" style={{ color: tier.color }}>{tier.label}</span>
                      <span
                        className="text-xs font-mono px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'white', color: tier.color, border: `1px solid ${tier.color}20` }}
                      >
                        {tier.condition}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{tier.increase}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl font-bold" style={{ color: tier.color }}>{tier.count.toLocaleString()}</p>
                    <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{tier.sharePct.toFixed(1)}% of offers</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-white/60 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${tier.sharePct}%`, backgroundColor: tier.color, opacity: 0.7 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Traffic Source Analysis ──────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="Acquisition Channel × Churn"
            sub="traffic_source is the #10 M1 feature by gain. 28pp spread in 6m churn from best to worst channel. Signal is legitimate — no leakage."
          />

          <div className="grid grid-cols-2 gap-8">
            {/* By category */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--gs-text-muted)' }}>
                By Channel Category
              </p>
              <div className="space-y-2.5">
                {categoryChurn.map((c) => {
                  const barW = (c.churn6m / maxCategoryChurn) * 100;
                  const color = c.churn6m > 17 ? '#991B1B' : c.churn6m < 14.5 ? '#065F46' : '#92400E';
                  return (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium" style={{ color: 'var(--gs-navy)' }}>{c.category}</span>
                        <span className="font-bold tabular-nums" style={{ color }}>{c.churn6m.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{ width: `${barW}%`, backgroundColor: color, opacity: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* By source */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--gs-text-muted)' }}>
                Top Sources by Volume — 6m Churn Rate
              </p>
              <div className="space-y-2.5">
                {trafficSourceAnalysis.map((s) => {
                  const barW = (s.churn6m / maxSourceChurn) * 100;
                  const color = s.churn6m > 17 ? '#991B1B' : s.churn6m < 14 ? '#065F46' : '#92400E';
                  return (
                    <div key={s.source}>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate font-medium" style={{ color: 'var(--gs-navy)' }}>{s.source}</span>
                          <span className="shrink-0" style={{ color: 'var(--gs-text-muted)' }}>
                            ({(s.n / 1000).toFixed(0)}k)
                          </span>
                        </div>
                        <span className="font-bold tabular-nums ml-2 shrink-0" style={{ color }}>{s.churn6m.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{ width: `${barW}%`, backgroundColor: color, opacity: 0.8 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 p-3.5 rounded-lg border text-xs" style={{ borderColor: 'var(--gs-border)', backgroundColor: '#FFFBEB' }}>
            <span className="font-semibold text-amber-700">Compliance Note: </span>
            <span style={{ color: 'var(--gs-text-muted)' }}>
              "Student Housing" (27.7% churn) and "Military Housing" (9.4% churn) are proxies for familial status and
              veteran status — both FHA protected classes. These segments are tiny (65 and 192 rows respectively) and the
              model cannot meaningfully act on them at scale, but adverse-action decisions should not cite channel as a
              reason when these sources are present. Legal review recommended before production deployment.
            </span>
          </div>
        </div>

        {/* ── Pipeline Phases ──────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <SectionHeader
            title="Training Pipeline"
            sub="6-phase Python pipeline — all scripts in lease-renewal-model/"
          />
          <div className="space-y-3">
            {[
              { phase: '01', name: 'Pull Data', file: '01_pull_data.py',             desc: 'Pull lease panel, resident attrs, payments, work orders, occupancy, submarket data from Databricks/Yardi.' },
              { phase: '02', name: 'Build Features', file: '02_build_features.py',   desc: '102-column feature view: hazard labels, static attrs, rolling event aggregations, submarket/compset joins, categorical encoding.' },
              { phase: '03', name: 'Train M1', file: '03_train_model1.py',           desc: 'Stacked-horizon LightGBM on 2022–2024 panel. AUC 0.972 (3m), 0.882 (6m). Scores written to m1_scores.parquet.' },
              { phase: '04', name: 'Train M2', file: '04_train_model2.py',           desc: 'Offer-level LightGBM with M1 scores joined at offer date. Two-pass score fallback for pre-2022 offers. AUC 0.736.' },
              { phase: '05', name: 'Pricing', file: '05_pricing_recommender.py',     desc: 'p_accept-gated tiered rules (no elasticity data). Produces optimal_increase_pct and expected_revenue per offer.' },
              { phase: '06', name: 'Evaluate', file: '06_evaluate.py',               desc: 'Validation metrics, calibration curves, pricing backtest vs actuals. Writes evaluation_report.json.' },
            ].map(({ phase, name, file, desc }) => (
              <div key={phase} className="flex gap-4 items-start">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ backgroundColor: 'var(--gs-navy)', color: 'var(--gs-gold)' }}
                >
                  {phase}
                </div>
                <div className="flex-1 pt-0.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold" style={{ color: 'var(--gs-navy)' }}>{name}</span>
                    <code
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: '#F1F3F8', color: 'var(--gs-text-muted)' }}
                    >
                      {file}
                    </code>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Known Limitations ────────────────────────────────────────────── */}
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
        >
          <h2 className="text-base font-bold mb-4 text-amber-800">Known Limitations & Next Steps</h2>
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                title: 'No Price Elasticity',
                body: '99.97% of historical offers were flat. M2 cannot model the effect of different price points. The v1 pricing recommender uses rule-based tiers; an elasticity-aware optimizer requires A/B price variation data.',
              },
              {
                title: 'Sparse Behavioral Signals',
                body: 'work_orders (wo_count_t90d, etc.) and NSF features show 0 splits in M1 training — likely too sparse or dominated by eviction signal. Explore unit-level event aggregations with longer windows.',
              },
              {
                title: 'mf_gig Cohort Only',
                body: '121 multifamily properties. Model performance on affordable housing, student housing, or senior communities is unknown. Retrain or fine-tune before deploying to non-mf_gig segments.',
              },
              {
                title: 'Jurisdictional Rent Caps',
                body: 'caps.csv is marked DRAFT — legal review required. Currently 0 cap-constrained recommendations because the file was not finalized. Real jurisdictions (CA, MA, OR, WA) have active caps.',
              },
            ].map(({ title, body }) => (
              <div key={title} className="rounded-lg bg-white border border-amber-200 p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">{title}</p>
                <p className="text-xs text-amber-700">{body}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
