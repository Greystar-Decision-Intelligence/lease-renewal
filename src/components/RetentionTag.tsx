import { RetentionVerdict } from '@/lib/types';

const config: Record<RetentionVerdict, { label: string; icon: string; bg: string; text: string; border: string }> = {
  yes:         { label: 'Pursue Renewal',        icon: '✓', bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  conditional: { label: 'Pursue with Conditions', icon: '~', bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  no:          { label: 'Do Not Pursue',           icon: '✕', bg: '#F8F9FB', text: '#6B7A99', border: '#E4E7EE' },
};

export function RetentionTag({ verdict }: { verdict: RetentionVerdict }) {
  const { label, icon, bg, text, border } = config[verdict];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold rounded-full border text-xs"
      style={{ backgroundColor: bg, color: text, borderColor: border, padding: '0.25rem 0.75rem' }}
    >
      <span className="font-bold text-sm leading-none">{icon}</span>
      {label}
    </span>
  );
}
