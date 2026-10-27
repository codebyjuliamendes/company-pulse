'use strict';

const SEVERITY_ORDER = { critical: 0, watch: 1, info: 2 };
const bySeverity = (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);

/**
 * Builds the weekly briefing from current findings and pending proposals. Pure: the text
 * only restates cited findings; caveats come from each finding's stated limitations.
 */
function composeBriefing({ findings, pendingProposals, at }) {
  const ordered = [...findings].sort(bySeverity);
  const signals =
    ordered.map(f => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.explanation}`).join('\n') ||
    '- No material findings in the current review.';
  const pending = pendingProposals.map(p => `- Pending approval: ${p.title}`).join('\n') || '- No pending proposals.';
  const caveats =
    [...new Set(ordered.flatMap(f => f.limitations ?? []))].map(l => `- ${l}`).join('\n') ||
    '- No stale or low-confidence sources in cited signals.';
  const period = new Date(at).toISOString().slice(0, 10);
  return {
    period,
    title: 'Weekly executive briefing',
    body: `Executive review\n\nMaterial signals\n${signals}\n\nDecisions awaiting review\n${pending}\n\nData caveats\n${caveats}\n\nUse linked metric evidence to verify each signal. Hypotheses are not established causes.`,
    finding_ids: ordered.map(f => f.id),
    decision_ids: pendingProposals.map(p => p.id),
  };
}

/** Critical findings become agenda follow-ups (the one narrowly configured Tier B rule). */
const agendaFollowUps = findings =>
  findings.filter(f => f.severity === 'critical').map(f => ({ findingId: f.id, title: `Discuss: ${f.title}`, owner: 'CEO' }));

module.exports = { composeBriefing, agendaFollowUps, bySeverity };
