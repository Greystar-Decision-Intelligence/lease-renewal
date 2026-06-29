import { ActionItem, ActionPriority } from '@/lib/types';

const priorityStyle: Record<ActionPriority, { label: string; bg: string; text: string; dot: string }> = {
  urgent: { label: 'Urgent', bg: '#FEF2F2', text: '#B91C1C', dot: '#EF4444' },
  high:   { label: 'High',   bg: '#FFF7ED', text: '#C2410C', dot: '#FB923C' },
  medium: { label: 'Medium', bg: '#FFFBEB', text: '#B45309', dot: '#FBBF24' },
  low:    { label: 'Low',    bg: '#F8F9FB', text: '#6B7A99', dot: '#CBD5E1' },
};

export function ActionItemCard({ item }: { item: ActionItem }) {
  const s = priorityStyle[item.priority];
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg border"
      style={{ backgroundColor: '#FAFBFD', borderColor: 'var(--gs-border)' }}
    >
      <div
        className="mt-0.5 w-4 h-4 rounded border-2 shrink-0"
        style={{ borderColor: s.dot }}
      />
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm leading-snug" style={{ color: 'var(--gs-navy)' }}>
          {item.action}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: s.bg, color: s.text }}
          >
            {s.label}
          </span>
          <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>{item.owner}</span>
          <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>· Due in {item.dueInDays}d</span>
        </div>
      </div>
    </div>
  );
}
