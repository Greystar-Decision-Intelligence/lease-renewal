export type RiskCategory = 'very-high' | 'high' | 'medium' | 'low';

export type RetentionVerdict = 'yes' | 'conditional' | 'no';

export type FactorImpact = 'negative' | 'neutral' | 'positive';

export type ActionPriority = 'urgent' | 'high' | 'medium' | 'low';

export type PropertyStrategy = 'occupancy' | 'revenue';

export interface PropertyMeta {
  name: string;
  strategy: PropertyStrategy;
  rentControlPct: number | null;
  occupancyRate: number;
  targetOccupancy: number;
  state?: string;
  msa?: string;
  numUnits?: number;
  yearBuilt?: number;
}

export interface RecommendationStep {
  label: string;
  value: number;
  note: string;
  isConstraint?: boolean;
  skipped?: boolean;
}

export interface RentRecommendation {
  proposedRent: number;
  recommendedRent: number;
  rentControlApplies: boolean;
  rentControlCap: number | null;
  goingBackwards: boolean;
  steps: RecommendationStep[];
}

export interface TrendDataPoint {
  month: string;
  rentRoll: number;
  avgScore: number;
  renewalRate: number;
  occupancy: number;
  isProjection: boolean;
}

export interface RiskFactor {
  key: string;
  label: string;
  value: string;
  impact: FactorImpact;
  weight: number; // 0–1, relative importance (like SHAP magnitude)
  description: string;
}

export interface ActionItem {
  id: string;
  priority: ActionPriority;
  action: string;
  owner: string;
  dueInDays: number;
}

export interface Resident {
  id: string;
  name: string;
  unit: string;
  property: string;
  leaseEndDate: string;
  monthlyRent: number;
  riskScore: number; // 0–100, higher = more likely to not renew
  riskCategory: RiskCategory;
  retentionVerdict: RetentionVerdict;
  retentionRationale: string;
  lifetimeValue: number; // projected annual revenue
  riskFactors: RiskFactor[];
  actionItems: ActionItem[];
}
