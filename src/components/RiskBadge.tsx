import { RiskCategory } from '@/lib/types';

const config: Record<RiskCategory, { label: string; bg: string; text: string; border: string }> = {
  'very-high': { label: 'Very High', bg: '#FEF2F2', text: '#B91C1C', border: '#FECACA' },
  high:        { label: 'High',      bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA' },
  medium:      { label: 'Medium',    bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  low:         { label: 'Low',       bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
};

export function RiskBadge({ category, size = 'sm' }: { category: RiskCategory; size?: 'sm' | 'md' }) {
  const { label, bg, text, border } = config[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold rounded-full border"
      style={{
        backgroundColor: bg,
        color: text,
        borderColor: border,
        fontSize: size === 'md' ? '0.8125rem' : '0.6875rem',
        padding: size === 'md' ? '0.25rem 0.75rem' : '0.125rem 0.625rem',
      }}
    >
      <span
        className="rounded-full shrink-0"
        style={{ width: 6, height: 6, backgroundColor: text }}
      />
      {label} Priority
    </span>
  );
}

export function riskBarColor(category: RiskCategory): string {
  const map: Record<RiskCategory, string> = {
    'very-high': 'bg-red-500',
    high:        'bg-orange-400',
    medium:      'bg-amber-400',
    low:         'bg-emerald-500',
  };
  return map[category];
}
