'use strict';

const { transaction } = require('./db');

// Fictional company "Northstar Systems". Each row is a simulated source snapshot.
// [key, domain, label, value, unit, target, prior, period, source, confidence, freshnessHours]
const DEMO_METRICS = Object.freeze([
  ['revenue', 'finance', 'Net revenue', 920000, 'BRL', 1000000, 1010000, '2026-W43', 'Demo ERP', 0.99, 0],
  ['cash_runway', 'finance', 'Cash runway', 4.2, 'months', 6, 5.4, '2026-10', 'Demo ERP', 0.98, 1],
  ['gross_margin', 'finance', 'Gross margin', 0.34, 'ratio', 0.36, 0.35, '2026-W43', 'Demo ERP', 0.98, 0],
  ['pipeline_coverage', 'commercial', 'Pipeline coverage', 2.1, 'x', 3, 2.6, '2026-W43', 'Demo CRM', 0.96, 0],
  ['win_rate', 'commercial', 'Qualified opportunity win rate', 0.22, 'ratio', 0.25, 0.27, '2026-W43', 'Demo CRM', 0.96, 0],
  ['customer_concentration', 'commercial', 'Top customer revenue share', 0.31, 'ratio', 0.25, 0.28, '2026-10', 'Demo Billing', 0.94, 1],
  ['sla_attainment', 'operations', 'SLA attainment', 0.91, 'ratio', 0.95, 0.96, '2026-W43', 'Demo Operations', 0.97, 0],
  ['open_incidents', 'operations', 'Open high-priority incidents', 7, 'count', 3, 4, '2026-10-26', 'Demo Operations', 0.99, 0],
  ['headcount', 'people', 'Active headcount', 84, 'people', 88, 82, '2026-10', 'Demo HRIS', 0.75, 26],
  ['attrition', 'people', 'Quarterly voluntary attrition', 0.08, 'ratio', 0.06, 0.05, '2026-Q3', 'Demo HRIS', 0.75, 26],
  ['arr', 'finance', 'Annual recurring revenue', 5400000, 'BRL', 5700000, 5300000, '2026-10', 'Demo Billing', 0.97, 1],
  ['data_quality_missing', 'data_quality', 'Records missing owner', 18, 'count', 0, 12, '2026-10-26', 'Demo CRM', 0.99, 0],
]);

/**
 * Upserts the demo snapshots (idempotent). observed_at is derived from the simulated
 * freshness so both always agree. An upsert updates in place instead of deleting and
 * re-inserting rows that evidence references.
 */
function seedDemoData(db, now = new Date()) {
  const upsert = db.prepare(`INSERT INTO metric_snapshots
      (id, metric_key, domain, label, value, unit, target, prior_value, period, source, observed_at, freshness_hours, confidence, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET metric_key = excluded.metric_key, domain = excluded.domain, label = excluded.label,
      value = excluded.value, unit = excluded.unit, target = excluded.target, prior_value = excluded.prior_value,
      period = excluded.period, source = excluded.source, observed_at = excluded.observed_at,
      freshness_hours = excluded.freshness_hours, confidence = excluded.confidence, metadata_json = excluded.metadata_json`);
  transaction(db, () => {
    for (const [key, domain, label, value, unit, target, prior, period, source, confidence, freshness] of DEMO_METRICS) {
      const observedAt = new Date(now.getTime() - freshness * 3600000).toISOString();
      const metadata = JSON.stringify({ simulated: true, connector: 'fixture', fixtureVersion: 'northstar-2026-10' });
      upsert.run(
        `demo-${key}`,
        key,
        domain,
        label,
        value,
        unit,
        target,
        prior,
        period,
        source,
        observedAt,
        freshness,
        confidence,
        metadata,
      );
    }
  });
  return DEMO_METRICS.length;
}

module.exports = { seedDemoData, DEMO_METRICS };
