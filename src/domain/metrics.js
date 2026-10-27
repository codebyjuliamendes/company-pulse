'use strict';

// Hours after which a simulated source is considered stale (PRD: stale data qualifies dependent insights).
const STALE_AFTER_HOURS = 24;
// Below this source confidence an insight is treated as provisional.
const MIN_RELIABLE_CONFIDENCE = 0.8;

/**
 * Metric catalog: definition, grain and which direction is good.
 * Deterministic code owns these semantics; the database only stores observations.
 */
const CATALOG = Object.freeze({
  revenue: { direction: 'higher', grain: 'weekly', definition: 'Recognized net revenue for the week, after discounts and credits.' },
  cash_runway: {
    direction: 'higher',
    grain: 'monthly',
    definition: 'Months of operation covered by current cash at the trailing net burn rate.',
  },
  gross_margin: { direction: 'higher', grain: 'weekly', definition: 'Revenue minus direct cost of delivery, as a share of revenue.' },
  arr: { direction: 'higher', grain: 'monthly', definition: 'Annualized value of active recurring contracts at period end.' },
  pipeline_coverage: {
    direction: 'higher',
    grain: 'weekly',
    definition: 'Qualified open pipeline divided by the remaining bookings target.',
  },
  win_rate: {
    direction: 'higher',
    grain: 'weekly',
    definition: 'Qualified opportunities won as a share of qualified opportunities closed.',
  },
  customer_concentration: { direction: 'lower', grain: 'monthly', definition: 'Share of revenue from the single largest customer.' },
  sla_attainment: { direction: 'higher', grain: 'weekly', definition: 'Share of tickets resolved within the contracted service level.' },
  open_incidents: {
    direction: 'lower',
    grain: 'daily',
    definition: 'Open priority-1 and priority-2 incidents at the time of the snapshot.',
  },
  headcount: { direction: 'higher', grain: 'monthly', definition: 'Active employees at period end, aggregated (no individual records).' },
  attrition: {
    direction: 'lower',
    grain: 'quarterly',
    definition: 'Voluntary departures in the quarter as a share of average headcount (aggregate).',
  },
  data_quality_missing: { direction: 'lower', grain: 'daily', definition: 'CRM account records without an assigned owner.' },
});

const DOMAINS = ['finance', 'commercial', 'operations', 'people', 'data_quality'];

const isStale = metric => Number(metric.freshness_hours) > STALE_AFTER_HOURS;
const isLowConfidence = metric => Number(metric.confidence) < MIN_RELIABLE_CONFIDENCE;

/** 'on_track' | 'off_track' | 'no_target', honoring whether higher or lower is better. */
function targetStatus(metric) {
  if (metric.target === null || metric.target === undefined) return 'no_target';
  const direction = CATALOG[metric.metric_key]?.direction ?? 'higher';
  const off = direction === 'lower' ? metric.value > metric.target : metric.value < metric.target;
  return off ? 'off_track' : 'on_track';
}

/** Relative variance against target; null when there is no target or it is zero (no division by zero). */
function varianceToTarget(metric) {
  if (metric.target === null || metric.target === undefined || metric.target === 0) return null;
  return Math.round(((metric.value - metric.target) / Math.abs(metric.target)) * 10000) / 10000;
}

/** Catalog semantics merged into a stored observation for API responses. */
function describeMetric(metric) {
  const entry = CATALOG[metric.metric_key];
  return {
    definition: entry?.definition ?? null,
    direction: entry?.direction ?? 'higher',
    grain: entry?.grain ?? null,
    status: targetStatus(metric),
    variance_to_target: varianceToTarget(metric),
    stale: isStale(metric),
    low_confidence: isLowConfidence(metric),
  };
}

/** Per-domain counts of metrics, stale sources and metrics off target. */
function domainHealth(metrics) {
  return DOMAINS.map(domain => {
    const set = metrics.filter(m => m.domain === domain);
    return {
      domain,
      count: set.length,
      stale: set.filter(isStale).length,
      attention: set.filter(m => targetStatus(m) === 'off_track').length,
    };
  });
}

module.exports = {
  CATALOG,
  DOMAINS,
  STALE_AFTER_HOURS,
  MIN_RELIABLE_CONFIDENCE,
  isStale,
  isLowConfidence,
  targetStatus,
  varianceToTarget,
  describeMetric,
  domainHealth,
};
