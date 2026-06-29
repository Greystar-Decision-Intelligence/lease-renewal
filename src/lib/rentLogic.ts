import { Resident, PropertyMeta, RentRecommendation, RecommendationStep } from './types';

const VACANCY_DAYS = 45;
const LEASING_FEE_MONTHS = 1;

function extractProposedIncreasePct(resident: Resident): number {
  const factor = resident.riskFactors.find((f) => f.key === 'rent_increase');
  if (!factor) return 0;
  const match = factor.value.match(/[+-]?[\d.]+/);
  return match ? parseFloat(match[0]) / 100 : 0;
}

export function calculateRecommendedRent(
  resident: Resident,
  propertyMeta: PropertyMeta
): RentRecommendation {
  const increasePct = extractProposedIncreasePct(resident);
  const proposedRent = Math.round(resident.monthlyRent * (1 + increasePct));

  const steps: RecommendationStep[] = [
    {
      label: 'Current Rent',
      value: resident.monthlyRent,
      note: 'Monthly base rent',
    },
    {
      label: `Proposed Increase (+${(increasePct * 100).toFixed(0)}%)`,
      value: proposedRent,
      note: 'Per renewal notice',
    },
  ];

  let current = proposedRent;

  // Risk adjustment — high non-renewal likelihood warrants a concession
  const riskAdjPct =
    resident.riskCategory === 'very-high' ? -0.05
    : resident.riskCategory === 'high' ? -0.02
    : 0;

  if (riskAdjPct !== 0) {
    current = Math.round(current * (1 + riskAdjPct));
    steps.push({
      label: `Risk Adjustment (score ${resident.riskScore})`,
      value: current,
      note: `${(riskAdjPct * 100).toFixed(0)}% — high non-renewal likelihood`,
      isConstraint: true,
    });
  }

  // Occupancy strategy — if below target, protect headcount over revenue
  if (
    propertyMeta.strategy === 'occupancy' &&
    propertyMeta.occupancyRate < propertyMeta.targetOccupancy
  ) {
    const occupancyTarget = Math.round(resident.monthlyRent * 0.97);
    if (occupancyTarget < current) {
      current = occupancyTarget;
      steps.push({
        label: 'Occupancy Strategy',
        value: current,
        note: `Property at ${(propertyMeta.occupancyRate * 100).toFixed(0)}% vs ${(propertyMeta.targetOccupancy * 100).toFixed(0)}% target — protect headcount`,
        isConstraint: true,
      });
    }
  }

  // Rent control cap
  let rentControlApplies = false;
  let rentControlCap: number | null = null;

  if (propertyMeta.rentControlPct !== null) {
    rentControlCap = Math.round(resident.monthlyRent * (1 + propertyMeta.rentControlPct));
    if (current > rentControlCap) {
      current = rentControlCap;
      rentControlApplies = true;
      steps.push({
        label: `Rent Control Cap (+${(propertyMeta.rentControlPct * 100).toFixed(0)}% max)`,
        value: current,
        note: 'Statutory limit — cannot exceed',
        isConstraint: true,
      });
    } else {
      steps.push({
        label: `Rent Control Check (+${(propertyMeta.rentControlPct * 100).toFixed(0)}% max = $${rentControlCap.toLocaleString()})`,
        value: current,
        note: 'Within limit — no constraint',
        skipped: true,
      });
    }
  }

  return {
    proposedRent,
    recommendedRent: current,
    rentControlApplies,
    rentControlCap,
    goingBackwards: current < resident.monthlyRent,
    steps,
  };
}

export interface CostSavingsAnalysis {
  vacancyLoss: number;
  leasingFee: number;
  totalVacancyCost: number;
  annualAtRecommended: number;
  annualRateDelta: number;
  netYearOneSavings: number;
  breakEvenMonths: number | null;
}

export function calculateCostSavings(
  monthlyRent: number,
  recommendedRent: number
): CostSavingsAnalysis {
  const vacancyLoss = Math.round((monthlyRent / 30) * VACANCY_DAYS);
  const leasingFee = monthlyRent * LEASING_FEE_MONTHS;
  const totalVacancyCost = vacancyLoss + leasingFee;

  const annualAtRecommended = recommendedRent * 12;
  const annualRateDelta = (recommendedRent - monthlyRent) * 12;

  // Net savings = vacancy cost avoided, offset by any annual rate reduction
  const netYearOneSavings = totalVacancyCost + Math.min(0, annualRateDelta);

  let breakEvenMonths: number | null = null;
  if (annualRateDelta < 0) {
    const monthlyLoss = Math.abs(annualRateDelta / 12);
    breakEvenMonths = Math.ceil(totalVacancyCost / monthlyLoss);
  }

  return {
    vacancyLoss,
    leasingFee,
    totalVacancyCost,
    annualAtRecommended,
    annualRateDelta,
    netYearOneSavings,
    breakEvenMonths,
  };
}
