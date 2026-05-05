import { PropertyStrategy } from '@/lib/types';

const config: Record<PropertyStrategy, { label: string; bg: string; text: string; border: string }> = {
  occupancy: { label: 'Occupancy Focus', bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  revenue:   { label: 'Revenue Optimization', bg: '#FAF5FF', text: '#7E22CE', border: '#E9D5FF' },
};

export function PropertyStrategyTag({ strategy }: { strategy: PropertyStrategy }) {
  const { label, bg, text, border } = config[strategy];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-2 py-0.5"
      style={{ backgroundColor: bg, color: text, borderColor: border }}
    >
      {strategy === 'occupancy' ? '⊕' : '↑'} {label}
    </span>
  );
}
