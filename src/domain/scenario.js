'use strict';

const { ValidationError } = require('./errors');

const ANNUAL_SALARY_PER_HIRE_BRL = 180000;
const OPERATING_COST_PCT_REVENUE = 25;
const LIMITS = { pct: 100, hires: 1000 };

/** Illustrative weekly sensitivity from explicit assumptions. Never writes data. */
function previewScenario({ revenue, grossMargin, cashRunway }, { revenueChangePct = 0, expenseChangePct = 0, additionalHeadcount = 0 }) {
  if (![revenueChangePct, expenseChangePct, additionalHeadcount].every(Number.isFinite)) {
    throw new ValidationError('Scenario assumptions must be finite and within supported ranges.');
  }
  if (
    Math.abs(revenueChangePct) > LIMITS.pct ||
    Math.abs(expenseChangePct) > LIMITS.pct ||
    !Number.isInteger(additionalHeadcount) ||
    additionalHeadcount < 0 ||
    additionalHeadcount > LIMITS.hires
  ) {
    throw new ValidationError('Scenario assumptions must be finite and within supported ranges.');
  }
  const baselineOperatingCost = revenue * (OPERATING_COST_PCT_REVENUE / 100);
  const weeklySalaryPerHire = ANNUAL_SALARY_PER_HIRE_BRL / 52;
  const baselineGrossProfit = revenue * grossMargin;
  const baselineContribution = baselineGrossProfit - baselineOperatingCost;
  const scenarioRevenue = revenue * (1 + revenueChangePct / 100);
  const scenarioOperatingCost = baselineOperatingCost * (1 + expenseChangePct / 100) + additionalHeadcount * weeklySalaryPerHire;
  const scenarioGrossProfit = scenarioRevenue * grossMargin;
  const scenarioContribution = scenarioGrossProfit - scenarioOperatingCost;
  return {
    assumptions: {
      revenueChangePct,
      expenseChangePct,
      additionalHeadcount,
      annualSalaryPerHireBRL: ANNUAL_SALARY_PER_HIRE_BRL,
      baselineOperatingCostPctRevenue: OPERATING_COST_PCT_REVENUE,
    },
    baseline: {
      weeklyRevenue: revenue,
      grossMargin,
      weeklyGrossProfit: baselineGrossProfit,
      weeklyOperatingCostAssumption: baselineOperatingCost,
      weeklyOperatingContribution: baselineContribution,
      cashRunwayMonths: cashRunway,
    },
    scenario: {
      weeklyRevenue: scenarioRevenue,
      grossMargin,
      weeklyGrossProfit: scenarioGrossProfit,
      weeklyOperatingCostAssumption: scenarioOperatingCost,
      weeklyOperatingContribution: scenarioContribution,
      cashRunwayMonths: cashRunway,
    },
    delta: { weeklyRevenue: scenarioRevenue - revenue, weeklyOperatingContribution: scenarioContribution - baselineContribution },
    note: 'Illustrative sensitivity, not a forecast. Operating cost assumes 25% of current weekly revenue and BRL 180,000 annual salary per hire. Cash runway is shown unchanged because this demo lacks cash-balance and timing data. No source data or approved plan is changed.',
  };
}

module.exports = { previewScenario, LIMITS };
