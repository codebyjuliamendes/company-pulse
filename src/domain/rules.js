'use strict';

const { CATALOG, STALE_AFTER_HOURS, isStale, isLowConfidence, varianceToTarget } = require('./metrics');

// Bump when a threshold, severity or wording rule changes; stored on every agent run.
const RULESET_VERSION = '2026.10.1';

const STALE_PENALTY = 0.85;
const round2 = n => Math.round(n * 100) / 100;
const hasTarget = m => typeof m.target === 'number' && Number.isFinite(m.target);

/**
 * Threshold rules. Each one names the metric it reads, the comparison it applies and
 * the internal (Tier B) follow-up it may propose. Rules never perform actions.
 */
const THRESHOLD_RULES = [
  {
    id: 'finance.revenue_below_plan',
    agents: ['finance', 'company-health'],
    metric: 'revenue',
    comparison: 'below_target',
    threshold: m => (hasTarget(m) ? m.target * 0.95 : null),
    fires: (m, t) => t !== null && m.value < t,
    severity: () => 'critical',
    title: 'Revenue is below plan',
    explanation: 'Net revenue is materially below its recorded target. This is a performance signal, not a causal diagnosis.',
    hypotheses: ['Review segment, renewal and pipeline drivers; current snapshot alone does not establish cause.'],
    confidence: 0.9,
    proposal: {
      title: 'Review revenue recovery options',
      rationale: 'Revenue is below plan; inspect the linked source data and assign an owner for a recovery plan.',
      actionType: 'review_revenue',
      owner: 'CFO',
      task: 'Prepare revenue recovery options',
    },
  },
  {
    id: 'finance.cash_runway_below_threshold',
    agents: ['finance', 'company-health'],
    metric: 'cash_runway',
    comparison: 'below_threshold',
    threshold: () => 6,
    fires: (m, t) => m.value < t,
    severity: m => (m.value < 3 ? 'critical' : 'watch'),
    title: 'Cash runway needs attention',
    explanation: 'The current cash runway is below the six-month planning threshold.',
    hypotheses: ['Investigate forecast assumptions and upcoming obligations.'],
    confidence: 0.88,
    proposal: {
      title: 'Review cash forecast and scenarios',
      rationale:
        'Runway is below the planning threshold. Review assumptions and prepare options for leadership; no cash action is performed.',
      actionType: 'review_finance_forecast',
      owner: 'CFO',
      task: 'Prepare cash forecast scenarios',
    },
  },
  {
    id: 'finance.gross_margin_below_target',
    agents: ['finance', 'company-health'],
    metric: 'gross_margin',
    comparison: 'below_target',
    threshold: m => (hasTarget(m) ? m.target - 0.01 : null),
    fires: (m, t) => t !== null && m.value < t,
    severity: () => 'watch',
    title: 'Gross margin is below target',
    explanation: 'Reported gross margin is more than one percentage point below target.',
    hypotheses: ['Check pricing, cost mix and one-off adjustments.'],
    confidence: 0.84,
    proposal: {
      title: 'Review margin drivers',
      rationale: 'Inspect cost and pricing drivers before changing plans.',
      actionType: 'review_margin',
      owner: 'CFO',
      task: 'Review margin drivers',
    },
  },
  {
    id: 'commercial.pipeline_coverage_below_target',
    agents: ['commercial', 'company-health'],
    metric: 'pipeline_coverage',
    comparison: 'below_target',
    threshold: m => (hasTarget(m) ? m.target : null),
    fires: (m, t) => t !== null && m.value < t,
    severity: () => 'watch',
    title: 'Pipeline coverage is below target',
    explanation: 'Current pipeline coverage is below the recorded target.',
    hypotheses: ['Validate opportunity stage quality and forecast timing.'],
    confidence: 0.83,
    proposal: {
      title: 'Review pipeline coverage',
      rationale: 'Inspect pipeline by segment and stage; confirm forecast assumptions.',
      actionType: 'review_pipeline',
      owner: 'VP Sales',
      task: 'Review pipeline coverage by segment and stage',
    },
  },
  {
    id: 'commercial.win_rate_below_target',
    agents: ['commercial', 'company-health'],
    metric: 'win_rate',
    comparison: 'below_target',
    threshold: m => (hasTarget(m) ? m.target - 0.02 : null),
    fires: (m, t) => t !== null && m.value < t,
    severity: () => 'watch',
    title: 'Win rate has declined below target',
    explanation: 'Qualified opportunity win rate is below target; this does not identify a root cause.',
    hypotheses: ['Review recent losses, qualification and sales cycle changes.'],
    confidence: 0.8,
    proposal: {
      title: 'Review recent opportunity losses',
      rationale: 'Summarize common loss reasons for leadership review.',
      actionType: 'analyze_win_rate',
      owner: 'VP Sales',
      task: 'Summarize recent opportunity loss reasons',
    },
  },
  {
    id: 'commercial.customer_concentration_above_threshold',
    agents: ['commercial', 'company-health'],
    metric: 'customer_concentration',
    comparison: 'above_threshold',
    threshold: m => m.target ?? 0.25,
    fires: (m, t) => m.value > t,
    severity: () => 'watch',
    title: 'Revenue concentration exceeds threshold',
    explanation: 'The largest customer contributes more revenue than the configured concentration threshold.',
    hypotheses: ['Assess renewal exposure and diversification opportunities.'],
    confidence: 0.86,
    proposal: {
      title: 'Review largest-customer exposure',
      rationale: 'Prepare a renewal and concentration risk review.',
      actionType: 'review_customer_concentration',
      owner: 'CEO',
      task: 'Prepare largest-customer renewal risk review',
    },
  },
  {
    id: 'operations.sla_below_target',
    agents: ['operations', 'company-health'],
    metric: 'sla_attainment',
    comparison: 'below_target',
    threshold: m => m.target ?? 0.95,
    fires: (m, t) => m.value < t,
    severity: () => 'watch',
    title: 'SLA attainment is below target',
    explanation: 'Service-level attainment is below the recorded target.',
    hypotheses: ['Inspect affected service areas and time windows.'],
    confidence: 0.86,
    proposal: {
      title: 'Review SLA misses',
      rationale: 'Identify the services and customer impact behind recent misses.',
      actionType: 'review_sla',
      owner: 'COO',
      task: 'Review services behind recent SLA misses',
    },
  },
  {
    id: 'operations.incident_backlog_above_limit',
    agents: ['operations', 'company-health'],
    metric: 'open_incidents',
    comparison: 'above_threshold',
    threshold: m => m.target ?? 3,
    fires: (m, t) => m.value > t,
    severity: m => (m.value > 6 ? 'critical' : 'watch'),
    title: 'High-priority incident backlog is elevated',
    explanation: 'Open high-priority incidents exceed the configured limit.',
    hypotheses: ['Check incident age, customer impact and ownership.'],
    confidence: 0.9,
    proposal: {
      title: 'Triage high-priority incidents',
      rationale: 'Review open incident ownership and target dates.',
      actionType: 'triage_incidents',
      owner: 'COO',
      task: 'Triage high-priority incidents',
    },
  },
  {
    id: 'people.attrition_above_target',
    agents: ['company-health'],
    metric: 'attrition',
    comparison: 'above_target',
    threshold: m => (hasTarget(m) ? m.target : null),
    fires: (m, t) => t !== null && m.value > t,
    severity: () => 'watch',
    title: 'Voluntary attrition is above target',
    explanation: 'Aggregated quarterly voluntary attrition is above its target. No individual-level data is used.',
    hypotheses: ['Compare with hiring plan and team capacity; the aggregate alone does not identify a cause.'],
    confidence: 0.8,
    proposal: {
      title: 'Review attrition against capacity plan',
      rationale: 'Review aggregated attrition with the hiring plan once the HRIS snapshot is verified.',
      actionType: 'review_attrition',
      owner: 'CEO',
      task: 'Review aggregated attrition against capacity plan',
    },
  },
];

/** States why an insight is provisional; returns adjusted confidence and limitation sentences. */
function qualify(baseConfidence, metrics) {
  const limitations = [];
  let confidence = baseConfidence;
  for (const m of metrics) {
    if (isStale(m)) {
      limitations.push(
        `${m.label} from ${m.source} is ${Math.round(m.freshness_hours)}h old (stale after ${STALE_AFTER_HOURS}h); treat as provisional.`,
      );
      confidence *= STALE_PENALTY;
    }
    if (isLowConfidence(m)) {
      limitations.push(`${m.label} source confidence is ${Math.round(m.confidence * 100)}%, below the reliability threshold.`);
      confidence = Math.min(confidence, m.confidence);
    }
  }
  return { confidence: round2(confidence), limitations };
}

function thresholdSignal(rule, m) {
  const threshold = rule.threshold(m);
  if (!rule.fires(m, threshold)) return null;
  const { confidence, limitations } = qualify(rule.confidence, [m]);
  const p = rule.proposal;
  return {
    ruleId: rule.id,
    severity: rule.severity(m),
    title: rule.title,
    explanation: rule.explanation,
    facts: [
      {
        rule: rule.id,
        metric: m.metric_key,
        comparison: rule.comparison,
        value: m.value,
        target: m.target ?? null,
        threshold,
        prior_value: m.prior_value ?? null,
        variance_to_target: varianceToTarget(m),
        unit: m.unit,
        period: m.period,
      },
    ],
    hypotheses: rule.hypotheses,
    confidence,
    limitations,
    evidence: [{ metric_key: m.metric_key, role: 'trigger' }],
    proposal: {
      title: p.title,
      rationale: p.rationale,
      actionType: p.actionType,
      tier: 'B',
      dedupeKey: `${p.actionType}:${m.metric_key}`,
      payload: { suggested_owner: p.owner, metric_key: m.metric_key, task: { title: p.task, owner: p.owner } },
    },
  };
}

function dataQualitySignals(metrics) {
  const signals = [];
  for (const m of metrics.values()) {
    if (isStale(m) || isLowConfidence(m)) {
      signals.push({
        ruleId: 'data_quality.freshness_or_confidence',
        severity: m.freshness_hours > 72 ? 'critical' : 'watch',
        title: `Data freshness or confidence needs review: ${m.label}`,
        explanation:
          'This metric may not reflect the current operating state. Treat dependent findings as provisional until the source is refreshed or verified.',
        facts: [
          {
            rule: 'data_quality.freshness_or_confidence',
            metric: m.metric_key,
            freshness_hours: m.freshness_hours,
            stale_after_hours: STALE_AFTER_HOURS,
            confidence: m.confidence,
          },
        ],
        hypotheses: [],
        confidence: 0.99,
        limitations: [],
        evidence: [{ metric_key: m.metric_key, role: 'quality_signal' }],
        proposal: {
          title: 'Refresh or verify source data',
          rationale: `Verify ${m.label} from ${m.source} before relying on it.`,
          actionType: 'refresh_data',
          tier: 'B',
          dedupeKey: `refresh_data:${m.metric_key}`,
          payload: {
            metric_key: m.metric_key,
            source: m.source,
            suggested_owner: 'Data steward',
            task: { title: `Verify ${m.label} with ${m.source}`, owner: 'Data steward' },
          },
        },
      });
    }
    if (m.metric_key === 'data_quality_missing' && m.value > 0) {
      signals.push({
        ruleId: 'data_quality.records_missing_owner',
        severity: 'watch',
        title: 'CRM records are missing an owner',
        explanation: `${m.value} records have no assigned owner, which can weaken follow-up reporting.`,
        facts: [{ rule: 'data_quality.records_missing_owner', metric: m.metric_key, missing_owner_records: m.value }],
        hypotheses: [],
        confidence: 0.98,
        limitations: [],
        evidence: [{ metric_key: m.metric_key, role: 'quality_signal' }],
        proposal: {
          title: 'Assign owners to unowned CRM records',
          rationale: 'Review and assign owners to records flagged by the CRM data-quality report.',
          actionType: 'assign_record_owners',
          tier: 'B',
          dedupeKey: 'assign_record_owners:data_quality_missing',
          payload: {
            count: m.value,
            metric_key: m.metric_key,
            suggested_owner: 'RevOps',
            task: { title: 'Assign owners to unowned CRM records', owner: 'RevOps' },
          },
        },
      });
    }
  }
  // Catalog metrics with no observation: insufficient evidence is stated, never guessed.
  for (const key of Object.keys(CATALOG)) {
    if (metrics.has(key)) continue;
    signals.push({
      ruleId: 'data_quality.metric_missing',
      severity: 'watch',
      title: `Expected metric has no observation: ${key}`,
      explanation: 'A cataloged metric has no snapshot, so rules that depend on it could not be evaluated.',
      facts: [{ rule: 'data_quality.metric_missing', metric: key }],
      hypotheses: [],
      confidence: 0.99,
      limitations: ['No source observation exists for this metric.'],
      evidence: [],
      proposal: null,
    });
  }
  return signals;
}

/**
 * Pure and deterministic: same metrics in, same signals out. Each signal cites the metric
 * keys that triggered it, the rule id and the compared values.
 * @param agentKey agent whose rules apply
 * @param metrics Map<metric_key, snapshot>
 */
function evaluate(agentKey, metrics) {
  if (agentKey === 'data-quality') return dataQualitySignals(metrics);
  return THRESHOLD_RULES.filter(rule => rule.agents.includes(agentKey))
    .map(rule => (metrics.has(rule.metric) ? thresholdSignal(rule, metrics.get(rule.metric)) : null))
    .filter(Boolean);
}

module.exports = { RULESET_VERSION, THRESHOLD_RULES, evaluate, qualify };
