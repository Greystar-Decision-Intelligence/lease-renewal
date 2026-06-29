import { RentRecommendation } from '@/lib/types';

function fmt(n: number) {
  return `$${n.toLocaleString()}`;
}

export function RentRecommendationPanel({
  currentRent,
  rec,
}: {
  currentRent: number;
  rec: RentRecommendation;
}) {
  const delta = rec.recommendedRent - currentRent;
  const deltaPct = ((delta / currentRent) * 100).toFixed(1);
  const isBackwards = rec.goingBackwards;

  return (
    <div
      className="rounded-xl border p-6"
      style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>
            Rent Recommendation
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>
            Step-by-step logic from proposed to recommended
          </p>
        </div>

        {/* Recommended number — the headline */}
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--gs-text-muted)' }}>
            Recommended
          </p>
          <p className="text-2xl font-bold" style={{ color: 'var(--gs-navy)' }}>
            {fmt(rec.recommendedRent)}
            <span className="text-sm font-normal text-gray-400">/mo</span>
          </p>
          <p
            className="text-xs font-semibold mt-0.5"
            style={{ color: isBackwards ? '#DC2626' : '#15803D' }}
          >
            {delta >= 0 ? '+' : ''}{fmt(delta)} ({deltaPct}%) vs current
          </p>
          {isBackwards && (
            <p className="text-xs mt-1 font-medium text-amber-600">
              ⚠ Below current — vacancy cost justifies this
            </p>
          )}
          {rec.rentControlApplies && (
            <p className="text-xs mt-1 font-medium text-blue-600">
              🔒 Rent control applied
            </p>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {rec.steps.map((step, i) => {
          const isLast = i === rec.steps.length - 1;
          const prevValue = i > 0 ? rec.steps[i - 1].value : null;
          const changed = prevValue !== null && step.value !== prevValue;

          return (
            <div key={i} className="flex items-stretch gap-3">
              {/* Connector line */}
              <div className="flex flex-col items-center w-6 shrink-0">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: step.skipped
                      ? '#F1F3F8'
                      : step.isConstraint
                      ? '#FEF3C7'
                      : i === 0
                      ? '#EFF6FF'
                      : isLast
                      ? 'var(--gs-navy)'
                      : '#F0FDF4',
                    color: step.skipped
                      ? '#9CA3AF'
                      : step.isConstraint
                      ? '#B45309'
                      : i === 0
                      ? '#1D4ED8'
                      : isLast
                      ? '#FFFFFF'
                      : '#15803D',
                  }}
                >
                  {step.skipped ? '—' : isLast ? '✓' : i + 1}
                </div>
                {!isLast && (
                  <div
                    className="w-px flex-1 my-1"
                    style={{ backgroundColor: 'var(--gs-border)', minHeight: 12 }}
                  />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                <div className="flex items-baseline justify-between">
                  <span
                    className="text-sm font-semibold"
                    style={{
                      color: step.skipped ? '#9CA3AF' : 'var(--gs-navy)',
                    }}
                  >
                    {step.label}
                  </span>
                  <span
                    className="text-sm font-bold ml-3"
                    style={{
                      color: step.skipped
                        ? '#9CA3AF'
                        : isLast
                        ? 'var(--gs-navy)'
                        : changed && step.isConstraint
                        ? '#B45309'
                        : 'var(--gs-navy)',
                    }}
                  >
                    {fmt(step.value)}
                    {!step.skipped && changed && prevValue !== null && (
                      <span className="text-xs font-normal ml-1" style={{ color: '#9CA3AF' }}>
                        ({step.value > prevValue ? '+' : ''}{fmt(step.value - prevValue)})
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                  {step.note}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
