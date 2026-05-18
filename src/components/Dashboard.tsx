'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { RiskCategory } from '@/lib/types';
import { ResidentSummary } from '@/lib/data';
import { RiskBadge, riskBarColor } from './RiskBadge';
import { RetentionTag } from './RetentionTag';
import { PropertyStrategyTag } from './PropertyStrategyTag';
import { TrendsView } from './TrendsView';
import { Navbar } from './Navbar';
import { properties, propertyMeta, portfolioTrends } from '@/lib/data';
import { trainingStats } from '@/lib/modelMeta';

const PAGE_SIZE = 50;

const RISK_ORDER: RiskCategory[] = ['very-high', 'high', 'medium', 'low'];

const tierConfig: {
  category: RiskCategory;
  label: string;
  bar: string;
  activeBg: string;
  activeBorder: string;
}[] = [
  { category: 'very-high', label: 'Very High', bar: 'bg-red-500',    activeBg: 'bg-red-50',    activeBorder: 'border-red-400' },
  { category: 'high',      label: 'High',       bar: 'bg-orange-400', activeBg: 'bg-orange-50', activeBorder: 'border-orange-400' },
  { category: 'medium',    label: 'Medium',      bar: 'bg-amber-400',  activeBg: 'bg-amber-50',  activeBorder: 'border-amber-400' },
  { category: 'low',       label: 'Low',         bar: 'bg-emerald-500',activeBg: 'bg-emerald-50',activeBorder: 'border-emerald-400' },
];

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(id: string): string {
  const colors = ['#1B3461','#2A4A80','#3B5EA6','#4C72C0','#1A4731','#2D6A4F','#1F4E79','#6B3A2A'];
  return colors[id.charCodeAt(id.length - 1) % colors.length];
}

// ── Grouped state options for the state filter ────────────────────────────────
const STATE_LABELS: Record<string, string> = {
  AZ:'Arizona', CA:'California', CO:'Colorado', DC:'Washington DC', FL:'Florida',
  GA:'Georgia', IL:'Illinois', MA:'Massachusetts', MD:'Maryland', MN:'Minnesota',
  NC:'North Carolina', NY:'New York', OR:'Oregon', SC:'South Carolina',
  TN:'Tennessee', TX:'Texas', VA:'Virginia', WA:'Washington',
};

export function Dashboard({ residents }: { residents: ResidentSummary[] }) {
  const [activeTab, setActiveTab] = useState<'residents' | 'trends'>('residents');
  const [filterRisk, setFilterRisk] = useState<RiskCategory | 'all'>('all');
  const [filterProperty, setFilterProperty] = useState<string>('all');
  const [filterState, setFilterState] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'riskScore' | 'monthlyRent' | 'leaseEndDate'>('riskScore');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever filter changes
  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  const counts = useMemo(
    () => Object.fromEntries(
      RISK_ORDER.map((cat) => [cat, residents.filter((r) => r.riskCategory === cat).length])
    ) as Record<RiskCategory, number>,
    [residents]
  );

  const allStates = useMemo(
    () => [...new Set(residents.map((r) => r.state).filter(Boolean))].sort(),
    [residents]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return residents
      .filter((r) => {
        if (filterRisk !== 'all' && r.riskCategory !== filterRisk) return false;
        if (filterProperty !== 'all' && r.property !== filterProperty) return false;
        if (filterState !== 'all' && r.state !== filterState) return false;
        if (q && !r.name.toLowerCase().includes(q) && !r.unit.toLowerCase().includes(q) && !r.property.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortKey === 'riskScore') return b.riskScore - a.riskScore;
        if (sortKey === 'monthlyRent') return b.monthlyRent - a.monthlyRent;
        return new Date(a.leaseEndDate).getTime() - new Date(b.leaseEndDate).getTime();
      });
  }, [residents, filterRisk, filterProperty, filterState, search, sortKey]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const avgRisk = Math.round(residents.reduce((s, r) => s + r.riskScore, 0) / residents.length);
  const atRiskRevenue = residents
    .filter((r) => r.riskCategory === 'very-high' || r.riskCategory === 'high')
    .reduce((s, r) => s + r.monthlyRent * 12, 0);
  const expiringIn60 = residents.filter((r) => {
    const days = Math.ceil((new Date(r.leaseEndDate).getTime() - Date.now()) / 86400000);
    return days > 0 && days <= 60;
  }).length;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--gs-bg)' }}>
      <Navbar breadcrumb={[{ label: 'Lease Renewal Intelligence' }]} />

      {/* Page title bar */}
      <div className="px-8 pt-8 pb-6 max-w-7xl mx-auto">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--gs-gold)' }}>
              Renewal Intelligence
            </p>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--gs-navy)' }}>
              Lease Renewal Dashboard
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--gs-text-muted)' }}>
              {residents.length.toLocaleString()} residents · {properties.length} properties · val {trainingStats.valPeriod} ·{' '}
              <Link href="/model" className="underline underline-offset-2 hover:opacity-80" style={{ color: 'var(--gs-navy)' }}>
                M1 AUC 0.972 · M2 AUC 0.736
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/model"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ color: 'var(--gs-navy)', borderColor: 'var(--gs-border)', backgroundColor: 'white' }}
            >
              Model Details →
            </Link>
            <div className="text-sm font-medium px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--gs-navy)', color: 'var(--gs-gold-light)' }}>
              {trainingStats.valPeriod.split('–')[0].trim()}
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="max-w-7xl mx-auto px-8">
        <div className="flex gap-1 border-b" style={{ borderColor: 'var(--gs-border)' }}>
          {(['residents', 'trends'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors"
              style={{
                borderBottomColor: activeTab === tab ? 'var(--gs-navy)' : 'transparent',
                color: activeTab === tab ? 'var(--gs-navy)' : 'var(--gs-text-muted)',
              }}
            >
              {tab === 'residents' ? 'Residents' : 'Trends & Strategy'}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 pb-12 space-y-6 mt-6">

        {activeTab === 'trends' && <TrendsView data={portfolioTrends} />}

        {activeTab === 'residents' && <>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Residents',    value: residents.length.toLocaleString(), sub: `${properties.length} properties`, accent: false },
            { label: 'Revenue at Risk',    value: `$${(atRiskRevenue / 1e6).toFixed(1)}M`, sub: 'annualized · very-high + high', accent: true },
            { label: 'Avg Renewal Score',  value: `${avgRisk}/100`, sub: 'portfolio mean', accent: false },
            { label: 'Expiring ≤ 60 Days', value: expiringIn60.toLocaleString(), sub: 'leases', accent: false },
          ].map(({ label, value, sub, accent }) => (
            <div
              key={label}
              className="rounded-xl p-5 border"
              style={{
                backgroundColor: accent ? 'var(--gs-navy)' : 'var(--gs-card)',
                borderColor: accent ? 'var(--gs-navy)' : 'var(--gs-border)',
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide mb-2"
                style={{ color: accent ? 'var(--gs-gold)' : 'var(--gs-text-muted)' }}>
                {label}
              </p>
              <p className="text-3xl font-bold" style={{ color: accent ? '#FFFFFF' : 'var(--gs-navy)' }}>
                {value}
              </p>
              <p className="text-xs mt-1" style={{ color: accent ? 'var(--gs-gold-light)' : 'var(--gs-text-muted)' }}>
                {sub}
              </p>
            </div>
          ))}
        </div>

        {/* Risk tier filter cards */}
        <div className="grid grid-cols-4 gap-3">
          {tierConfig.map(({ category, label, bar, activeBg, activeBorder }) => {
            const active = filterRisk === category;
            const count = counts[category];
            const rent = residents.filter((r) => r.riskCategory === category).reduce((s, r) => s + r.monthlyRent, 0);
            const pct = Math.round((count / residents.length) * 100);
            return (
              <button
                key={category}
                onClick={() => setFilter(setFilterRisk)(active ? 'all' : category)}
                className={`rounded-xl p-4 text-left border-2 transition-all ${active ? `${activeBg} ${activeBorder}` : 'bg-white border-transparent hover:border-gray-200'}`}
                style={{ boxShadow: active ? 'none' : '0 1px 3px rgba(0,0,0,0.06)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl font-bold" style={{ color: 'var(--gs-navy)' }}>{count.toLocaleString()}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white border" style={{ color: 'var(--gs-text-muted)', borderColor: 'var(--gs-border)' }}>
                    {pct}%
                  </span>
                </div>
                <p className="text-sm font-semibold mb-2" style={{ color: 'var(--gs-navy)' }}>{label}</p>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-2">
                  <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>
                  ${(rent / 1000).toFixed(0)}k/mo
                </p>
              </button>
            );
          })}
        </div>

        {/* Filter / search bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search name, unit, or property…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 pr-4 py-2 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 w-64"
              style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
            />
          </div>

          {/* State filter */}
          <select
            value={filterState}
            onChange={(e) => setFilter(setFilterState)(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none"
            style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
          >
            <option value="all">All States</option>
            {allStates.map((s) => (
              <option key={s} value={s}>{STATE_LABELS[s] ?? s} ({s})</option>
            ))}
          </select>

          {/* Property filter */}
          <select
            value={filterProperty}
            onChange={(e) => setFilter(setFilterProperty)(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none max-w-xs"
            style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
          >
            <option value="all">All Properties ({properties.length})</option>
            {properties.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="px-3 py-2 text-sm rounded-lg border bg-white focus:outline-none"
            style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
          >
            <option value="riskScore">Sort: Renewal Score</option>
            <option value="leaseEndDate">Sort: Lease End</option>
            <option value="monthlyRent">Sort: Monthly Rent</option>
          </select>

          {(filterRisk !== 'all' || filterProperty !== 'all' || filterState !== 'all' || search) && (
            <button
              onClick={() => { setFilterRisk('all'); setFilterProperty('all'); setFilterState('all'); setSearch(''); setPage(1); }}
              className="text-sm underline"
              style={{ color: 'var(--gs-text-muted)' }}
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto text-sm font-medium" style={{ color: 'var(--gs-text-muted)' }}>
            {filtered.length.toLocaleString()} resident{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ backgroundColor: '#F8F9FB', borderColor: 'var(--gs-border)' }}>
                {['Resident', 'Property', 'Priority Level', 'Score', 'Rent / yr', 'Lease Ends', 'Recommendation', ''].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--gs-text-muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((r) => {
                const days = Math.ceil((new Date(r.leaseEndDate).getTime() - Date.now()) / 86400000);
                const urgent = days > 0 && days <= 60;
                return (
                  <tr key={r.id} className="border-b group transition-colors hover:bg-blue-50/30" style={{ borderColor: '#F1F3F8' }}>
                    {/* Resident */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: avatarColor(r.id) }}>
                          {initials(r.name)}
                        </div>
                        <div>
                          <p className="font-semibold text-sm" style={{ color: 'var(--gs-navy)' }}>{r.name}</p>
                          <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>Unit {r.unit}</p>
                        </div>
                      </div>
                    </td>

                    {/* Property */}
                    <td className="px-5 py-3.5">
                      <p className="text-sm mb-1 leading-tight" style={{ color: 'var(--gs-navy)' }}>{r.property}</p>
                      {propertyMeta[r.property] && (
                        <PropertyStrategyTag strategy={propertyMeta[r.property].strategy} />
                      )}
                    </td>

                    {/* Risk badge */}
                    <td className="px-5 py-3.5"><RiskBadge category={r.riskCategory} /></td>

                    {/* Score bar */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#EEF0F6' }}>
                          <div className={`h-1.5 rounded-full ${riskBarColor(r.riskCategory)}`} style={{ width: `${r.riskScore}%` }} />
                        </div>
                        <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--gs-navy)' }}>{r.riskScore}</span>
                      </div>
                    </td>

                    {/* Rent */}
                    <td className="px-5 py-3.5 tabular-nums">
                      <p className="text-sm font-medium" style={{ color: 'var(--gs-navy)' }}>${r.monthlyRent.toLocaleString()}/mo</p>
                      <p className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>${(r.monthlyRent * 12).toLocaleString()}/yr</p>
                    </td>

                    {/* Lease end */}
                    <td className="px-5 py-3.5">
                      <p className="text-sm" style={{ color: 'var(--gs-navy)' }}>
                        {new Date(r.leaseEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <p className={`text-xs font-medium ${urgent ? 'text-red-500' : ''}`} style={urgent ? {} : { color: 'var(--gs-text-muted)' }}>
                        {days > 0 ? `${days}d remaining` : 'Expired'}
                      </p>
                    </td>

                    {/* Retention */}
                    <td className="px-5 py-3.5"><RetentionTag verdict={r.retentionVerdict} /></td>

                    {/* View */}
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/residents/${r.id}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border opacity-0 group-hover:opacity-100 transition-all"
                        style={{ color: 'var(--gs-navy)', borderColor: 'var(--gs-border)', backgroundColor: 'white' }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-sm" style={{ color: 'var(--gs-text-muted)' }}>
                    No residents match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--gs-border)' }}>
              <span className="text-xs" style={{ color: 'var(--gs-text-muted)' }}>
                Page {page} of {totalPages} · {filtered.length.toLocaleString()} residents
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
                >
                  «
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-xs rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
                >
                  ‹ Prev
                </button>

                {/* Page number buttons — show window around current page */}
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let p: number;
                  if (totalPages <= 7) p = i + 1;
                  else if (page <= 4) p = i + 1;
                  else if (page >= totalPages - 3) p = totalPages - 6 + i;
                  else p = page - 3 + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className="w-7 h-7 text-xs rounded border font-medium"
                      style={{
                        borderColor: p === page ? 'var(--gs-navy)' : 'var(--gs-border)',
                        backgroundColor: p === page ? 'var(--gs-navy)' : 'white',
                        color: p === page ? 'white' : 'var(--gs-navy)',
                      }}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-xs rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
                >
                  Next ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded border disabled:opacity-30"
                  style={{ borderColor: 'var(--gs-border)', color: 'var(--gs-navy)' }}
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>

        </>}
      </div>
    </div>
  );
}
