'use client';

import { TrendDataPoint } from '@/lib/types';
import { propertyMeta } from '@/lib/data';
import { PropertyStrategyTag } from './PropertyStrategyTag';

const W = 600;
const H = 160;
const PAD = { top: 16, right: 20, bottom: 28, left: 52 };

function toX(i: number, n: number) {
  return PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
}

function toY(val: number, min: number, max: number) {
  return PAD.top + (1 - (val - min) / (max - min)) * (H - PAD.top - PAD.bottom);
}

function LineChart({
  data,
  getValue,
  label,
  formatY,
  color = '#1B3461',
  projColor = '#93C5FD',
}: {
  data: TrendDataPoint[];
  getValue: (d: TrendDataPoint) => number;
  label: string;
  formatY: (v: number) => string;
  color?: string;
  projColor?: string;
}) {
  const values = data.map(getValue);
  const minV = Math.min(...values) * 0.97;
  const maxV = Math.max(...values) * 1.03;
  const n = data.length;

  const firstProjIdx = data.findIndex((d) => d.isProjection);
  const splitIdx = firstProjIdx > 0 ? firstProjIdx : n;

  const historicalPts = data.slice(0, splitIdx);
  const projPts = data.slice(splitIdx - 1); // overlap by 1 for continuity

  const toPath = (pts: TrendDataPoint[], startIdx: number) =>
    pts
      .map((d, i) => {
        const x = toX(startIdx + i, n);
        const y = toY(getValue(d), minV, maxV);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  // Y-axis ticks
  const ticks = 4;
  const yTicks = Array.from({ length: ticks }, (_, i) => {
    const v = minV + ((maxV - minV) * i) / (ticks - 1);
    return { v, y: toY(v, minV, maxV) };
  });

  // X-axis labels — show every other to avoid crowding
  const xLabels = data.filter((_, i) => i % 2 === 0);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--gs-text-muted)' }}>
        {label}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        {/* Grid lines */}
        {yTicks.map(({ y }, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#E5E7EB" strokeWidth={0.8} />
        ))}

        {/* Y-axis labels */}
        {yTicks.map(({ v, y }, i) => (
          <text key={i} x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={9} fill="#9CA3AF">
            {formatY(v)}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((d) => {
          const idx = data.indexOf(d);
          return (
            <text key={idx} x={toX(idx, n)} y={H - 4} textAnchor="middle" fontSize={9} fill="#9CA3AF">
              {d.month}
            </text>
          );
        })}

        {/* Projection divider */}
        {firstProjIdx > 0 && (
          <>
            <line
              x1={toX(firstProjIdx, n)}
              x2={toX(firstProjIdx, n)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#D1D5DB"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
            <text x={toX(firstProjIdx, n) + 4} y={PAD.top + 10} fontSize={8} fill="#9CA3AF">
              Projected →
            </text>
          </>
        )}

        {/* Historical line */}
        <path d={toPath(historicalPts, 0)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {/* Projected line */}
        {projPts.length > 1 && (
          <path
            d={toPath(projPts, splitIdx - 1)}
            fill="none"
            stroke={projColor}
            strokeWidth={2}
            strokeDasharray="6 3"
            strokeLinejoin="round"
          />
        )}

        {/* Dots — historical */}
        {historicalPts.map((d, i) => (
          <circle key={i} cx={toX(i, n)} cy={toY(getValue(d), minV, maxV)} r={3} fill={color} />
        ))}

        {/* Dots — projected */}
        {projPts.slice(1).map((d, i) => (
          <circle
            key={i}
            cx={toX(splitIdx + i, n)}
            cy={toY(getValue(d), minV, maxV)}
            r={3}
            fill="white"
            stroke={projColor}
            strokeWidth={1.5}
          />
        ))}
      </svg>
    </div>
  );
}

export function TrendsView({ data }: { data: TrendDataPoint[] }) {
  const current = data.find((d) => d.month === "May '26") ?? data[data.length - 1];
  const prev = data.find((d) => d.month === "Nov '25") ?? data[0];
  const projected = data[data.length - 1];

  const rentRollGrowth = (((current.rentRoll - prev.rentRoll) / prev.rentRoll) * 100).toFixed(1);
  const projectedRentRoll = projected.rentRoll;

  const properties = Object.values(propertyMeta);

  return (
    <div className="space-y-6">

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: 'Current Rent Roll',
            value: `$${(current.rentRoll / 1000).toFixed(1)}k`,
            sub: 'monthly portfolio total',
            accent: false,
          },
          {
            label: '6-Month Growth',
            value: `+${rentRollGrowth}%`,
            sub: 'Nov \'25 → May \'26',
            accent: false,
          },
          {
            label: 'Projected Rent Roll',
            value: `$${(projectedRentRoll / 1000).toFixed(1)}k`,
            sub: `by ${projected.month}`,
            accent: true,
          },
          {
            label: 'Target Occupancy',
            value: `${(current.occupancy * 100).toFixed(0)}%`,
            sub: `portfolio avg · target 92%`,
            accent: false,
          },
        ].map(({ label, value, sub, accent }) => (
          <div
            key={label}
            className="rounded-xl p-5 border"
            style={{
              backgroundColor: accent ? 'var(--gs-navy)' : 'var(--gs-card)',
              borderColor: accent ? 'var(--gs-navy)' : 'var(--gs-border)',
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: accent ? 'var(--gs-gold)' : 'var(--gs-text-muted)' }}
            >
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

      {/* Main rent roll chart */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--gs-navy)' }}>Rent Roll</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--gs-text-muted)' }}>
              Monthly portfolio revenue — historical and projected
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--gs-text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-0.5" style={{ backgroundColor: '#1B3461' }} />
              Historical
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-5 h-0.5"
                style={{ backgroundColor: '#93C5FD', borderTop: '1.5px dashed #93C5FD', backgroundImage: 'none' }}
              />
              Projected
            </span>
          </div>
        </div>
        <LineChart
          data={data}
          getValue={(d) => d.rentRoll}
          label=""
          formatY={(v) => `$${(v / 1000).toFixed(0)}k`}
          color="#1B3461"
          projColor="#60A5FA"
        />
      </div>

      {/* Occupancy + Score charts side by side */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <h2 className="text-base font-bold mb-1" style={{ color: 'var(--gs-navy)' }}>Occupancy Rate</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--gs-text-muted)' }}>Portfolio-wide · 92% target</p>
          <LineChart
            data={data}
            getValue={(d) => d.occupancy * 100}
            label=""
            formatY={(v) => `${v.toFixed(0)}%`}
            color="#2D6A4F"
            projColor="#6EE7B7"
          />
        </div>

        <div
          className="rounded-xl border p-6"
          style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
        >
          <h2 className="text-base font-bold mb-1" style={{ color: 'var(--gs-navy)' }}>Avg Renewal Score</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--gs-text-muted)' }}>Lower is better · trend toward renewal</p>
          <LineChart
            data={data}
            getValue={(d) => d.avgScore}
            label=""
            formatY={(v) => `${v.toFixed(0)}`}
            color="#C2410C"
            projColor="#FED7AA"
          />
        </div>
      </div>

      {/* Property strategy overview */}
      <div
        className="rounded-xl border p-6"
        style={{ backgroundColor: 'var(--gs-card)', borderColor: 'var(--gs-border)' }}
      >
        <h2 className="text-base font-bold mb-1" style={{ color: 'var(--gs-navy)' }}>Property Strategy Overview</h2>
        <p className="text-xs mb-5" style={{ color: 'var(--gs-text-muted)' }}>
          Each property targets either occupancy (92%) or revenue optimization
        </p>
        <div className="grid grid-cols-3 gap-4">
          {properties.map((p) => {
            const isAboveTarget = p.occupancyRate >= p.targetOccupancy;
            const occupancyPct = (p.occupancyRate * 100).toFixed(0);
            return (
              <div
                key={p.name}
                className="rounded-lg border p-4"
                style={{ borderColor: 'var(--gs-border)' }}
              >
                <div className="flex items-start justify-between mb-3 gap-2">
                  <p className="text-sm font-bold leading-tight" style={{ color: 'var(--gs-navy)' }}>
                    {p.name.replace('Greystar @ ', '')}
                  </p>
                  <PropertyStrategyTag strategy={p.strategy} />
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{ color: 'var(--gs-text-muted)' }}>Occupancy</span>
                      <span
                        className="font-semibold"
                        style={{ color: isAboveTarget ? '#15803D' : '#DC2626' }}
                      >
                        {occupancyPct}%
                        <span className="font-normal text-gray-400 ml-1">/ 92% target</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${occupancyPct}%`,
                          backgroundColor: isAboveTarget ? '#16A34A' : '#DC2626',
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between text-xs pt-1">
                    <span style={{ color: 'var(--gs-text-muted)' }}>Rent control</span>
                    <span className="font-semibold" style={{ color: 'var(--gs-navy)' }}>
                      {p.rentControlPct !== null
                        ? `${(p.rentControlPct * 100).toFixed(0)}% cap`
                        : 'None'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
