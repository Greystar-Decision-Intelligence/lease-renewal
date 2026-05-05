import { notFound } from 'next/navigation';
import { getResidentById, getResidentProperty } from '@/lib/data';
import { calculateRecommendedRent, calculateCostSavings } from '@/lib/rentLogic';
import { RiskBadge } from '@/components/RiskBadge';
import { RetentionTag } from '@/components/RetentionTag';
import { RentRecommendationPanel } from '@/components/RentRecommendationPanel';
import { CostSavingsPanel } from '@/components/CostSavingsPanel';
import { FeatureBar } from '@/components/FeatureBar';
import { ActionItemCard } from '@/components/ActionItemCard';
import { Navbar } from '@/components/Navbar';

export default async function ResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resident = getResidentById(id);
  if (!resident) notFound();

  const sortedFactors = [...resident.riskFactors].sort((a, b) => b.weight - a.weight);
  const propMeta = getResidentProperty(resident);
  const rentRec = calculateRecommendedRent(resident, propMeta);
  const costAnalysis = calculateCostSavings(resident.monthlyRent, rentRec.recommendedRent);
  const sortedActions = [...resident.actionItems].sort((a, b) => {
    const order = { urgent: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  });

  const leaseEnd = new Date(resident.leaseEndDate);
  const daysUntilEnd = Math.ceil((leaseEnd.getTime() - Date.now()) / 86400000);
  const initials = resident.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const gaugeColor =
    resident.riskCategory === 'very-high'
      ? '#EF4444'
      : resident.riskCategory === 'high'
      ? '#FB923C'
      : resident.riskCategory === 'medium'
      ? '#FBBF24'
      : '#10B981';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--gs-bg)' }}>
      <Navbar
        breadcrumb={[
          { label: 'Dashboard', href: '/' },
          { label: resident.name },
        ]}
      />

      {/* Navy hero */}
      <div className="px-8 py-10" style={{ backgroundColor: 'var(--gs-navy)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8 flex-wrap">
          {/* Left: identity */}
          <div className="flex items-center gap-5">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
              style={{ backgroundColor: 'var(--gs-gold)', color: 'var(--gs-navy)' }}
            >
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{resident.name}</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--gs-gold-light)' }}>
                Unit {resident.unit} · {resident.property}
              </p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <RiskBadge category={resident.riskCategory} size="md" />
                <RetentionTag verdict={resident.retentionVerdict} />
              </div>
            </div>
          </div>

          {/* Right: key metrics */}
          <div className="flex items-center gap-8 flex-wrap">
            {/* Gauge */}
            <div className="flex flex-col items-center">
              <div className="relative w-28 h-28">
                <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    strokeWidth="3"
                    strokeDasharray={`${resident.riskScore} ${100 - resident.riskScore}`}
                    strokeLinecap="round"
                    stroke={gaugeColor}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white">{resident.riskScore}</span>
                  <span className="text-xs" style={{ color: 'var(--gs-gold-light)' }}>/100</span>
                </div>
              </div>
              <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--gs-gold-light)' }}>
                Renewal Score
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8">
              {[
                {
                  label: 'Monthly Rent',
                  value: `$${resident.monthlyRent.toLocaleString()}`,
                  sub: `$${resident.lifetimeValue.toLocaleString()}/yr`,
                },
                {
                  label: 'Lease Ends',
                  value: leaseEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                  sub: daysUntilEnd > 0 ? `${daysUntilEnd} days left` : 'Expired',
                  subRed: daysUntilEnd <= 60,
                },
                {
                  label: 'Open Work Orders',
                  value: resident.riskFactors.find((f) => f.key === 'open_work_orders')?.value ?? '0',
                  sub: 'maintenance tickets',
                },
              ].map(({ label, value, sub, subRed }) => (
                <div key={label}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--gs-gold)' }}>
                    {label}
                  </p>
                  <p className="text-xl font-bold text-white">{value}</p>
                  <p className={`text-xs mt-0.5 ${subRed ? 'text-red-400 font-semibold' : ''}`}
                    style={subRed ? {} : { color: 'var(--gs-gold-light)' }}>
                    {sub}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Retention assessment banner */}
      <div
        className="px-8 py-3.5 border-b"
        style={{
          backgroundColor:
            resident.retentionVerdict === 'yes'
              ? '#F0FDF4'
              : resident.retentionVerdict === 'conditional'
              ? '#FFFBEB'
              : '#F8F9FB',
          borderColor: 'var(--gs-border)',
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--gs-navy)' }}>
            Renewal Recommendation
          </span>
          <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>·</span>
          <span className="text-sm" style={{ color: 'var(--gs-navy)' }}>{resident.retentionRationale}</span>
        </div>
      </div>

      {/* Rent recommendation + cost savings */}
      <div className="max-w-6xl mx-auto px-8 pt-6">
        <div className="grid grid-cols-2 gap-6">
          <RentRecommendationPanel currentRent={resident.monthlyRent} rec={rentRec} />
          <CostSavingsPanel
            monthlyRent={resident.monthlyRent}
            recommendedRent={rentRec.recommendedRent}
            analysis={costAnalysis}
          />
        </div>
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="grid grid-cols-5 gap-6">

          {/* Risk factor breakdown */}
          <div
            className="col-span-3 rounded-xl border p-6"
            style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
          >
            <div className="mb-6">
              <h2 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>
                Renewal Factors
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>
                Ranked by predictive weight — red reduces renewal likelihood, green increases it
              </p>
            </div>
            <div className="space-y-5 divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
              {sortedFactors.map((factor, i) => (
                <div key={factor.key} className={i > 0 ? 'pt-5' : ''}>
                  <FeatureBar factor={factor} />
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="col-span-2 space-y-5">

            {/* Action items */}
            <div
              className="rounded-xl border p-6"
              style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>Action Items</h2>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--gs-navy)', color: 'var(--gs-gold-light)' }}
                >
                  {sortedActions.length}
                </span>
              </div>
              <div className="space-y-2">
                {sortedActions.map((item) => (
                  <ActionItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>

            {/* Signal summary */}
            <div
              className="rounded-xl border p-6"
              style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
            >
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--gs-navy)' }}>
                Signal Summary
              </h2>
              <div className="space-y-3">
                {[
                  { label: 'Top Renewal Factor', value: sortedFactors[0]?.label ?? '—' },
                  { label: 'Strongest Positive', value: sortedFactors.find((f) => f.impact === 'positive')?.label ?? 'None' },
                  { label: 'Late Payments (12mo)', value: resident.riskFactors.find((f) => f.key === 'late_payments')?.value ?? '0' },
                  { label: 'Annual Lease Value', value: `$${resident.lifetimeValue.toLocaleString()}` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center py-2 border-b last:border-0" style={{ borderColor: '#F1F3F8' }}>
                    <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{label}</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--gs-navy)' }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
