import { CostSavingsAnalysis } from '@/lib/rentLogic';

function fmt(n: number) {
  return `$${Math.abs(n).toLocaleString()}`;
}

function Bar({ label, value, max, color, negative }: {
  label: string;
  value: number;
  max: number;
  color: string;
  negative?: boolean;
}) {
  const pct = Math.min((Math.abs(value) / max) * 100, 100);
  return (
    <div className="mb-3">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{label}</span>
        <span className="text-xs font-semibold" style={{ color: negative ? '#DC2626' : '#15803D' }}>
          {negative ? '−' : '+'}{fmt(value)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function CostSavingsPanel({
  monthlyRent,
  recommendedRent,
  analysis,
}: {
  monthlyRent: number;
  recommendedRent: number;
  analysis: CostSavingsAnalysis;
}) {
  const isBackwards = recommendedRent < monthlyRent;
  const maxBar = analysis.totalVacancyCost * 1.1;

  return (
    <div
      className="rounded-xl border p-6"
      style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
    >
      <div className="mb-5">
        <h2 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>
          Cost Savings Analysis
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>
          Renewing at recommended rate vs. vacancy scenario
        </p>
      </div>

      {/* Net savings headline */}
      <div
        className="rounded-lg p-4 mb-5 flex items-center justify-between"
        style={{
          backgroundColor: analysis.netYearOneSavings > 0 ? '#F0FDF4' : '#FEF2F2',
          borderLeft: `4px solid ${analysis.netYearOneSavings > 0 ? '#16A34A' : '#DC2626'}`,
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: analysis.netYearOneSavings > 0 ? '#15803D' : '#B91C1C' }}>
            Year 1 Net Savings
          </p>
          <p className="text-2xl font-bold mt-0.5" style={{ color: analysis.netYearOneSavings > 0 ? '#15803D' : '#B91C1C' }}>
            {fmt(analysis.netYearOneSavings)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>
            by renewing vs. allowing vacancy
          </p>
        </div>
        {isBackwards && analysis.breakEvenMonths !== null && (
          <div className="text-right">
            <p className="text-xs font-semibold" style={{ color: 'var(--gs-text-muted)' }}>Break-even</p>
            <p className="text-lg font-bold" style={{ color: 'var(--gs-navy)' }}>
              {analysis.breakEvenMonths}mo
            </p>
            <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>to recover concession</p>
          </div>
        )}
      </div>

      {/* Scenario comparison */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {/* Renew scenario */}
        <div
          className="rounded-lg p-3 border"
          style={{ backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#15803D' }}>
            ✓ Renew
          </p>
          <p className="text-lg font-bold" style={{ color: 'var(--gs-navy)' }}>
            ${recommendedRent.toLocaleString()}<span className="text-xs font-normal text-gray-400">/mo</span>
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--gs-text-muted)' }}>
            ${(recommendedRent * 12).toLocaleString()} / year
          </p>
          {isBackwards && (
            <p className="text-xs mt-1 font-medium text-red-500">
              −${Math.abs(analysis.annualRateDelta).toLocaleString()}/yr vs current
            </p>
          )}
        </div>

        {/* Vacancy scenario */}
        <div
          className="rounded-lg p-3 border"
          style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#B91C1C' }}>
            ✕ Vacancy
          </p>
          <p className="text-lg font-bold" style={{ color: 'var(--gs-navy)' }}>
            45 days
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--gs-text-muted)' }}>
            avg. time to re-lease
          </p>
          <p className="text-xs mt-1 font-medium text-red-500">
            −${analysis.totalVacancyCost.toLocaleString()} immediate cost
          </p>
        </div>
      </div>

      {/* Vacancy cost breakdown */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--gs-text-muted)' }}>
        Vacancy Cost Breakdown
      </p>
      <Bar
        label={`Lost rent (45 days @ $${monthlyRent.toLocaleString()}/mo)`}
        value={analysis.vacancyLoss}
        max={maxBar}
        color="#FCA5A5"
        negative
      />
      <Bar
        label="Leasing fee / turnover (1 month)"
        value={analysis.leasingFee}
        max={maxBar}
        color="#FCA5A5"
        negative
      />

      {/* Divider */}
      <div className="border-t my-3" style={{ borderColor: 'var(--gs-border)' }} />

      <div className="flex justify-between items-center">
        <span className="text-xs font-semibold" style={{ color: 'var(--gs-text-muted)' }}>
          Total vacancy exposure
        </span>
        <span className="text-sm font-bold" style={{ color: '#DC2626' }}>
          −${analysis.totalVacancyCost.toLocaleString()}
        </span>
      </div>

      {isBackwards && (
        <p className="text-xs mt-3 p-2 rounded-lg" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>
          Even with a rate reduction of ${Math.abs(analysis.annualRateDelta / 12).toLocaleString()}/mo,
          you recover the full vacancy cost within {analysis.breakEvenMonths} months.
        </p>
      )}
    </div>
  );
}
