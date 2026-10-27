'use strict';

const { randomUUID } = require('node:crypto');
const { transaction } = require('./db');

const newId = prefix => (prefix ? `${prefix}_${randomUUID()}` : randomUUID());
const parse = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};
const SEVERITY_SQL = "CASE severity WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END";

/** Data access for one SQLite connection. All SQL lives here; statements are prepared once and reused. */
function createStore(db) {
  const cache = new Map();
  const sql = text => {
    let stmt = cache.get(text);
    if (!stmt) cache.set(text, (stmt = db.prepare(text)));
    return stmt;
  };
  const one = (text, ...params) => sql(text).get(...params) ?? null;
  const all = (text, ...params) => sql(text).all(...params);
  const run = (text, ...params) => sql(text).run(...params);

  const findingDto = row => ({
    ...row,
    facts: parse(row.facts_json, []),
    hypotheses: parse(row.hypotheses_json, []),
    limitations: parse(row.limitations_json, []),
    evidence: all(
      `SELECT e.*, m.metric_key, m.label, m.unit FROM evidence e JOIN metric_snapshots m ON m.id = e.metric_id
       WHERE e.finding_id = ? ORDER BY e.rowid`,
      row.id,
    ),
  });
  const proposalDto = row => row && { ...row, requires_approval: Boolean(row.requires_approval), payload: parse(row.payload_json, {}) };

  return {
    db,
    tx: fn => transaction(db, fn),
    newId,
    ping: () => one('SELECT 1 AS ok').ok === 1,

    // Metrics
    listMetrics: () =>
      all('SELECT * FROM metric_snapshots ORDER BY domain, metric_key').map(m => ({ ...m, metadata: parse(m.metadata_json, {}) })),
    metricMap: () => new Map(all('SELECT * FROM metric_snapshots').map(m => [m.metric_key, m])),
    getMetric: key => one('SELECT * FROM metric_snapshots WHERE metric_key = ?', key),
    metricCount: () => one('SELECT COUNT(*) AS n FROM metric_snapshots').n,

    // Agent runs
    insertRun: ({ id, agentKey, status, at, actor, ruleVersion }) =>
      run(
        `INSERT INTO agent_runs (id, agent_key, status, started_at, completed_at, summary, input_digest, actor, rule_version)
         VALUES (?, ?, ?, ?, NULL, '', '', ?, ?)`,
        id,
        agentKey,
        status,
        at,
        actor,
        ruleVersion,
      ),
    finishRun: ({ id, status, at, summary, inputDigest = '', error = null }) =>
      run(
        'UPDATE agent_runs SET status = ?, completed_at = ?, summary = ?, input_digest = ?, error = ? WHERE id = ?',
        status,
        at,
        summary,
        inputDigest,
        error,
        id,
      ),
    runCount: () => one('SELECT COUNT(*) AS n FROM agent_runs').n,
    latestRuns: () =>
      all(
        `SELECT id, agent_key, status, started_at, completed_at, summary, actor, rule_version FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY agent_key ORDER BY started_at DESC, rowid DESC) AS rn FROM agent_runs
         ) WHERE rn = 1`,
      ),
    lastCompletedAt: () => one("SELECT MAX(completed_at) AS at FROM agent_runs WHERE status = 'succeeded'").at,

    // Findings and evidence
    insertFinding: f =>
      run(
        `INSERT INTO findings (id, run_id, agent_key, severity, title, explanation, facts_json, hypotheses_json, confidence, created_at, rule_id, limitations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        f.id,
        f.runId,
        f.agentKey,
        f.severity,
        f.title,
        f.explanation,
        JSON.stringify(f.facts),
        JSON.stringify(f.hypotheses),
        f.confidence,
        f.at,
        f.ruleId,
        JSON.stringify(f.limitations),
      ),
    insertEvidence: e =>
      run(
        `INSERT INTO evidence (id, finding_id, metric_id, role, captured_value, captured_source, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId('evidence'),
        e.findingId,
        e.metric.id,
        e.role,
        e.metric.value,
        e.metric.source,
        e.metric.observed_at,
      ),
    findingExists: id => Boolean(one('SELECT 1 AS ok FROM findings WHERE id = ?', id)),
    /** Findings from each agent's latest successful run, one per title, most severe first. */
    currentFindings: ({ limit = 16, excludeAgent = null } = {}) =>
      all(
        `WITH latest AS (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_key ORDER BY completed_at DESC, rowid DESC) AS rn
             FROM agent_runs WHERE status = 'succeeded' AND (? IS NULL OR agent_key <> ?)
           ) WHERE rn = 1
         ), ranked AS (
           SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.title ORDER BY f.created_at DESC, f.rowid DESC) AS rn
           FROM findings f JOIN latest l ON l.id = f.run_id
         )
         SELECT id, run_id, agent_key, severity, title, explanation, facts_json, hypotheses_json, confidence, created_at, rule_id, limitations_json
         FROM ranked WHERE rn = 1 ORDER BY ${SEVERITY_SQL}, created_at DESC, title LIMIT ?`,
        excludeAgent,
        excludeAgent,
        limit,
      ).map(findingDto),
    findingCount: () => one('SELECT COUNT(*) AS n FROM findings').n,

    // Proposals
    pendingProposalByDedupe: key =>
      proposalDto(one("SELECT * FROM action_proposals WHERE dedupe_key = ? AND status = 'pending' LIMIT 1", key)),
    insertProposal: p =>
      run(
        `INSERT INTO action_proposals (id, finding_id, agent_key, title, rationale, action_type, payload_json, requires_approval, status, created_at, tier, dedupe_key, payload_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?, ?)`,
        p.id,
        p.findingId,
        p.agentKey,
        p.title,
        p.rationale,
        p.actionType,
        JSON.stringify(p.payload),
        p.at,
        p.tier,
        p.dedupeKey,
        p.payloadHash,
      ),
    getProposal: id => proposalDto(one('SELECT * FROM action_proposals WHERE id = ?', id)),
    pendingProposals: () =>
      all("SELECT id, title, status, created_at FROM action_proposals WHERE status = 'pending' ORDER BY created_at DESC, rowid DESC"),
    listProposals: (limit = 20) =>
      all(
        `SELECT p.*, f.title AS finding_title FROM action_proposals p LEFT JOIN findings f ON f.id = p.finding_id
         ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC, p.rowid DESC LIMIT ?`,
        limit,
      ).map(proposalDto),
    /** Conditional update: returns false if another review won the race. */
    reviewProposal: ({ id, status, at, reviewer, note }) =>
      run(
        "UPDATE action_proposals SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'pending'",
        status,
        at,
        reviewer,
        note,
        id,
      ).changes === 1,
    pendingCount: () => one("SELECT COUNT(*) AS n FROM action_proposals WHERE status = 'pending'").n,

    // Tasks
    openTaskByTitle: title => one("SELECT * FROM tasks WHERE title = ? AND status = 'open' LIMIT 1", title),
    insertTask: t =>
      run(
        `INSERT INTO tasks (id, finding_id, proposal_id, title, owner, due_date, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        t.id,
        t.findingId,
        t.proposalId,
        t.title,
        t.owner,
        t.dueDate,
        t.at,
        t.createdBy,
      ),
    getTask: id => one('SELECT * FROM tasks WHERE id = ?', id),
    listTasks: (limit = 12) =>
      all(
        "SELECT * FROM tasks ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date IS NULL, due_date, created_at DESC LIMIT ?",
        limit,
      ),
    completeTask: ({ id, at, outcome, actor }) =>
      run(
        "UPDATE tasks SET status = 'completed', completed_at = ?, outcome = ?, completed_by = ? WHERE id = ? AND status = 'open'",
        at,
        outcome,
        actor,
        id,
      ).changes === 1,
    openTaskCount: () => one("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'").n,

    // Briefings
    insertBriefing: b =>
      run(
        'INSERT INTO briefings (id, period, title, body, finding_ids_json, decision_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        b.id,
        b.period,
        b.title,
        b.body,
        JSON.stringify(b.finding_ids),
        JSON.stringify(b.decision_ids),
        b.at,
      ),
    briefingExists: id => Boolean(one('SELECT 1 AS ok FROM briefings WHERE id = ?', id)),
    latestBriefings: (limit = 4) =>
      all('SELECT * FROM briefings ORDER BY created_at DESC, rowid DESC LIMIT ?', limit).map(b => ({
        ...b,
        finding_ids: parse(b.finding_ids_json, []),
        decision_ids: parse(b.decision_ids_json, []),
      })),

    // Meetings
    insertMeeting: m =>
      run(
        'INSERT INTO meetings (id, briefing_id, title, scheduled_at, agenda, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        m.id,
        m.briefingId,
        m.title,
        m.scheduledAt,
        m.agenda,
        m.notes,
        m.createdBy,
        m.at,
      ),
    getMeeting: id => one('SELECT * FROM meetings WHERE id = ?', id),
    listMeetings: (limit = 10) => all('SELECT * FROM meetings ORDER BY scheduled_at DESC, rowid DESC LIMIT ?', limit),

    // Decisions
    insertDecision: d =>
      run(
        `INSERT INTO decision_records (id, meeting_id, finding_id, title, decision, owner, due_date, expected_outcome, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.id,
        d.meetingId,
        d.findingId,
        d.title,
        d.decision,
        d.owner,
        d.dueDate,
        d.expectedOutcome,
        d.createdBy,
        d.at,
      ),
    getDecision: id => one('SELECT * FROM decision_records WHERE id = ?', id),
    listDecisions: (limit = 20) =>
      all(
        "SELECT * FROM decision_records ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, due_date IS NULL, due_date, created_at DESC LIMIT ?",
        limit,
      ),
    recordOutcome: ({ id, actualOutcome, status, at }) =>
      run(
        "UPDATE decision_records SET actual_outcome = ?, status = ?, reviewed_at = ? WHERE id = ? AND status = 'in_progress'",
        actualOutcome,
        status,
        at,
        id,
      ).changes === 1,

    // Audit (append-only; enforced by triggers)
    appendAudit: ({ actor, eventType, entityType, entityId, details = {}, at, requestId = null }) =>
      run(
        'INSERT INTO audit_log (id, actor, event_type, entity_type, entity_id, details_json, occurred_at, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId('audit'),
        actor,
        eventType,
        entityType,
        entityId,
        JSON.stringify(details),
        at,
        requestId,
      ),
    listAudit: (limit = 80) =>
      all('SELECT * FROM audit_log ORDER BY occurred_at DESC, rowid DESC LIMIT ?', limit).map(e => ({
        ...e,
        details: parse(e.details_json, {}),
      })),
    auditCount: () => one('SELECT COUNT(*) AS n FROM audit_log').n,

    // Idempotency
    getIdempotency: key => one('SELECT * FROM idempotency_keys WHERE key = ?', key),
    putIdempotency: ({ key, scope, actor, statusCode, response, at }) =>
      run(
        'INSERT INTO idempotency_keys (key, scope, actor, status_code, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        key,
        scope,
        actor,
        statusCode,
        JSON.stringify(response),
        at,
      ),
  };
}

const stores = new WeakMap();
/** One store (and statement cache) per connection. */
function storeFor(db) {
  let store = stores.get(db);
  if (!store) stores.set(db, (store = createStore(db)));
  return store;
}

module.exports = { createStore, storeFor, newId };
