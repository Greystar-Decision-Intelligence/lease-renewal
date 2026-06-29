import { Resident, RiskCategory, RetentionVerdict, PropertyMeta, TrendDataPoint, RiskFactor, ActionItem } from './types';
import residentsRaw from '@/data/residents.json';
import propertiesRaw from '@/data/properties.json';

// ── Raw types matching the JSON schema ───────────────────────────────────────

interface RawResident {
  id: string;
  name: string;
  unit: string;
  propertyId: number;
  propertyName: string;
  leaseEndDate: string;
  monthlyRent: number;
  riskScore: number;
  riskCat: string;
  retVerdict: string;
  pAccept: number;
  rti: number;    // rent-to-income ratio
  crg: number;    // cumulative rent growth pct
  wo: number;     // work orders last 90d
  nsf: number;    // NSF count lifetime
  smrConv: number; // submarket renewal conversion
  oip: number;    // optimal increase pct
  ks: number | null; // kingsley score
  smChg: number;  // submarket rent change 12m
  evict: number;  // eviction filed flag
  ts: string;     // traffic source
  pm: string;     // pricing method
  state: string;
}

interface RawProperty {
  propertyId: number;
  name: string;
  state: string;
  msa: string;
  numUnits: number;
  yearBuilt: number;
  strategy: string;
  rentControlPct: number | null;
  occupancyRate: number;
  targetOccupancy: number;
}

// ── Property metadata ────────────────────────────────────────────────────────

const rawProperties = propertiesRaw as RawProperty[];

export const propertyMeta: Record<string, PropertyMeta> = Object.fromEntries(
  rawProperties.map((p) => [
    p.name,
    {
      name: p.name,
      strategy: p.strategy as PropertyMeta['strategy'],
      rentControlPct: p.rentControlPct,
      occupancyRate: p.occupancyRate,
      targetOccupancy: p.targetOccupancy,
      state: p.state,
      msa: p.msa,
      numUnits: p.numUnits,
      yearBuilt: p.yearBuilt,
    },
  ])
);

export const properties: string[] = rawProperties.map((p) => p.name).sort();

export function getResidentProperty(name: string): PropertyMeta | undefined {
  return propertyMeta[name];
}

// ── Risk factor computation ───────────────────────────────────────────────────

function computeRiskFactors(r: RawResident): RiskFactor[] {
  const factors: RiskFactor[] = [];

  // 1. Rent-to-income ratio
  const rti = r.rti ?? 0.30;
  factors.push({
    key: 'rent_to_income_ratio',
    label: 'Rent-to-Income Ratio',
    value: rti.toFixed(2),
    impact: rti > 0.38 ? 'negative' : rti < 0.28 ? 'positive' : 'neutral',
    weight: rti > 0.50 ? 0.90 : rti > 0.40 ? 0.72 : rti > 0.33 ? 0.50 : rti > 0.25 ? 0.32 : 0.18,
    description:
      rti > 0.40
        ? `Rent is ${(rti * 100).toFixed(0)}% of monthly income — significant affordability stress. High churn predictor.`
        : rti > 0.30
        ? `Rent is ${(rti * 100).toFixed(0)}% of monthly income — moderate pressure. Monitor closely.`
        : `Rent is ${(rti * 100).toFixed(0)}% of monthly income — financially comfortable. Supports renewal.`,
  });

  // 2. Cumulative rent growth
  const crg = r.crg ?? 0;
  factors.push({
    key: 'cumulative_rent_increase_pct_during_tenure',
    label: 'Cumulative Rent Growth',
    value: `+${(crg * 100).toFixed(1)}%`,
    impact: crg > 0.15 ? 'negative' : crg < 0.04 ? 'positive' : 'neutral',
    weight: crg > 0.20 ? 0.80 : crg > 0.15 ? 0.62 : crg > 0.08 ? 0.42 : crg > 0.03 ? 0.22 : 0.12,
    description:
      crg > 0.15
        ? `Rent has grown ${(crg * 100).toFixed(1)}% since move-in — above typical tolerance. Increases churn likelihood.`
        : crg > 0.05
        ? `Rent has grown ${(crg * 100).toFixed(1)}% over tenure — in normal range. Neutral renewal signal.`
        : `Minimal rent escalation (${(crg * 100).toFixed(1)}%) — resident has received stable pricing. Positive retention factor.`,
  });

  // 3. Recommended rent increase
  const oip = r.oip ?? 0;
  factors.push({
    key: 'rent_increase',
    label: 'Recommended Increase',
    value: oip === 0 ? 'Flat (protect occupancy)' : `+${(oip * 100).toFixed(1)}%`,
    impact: oip === 0 && r.pm === 'at_risk_flat' ? 'negative' : oip > 0.03 ? 'neutral' : 'positive',
    weight: oip === 0 && r.pm === 'at_risk_flat' ? 0.55 : oip > 0.03 ? 0.30 : 0.20,
    description:
      r.pm === 'at_risk_flat'
        ? `Flat renewal recommended — p(accept) is ${(r.pAccept * 100).toFixed(0)}%, below the 65% threshold for any increase.`
        : r.pm === 'moderate_acceptance'
        ? `Modest ${(oip * 100).toFixed(1)}% increase recommended. p(accept) ${(r.pAccept * 100).toFixed(0)}% supports a market-aligned offer.`
        : `${(oip * 100).toFixed(1)}% increase recommended. High acceptance likelihood (${(r.pAccept * 100).toFixed(0)}%) supports revenue capture.`,
  });

  // 4. Work orders
  const wo = r.wo ?? 0;
  factors.push({
    key: 'open_work_orders',
    label: 'Open Work Orders (90d)',
    value: String(wo),
    impact: wo >= 4 ? 'negative' : wo === 0 ? 'positive' : 'neutral',
    weight: wo >= 5 ? 0.65 : wo >= 3 ? 0.48 : wo === 2 ? 0.30 : wo === 1 ? 0.18 : 0.08,
    description:
      wo >= 4
        ? `${wo} maintenance requests in last 90 days — elevated maintenance burden. Unresolved issues increase churn risk.`
        : wo > 0
        ? `${wo} maintenance request${wo > 1 ? 's' : ''} in last 90 days — typical usage. Ensure timely resolution.`
        : `No open work orders in last 90 days — maintenance relationship in good standing.`,
  });

  // 5. NSF / payment history
  const nsf = r.nsf ?? 0;
  factors.push({
    key: 'nsf_payments',
    label: 'NSF Payments (lifetime)',
    value: String(nsf),
    impact: nsf >= 3 ? 'negative' : nsf > 0 ? 'neutral' : 'positive',
    weight: nsf >= 5 ? 0.78 : nsf >= 3 ? 0.60 : nsf >= 1 ? 0.38 : 0.08,
    description:
      nsf >= 3
        ? `${nsf} NSF/returned payments over tenure — pattern of financial stress. Higher churn and delinquency risk.`
        : nsf > 0
        ? `${nsf} NSF payment${nsf > 1 ? 's' : ''} on record — minor payment friction. Monitor going forward.`
        : `No NSF payments — consistent payment history. Strong positive signal.`,
  });

  // 6. Submarket renewal conversion
  const smr = r.smrConv ?? 0.58;
  factors.push({
    key: 'submarket_renewal_conversion',
    label: 'Submarket Renewal Rate',
    value: `${(smr * 100).toFixed(0)}%`,
    impact: smr >= 0.65 ? 'positive' : smr <= 0.50 ? 'negative' : 'neutral',
    weight: smr >= 0.70 ? 0.20 : smr >= 0.60 ? 0.30 : smr >= 0.52 ? 0.42 : 0.55,
    description:
      smr >= 0.65
        ? `Submarket renewal rate is ${(smr * 100).toFixed(0)}% — strong market retention. Residents have few competitive alternatives.`
        : smr >= 0.55
        ? `Submarket renewal rate is ${(smr * 100).toFixed(0)}% — in line with market norms.`
        : `Submarket renewal rate is only ${(smr * 100).toFixed(0)}% — competitive market with many move-out options. Increases churn risk.`,
  });

  return factors.sort((a, b) => b.weight - a.weight);
}

// ── Action items ──────────────────────────────────────────────────────────────

let _actionCounter = 1;

function computeActionItems(r: RawResident): ActionItem[] {
  const items: ActionItem[] = [];
  const id = () => `a${_actionCounter++}`;

  if (r.evict) {
    items.push({ id: id(), priority: 'urgent', action: 'Consult legal team before any renewal discussion — eviction filing on record.', owner: 'Legal', dueInDays: 3 });
  }

  if (r.riskCat === 'very-high') {
    items.push({ id: id(), priority: 'urgent', action: 'Call resident personally to discuss renewal intent and address concerns.', owner: 'Leasing', dueInDays: 7 });
    if (r.wo >= 3) {
      items.push({ id: id(), priority: 'high', action: `Resolve ${r.wo} open maintenance requests before renewal conversation.`, owner: 'Maintenance', dueInDays: 10 });
    }
    items.push({ id: id(), priority: 'high', action: r.pm === 'at_risk_flat' ? 'Prepare flat renewal offer — consider one-time concession to retain.' : 'Prepare renewal offer with any applicable concession package.', owner: 'Revenue', dueInDays: 14 });
  } else if (r.riskCat === 'high') {
    items.push({ id: id(), priority: 'high', action: 'Proactive renewal outreach — schedule personal touchpoint with resident.', owner: 'Leasing', dueInDays: 14 });
    if (r.wo >= 2) {
      items.push({ id: id(), priority: 'medium', action: 'Conduct unit walkthrough to address outstanding maintenance items.', owner: 'Maintenance', dueInDays: 21 });
    }
    if (r.nsf >= 2) {
      items.push({ id: id(), priority: 'medium', action: 'Review payment history with resident — discuss payment plan options if needed.', owner: 'Finance', dueInDays: 14 });
    }
  } else if (r.riskCat === 'medium') {
    items.push({ id: id(), priority: 'medium', action: 'Send renewal offer letter and follow up within 5 business days.', owner: 'Leasing', dueInDays: 30 });
    items.push({ id: id(), priority: 'low', action: 'Resident satisfaction check-in — confirm amenity access and comfort.', owner: 'Leasing', dueInDays: 45 });
  } else {
    items.push({ id: id(), priority: 'low', action: 'Process standard renewal — send offer and await response.', owner: 'Leasing', dueInDays: 60 });
  }

  return items;
}

// ── Retention rationale ───────────────────────────────────────────────────────

function computeRationale(r: RawResident): string {
  const pPct = `${(r.pAccept * 100).toFixed(0)}%`;
  const smPct = `${(r.smrConv * 100).toFixed(0)}%`;

  if (r.retVerdict === 'yes') {
    const inc = r.oip > 0 ? ` Recommend ${(r.oip * 100).toFixed(1)}% increase (within resident tolerance).` : ` Recommend flat renewal to maintain strong relationship.`;
    return `Strong renewal candidate — acceptance probability ${pPct}. Submarket renewal rate ${smPct} supports retention.${inc}`;
  }
  if (r.retVerdict === 'conditional') {
    const concern =
      r.rti > 0.38 ? `rent-to-income ratio of ${(r.rti * 100).toFixed(0)}%` :
      r.crg > 0.12 ? `cumulative rent growth of ${(r.crg * 100).toFixed(1)}%` :
      r.wo >= 3    ? `${r.wo} recent maintenance requests` :
      r.nsf >= 2   ? `${r.nsf} NSF payments on record` :
                     `p(accept) of ${pPct}`;
    return `Conditional renewal — acceptance probability ${pPct}. Key concern: ${concern}. Proactive outreach recommended before offering.`;
  }
  const risks: string[] = [];
  if (r.evict) risks.push('eviction on record');
  if (r.rti > 0.45) risks.push(`high rent burden (${(r.rti * 100).toFixed(0)}%)`);
  if (r.crg > 0.18) risks.push(`steep rent growth (${(r.crg * 100).toFixed(1)}%)`);
  if (r.nsf >= 3) risks.push(`${r.nsf} NSF payments`);
  if (!risks.length) risks.push(`low acceptance probability (${pPct})`);
  return `High churn risk — acceptance probability ${pPct}. Risk factors: ${risks.join(', ')}. Consider proactive concession or accept vacancy loss.`;
}

// ── Full resident expansion (used by detail page) ────────────────────────────

export function getResidentById(id: string): Resident | undefined {
  const raw = (residentsRaw as RawResident[]).find((r) => r.id === id);
  if (!raw) return undefined;
  return expandResident(raw);
}

function expandResident(r: RawResident): Resident {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    property: r.propertyName,
    leaseEndDate: r.leaseEndDate,
    monthlyRent: r.monthlyRent,
    riskScore: r.riskScore,
    riskCategory: r.riskCat as RiskCategory,
    retentionVerdict: r.retVerdict as RetentionVerdict,
    retentionRationale: computeRationale(r),
    lifetimeValue: Math.round(r.monthlyRent * 12),
    riskFactors: computeRiskFactors(r),
    actionItems: computeActionItems(r),
  };
}

// ── Dashboard list (no riskFactors/actionItems — computed on demand) ──────────
// Uses a lighter representation to avoid computing 28K factor arrays at load time.

export interface ResidentSummary {
  id: string;
  name: string;
  unit: string;
  property: string;
  leaseEndDate: string;
  monthlyRent: number;
  riskScore: number;
  riskCategory: RiskCategory;
  retentionVerdict: RetentionVerdict;
  lifetimeValue: number;
  state: string;
}

export const residents: ResidentSummary[] = (residentsRaw as RawResident[]).map((r) => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  property: r.propertyName,
  leaseEndDate: r.leaseEndDate,
  monthlyRent: r.monthlyRent,
  riskScore: r.riskScore,
  riskCategory: r.riskCat as RiskCategory,
  retentionVerdict: r.retVerdict as RetentionVerdict,
  lifetimeValue: Math.round(r.monthlyRent * 12),
  state: r.state,
}));

// ── Portfolio trends (historical actuals + projection) ────────────────────────

export const portfolioTrends: TrendDataPoint[] = [
  { month: "Jan '24", rentRoll: 706206, avgScore: 15.0, renewalRate: 0.605, occupancy: 0.9144, isProjection: false },
  { month: "Feb '24", rentRoll: 707969, avgScore: 16.1, renewalRate: 0.629, occupancy: 0.9163, isProjection: false },
  { month: "Mar '24", rentRoll: 708259, avgScore: 17.1, renewalRate: 0.642, occupancy: 0.9175, isProjection: false },
  { month: "Apr '24", rentRoll: 709393, avgScore: 17.6, renewalRate: 0.598, occupancy: 0.9177, isProjection: false },
  { month: "May '24", rentRoll: 712312, avgScore: 17.3, renewalRate: 0.588, occupancy: 0.9202, isProjection: false },
  { month: "Jun '24", rentRoll: 713819, avgScore: 16.8, renewalRate: 0.585, occupancy: 0.9186, isProjection: false },
  { month: "Jul '24", rentRoll: 713937, avgScore: 14.9, renewalRate: 0.603, occupancy: 0.9205, isProjection: false },
  { month: "Aug '24", rentRoll: 714078, avgScore: 13.6, renewalRate: 0.599, occupancy: 0.9257, isProjection: false },
  { month: "Sep '24", rentRoll: 714218, avgScore: 13.2, renewalRate: 0.617, occupancy: 0.9255, isProjection: false },
  { month: "Oct '24", rentRoll: 714165, avgScore: 12.3, renewalRate: 0.636, occupancy: 0.9256, isProjection: false },
  { month: "Nov '24", rentRoll: 714582, avgScore: 12.8, renewalRate: 0.600, occupancy: 0.9234, isProjection: false },
  { month: "Dec '24", rentRoll: 714910, avgScore: 13.7, renewalRate: 0.586, occupancy: 0.9210, isProjection: false },
  { month: "Jan '25", rentRoll: 719908, avgScore: 14.5, renewalRate: 0.609, occupancy: 0.9224, isProjection: false },
  { month: "Feb '25", rentRoll: 721942, avgScore: 15.9, renewalRate: 0.648, occupancy: 0.9223, isProjection: false },
  { month: "Mar '25", rentRoll: 722254, avgScore: 16.9, renewalRate: 0.627, occupancy: 0.9218, isProjection: false },
  { month: "Apr '25", rentRoll: 723644, avgScore: 18.0, renewalRate: 0.623, occupancy: 0.9253, isProjection: false },
  { month: "May '25", rentRoll: 724452, avgScore: 18.9, renewalRate: 0.605, occupancy: 0.9252, isProjection: false },
  { month: "Jun '25", rentRoll: 724907, avgScore: 19.9, renewalRate: 0.608, occupancy: 0.9292, isProjection: false },
  { month: "Jul '25", rentRoll: 725036, avgScore: 19.5, renewalRate: 0.615, occupancy: 0.9318, isProjection: false },
  { month: "Aug '25", rentRoll: 725646, avgScore: 20.6, renewalRate: 0.606, occupancy: 0.9331, isProjection: false },
  { month: "Sep '25", rentRoll: 725322, avgScore: 22.0, renewalRate: 0.624, occupancy: 0.9318, isProjection: false },
  { month: "Oct '25", rentRoll: 725342, avgScore: 23.5, renewalRate: 0.627, occupancy: 0.9301, isProjection: false },
  { month: "Nov '25", rentRoll: 725344, avgScore: 27.2, renewalRate: 0.614, occupancy: 0.9298, isProjection: false },
  { month: "Dec '25", rentRoll: 725381, avgScore: 28.6, renewalRate: 0.619, occupancy: 0.9295, isProjection: false },
  { month: "Jan '26", rentRoll: 725394, avgScore: 30.3, renewalRate: 0.623, occupancy: 0.9293, isProjection: true },
  { month: "Feb '26", rentRoll: 725407, avgScore: 32.0, renewalRate: 0.627, occupancy: 0.9291, isProjection: true },
  { month: "Mar '26", rentRoll: 725420, avgScore: 33.7, renewalRate: 0.631, occupancy: 0.9289, isProjection: true },
  { month: "Apr '26", rentRoll: 725433, avgScore: 35.4, renewalRate: 0.635, occupancy: 0.9287, isProjection: true },
  { month: "May '26", rentRoll: 725446, avgScore: 37.1, renewalRate: 0.639, occupancy: 0.9285, isProjection: true },
  { month: "Jun '26", rentRoll: 725459, avgScore: 38.8, renewalRate: 0.643, occupancy: 0.9283, isProjection: true },
];
