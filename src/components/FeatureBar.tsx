import { RiskFactor } from '@/lib/types';

const impactStyle = {
  negative: { bar: '#EF4444', dot: '#EF4444', label: 'Increases risk',  labelColor: '#B91C1C' },
  neutral:  { bar: '#CBD5E1', dot: '#94A3B8', label: 'Neutral',         labelColor: '#6B7A99' },
  positive: { bar: '#10B981', dot: '#10B981', label: 'Reduces risk',    labelColor: '#15803D' },
};

export function FeatureBar({ factor }: { factor: RiskFactor }) {
  const style = impactStyle[factor.impact];
  const pct = Math.round(factor.weight * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: style.dot }} />
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--gs-navy)' }}>
            {factor.label}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{ backgroundColor: '#F4F5F8', color: 'var(--gs-text-muted)' }}
          >
            {factor.value}
          </span>
        </div>
        <span className="text-xs font-medium shrink-0" style={{ color: style.labelColor }}>
          {style.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#EEF0F6' }}>
          <div
            className="h-2 rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: style.bar }}
          />
        </div>
        <span className="text-xs font-semibold tabular-nums w-8 text-right" style={{ color: 'var(--gs-text-muted)' }}>
          {pct}%
        </span>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--gs-text-muted)' }}>
        {factor.description}
      </p>
    </div>
  );
}
