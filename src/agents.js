'use strict';

const crypto = require('node:crypto');
const { storeFor, newId } = require('./store');
const { RULESET_VERSION, evaluate } = require('./domain/rules');
const { composeBriefing, agendaFollowUps } = require('./domain/briefing');
const { ValidationError, NotFoundError, ConflictError } = require('./domain/errors');

const AGENTS = Object.freeze([
  {
    key: 'company-health',
    name: 'Company Health',
    domains: ['finance', 'commercial', 'operations', 'people'],
    description: 'Summarizes material changes and company-wide risks.',
  },
  { key: 'finance', name: 'Finance', domains: ['finance'], description: 'Monitors revenue, margin, runway and planning signals.' },
  {
    key: 'commercial',
    name: 'Commercial',
    domains: ['commercial'],
    description: 'Monitors pipeline, conversion and customer concentration.',
  },
  { key: 'operations', name: 'Operations', domains: ['operations'], description: 'Monitors service levels and operational incidents.' },
  {
    key: 'meeting-prep',
    name: 'Meeting Prep & Follow-up',
    domains: ['all'],
    description: 'Creates executive briefing and follow-up tasks from current findings.',
  },
  {
    key: 'data-quality',
    name: 'Data Quality',
    domains: ['data_quality', 'all'],
    description: 'Flags stale, low-confidence or incomplete source data.',
  },
]);

class AgentRunError extends Error {
  constructor(agentKey, runId, cause) {
    super(`Agent ${agentKey} failed; the run was recorded as failed and no partial output was kept.`);
    this.name = 'AgentRunError';
    this.agentKey = agentKey;
    this.runId = runId;
    this.cause = cause;
  }
}

const timestamp = options => (options.now ? new Date(options.now) : new Date()).toISOString();

/** Canonical JSON (sorted keys) so the hash binds the exact payload an approver sees. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const payloadHash = (actionType, payload) => crypto.createHash('sha256').update(canonical({ actionType, payload })).digest('hex');

function persistFinding(store, ctx, signal, metrics) {
  const id = newId('finding');
  store.insertFinding({ id, runId: ctx.runId, agentKey: ctx.agentKey, at: ctx.at, ...signal });
  const evidence = signal.evidence.map(({ metric_key, role }) => ({ metric: metrics.get(metric_key), role })).filter(e => e.metric);
  for (const e of evidence) store.insertEvidence({ findingId: id, ...e });
  store.appendAudit({
    actor: ctx.actor,
    eventType: 'finding.created',
    entityType: 'finding',
    entityId: id,
    details: { severity: signal.severity, ruleId: signal.ruleId, evidenceCount: evidence.length },
    at: ctx.at,
    requestId: ctx.requestId,
  });
  return {
    id,
    agent_key: ctx.agentKey,
    rule_id: signal.ruleId,
    severity: signal.severity,
    title: signal.title,
    explanation: signal.explanation,
    facts: signal.facts,
    hypotheses: signal.hypotheses,
    limitations: signal.limitations,
    confidence: signal.confidence,
    evidence: evidence.map(({ metric: m, role }) => ({
      metric_key: m.metric_key,
      label: m.label,
      value: m.value,
      unit: m.unit,
      source: m.source,
      observed_at: m.observed_at,
      role,
    })),
  };
}

/** Pending proposal for the same action and metric is reused, so repeated runs do not pile up duplicates. */
function persistProposal(store, ctx, finding, spec) {
  const existing = store.pendingProposalByDedupe(spec.dedupeKey);
  if (existing) return { proposal: existing, created: false };
  const id = newId('proposal');
  const hash = payloadHash(spec.actionType, spec.payload);
  store.insertProposal({ id, findingId: finding.id, agentKey: ctx.agentKey, at: ctx.at, payloadHash: hash, ...spec });
  store.appendAudit({
    actor: ctx.actor,
    eventType: 'proposal.created',
    entityType: 'action_proposal',
    entityId: id,
    details: { requiresApproval: true, actionType: spec.actionType, tier: spec.tier, findingId: finding.id, payloadHash: hash },
    at: ctx.at,
    requestId: ctx.requestId,
  });
  return {
    created: true,
    proposal: {
      id,
      finding_id: finding.id,
      agent_key: ctx.agentKey,
      title: spec.title,
      rationale: spec.rationale,
      action_type: spec.actionType,
      tier: spec.tier,
      payload: spec.payload,
      payload_hash: hash,
      requires_approval: true,
      status: 'pending',
      created_at: ctx.at,
    },
  };
}

function createTask(store, { findingId = null, proposalId = null, title, owner, dueDate = null, actor, at, requestId, reason }) {
  const id = newId('task');
  store.insertTask({ id, findingId, proposalId, title, owner, dueDate, at, createdBy: actor });
  store.appendAudit({
    actor,
    eventType: 'task.created',
    entityType: 'task',
    entityId: id,
    details: { findingId, proposalId, owner, reason },
    at,
    requestId,
  });
  return { id, finding_id: findingId, proposal_id: proposalId, title, owner, due_date: dueDate, status: 'open', created_at: at };
}

function executeAgent(store, ctx, results) {
  const metrics = store.metricMap();
  if (ctx.agentKey === 'meeting-prep') {
    // Briefing cites only the other agents' current findings.
    const findings = store.currentFindings({ excludeAgent: 'meeting-prep' });
    for (const item of agendaFollowUps(findings)) {
      if (store.openTaskByTitle(item.title)) continue;
      results.tasks.push(
        createTask(store, { ...item, actor: ctx.actor, at: ctx.at, requestId: ctx.requestId, reason: 'rule:critical_finding_agenda' }),
      );
    }
    const briefing = composeBriefing({ findings, pendingProposals: store.pendingProposals(), at: ctx.at });
    const id = newId('briefing');
    store.insertBriefing({ id, at: ctx.at, ...briefing });
    results.briefing = { id, ...briefing };
  } else {
    for (const signal of evaluate(ctx.agentKey, metrics)) {
      const finding = persistFinding(store, ctx, signal, metrics);
      results.findings.push(finding);
      if (!signal.proposal) continue;
      const { proposal, created } = persistProposal(store, ctx, finding, signal.proposal);
      if (created) results.proposals.push(proposal);
      else results.reused_proposal_ids.push(proposal.id);
    }
  }
  return [...metrics.values()]
    .map(m => `${m.metric_key}:${m.value}:${m.observed_at}`)
    .sort()
    .join('|');
}

/**
 * Runs one bounded agent. Output (findings, evidence, proposals, briefing) commits atomically
 * with its audit events; on failure nothing partial is kept and a failed run is recorded.
 * @param options.now fixed clock for deterministic runs
 * @param options.actor who triggered the run (audit), default 'system'
 */
function runAgent(db, agentKey, options = {}) {
  const agent = AGENTS.find(a => a.key === agentKey);
  if (!agent) throw new NotFoundError(`Unknown agent: ${agentKey}`);
  const store = storeFor(db);
  const at = timestamp(options);
  const runId = newId('run');
  const ctx = { runId, agentKey, at, actor: `agent:${agentKey}`, requestId: options.requestId ?? null };
  const trigger = options.actor ?? 'system';
  const results = {
    agent: agentKey,
    status: 'succeeded',
    rule_version: RULESET_VERSION,
    findings: [],
    proposals: [],
    reused_proposal_ids: [],
    tasks: [],
    briefing: null,
  };
  try {
    store.tx(() => {
      store.insertRun({ id: runId, agentKey, status: 'running', at, actor: trigger, ruleVersion: RULESET_VERSION });
      const inputDigest = executeAgent(store, ctx, results);
      const summary = `${results.findings.length} findings, ${results.proposals.length} proposals, ${results.tasks.length} tasks`;
      store.finishRun({ id: runId, status: 'succeeded', at, summary, inputDigest });
      store.appendAudit({
        actor: ctx.actor,
        eventType: 'agent.completed',
        entityType: 'agent_run',
        entityId: runId,
        details: {
          triggeredBy: trigger,
          ruleVersion: RULESET_VERSION,
          findingCount: results.findings.length,
          proposalCount: results.proposals.length,
          taskCount: results.tasks.length,
        },
        at,
        requestId: ctx.requestId,
      });
    });
  } catch (error) {
    try {
      store.tx(() => {
        store.insertRun({ id: runId, agentKey, status: 'failed', at, actor: trigger, ruleVersion: RULESET_VERSION });
        store.finishRun({
          id: runId,
          status: 'failed',
          at,
          summary: 'Run failed; no output was kept.',
          error: String(error?.message ?? error).slice(0, 500),
        });
        store.appendAudit({
          actor: ctx.actor,
          eventType: 'agent.failed',
          entityType: 'agent_run',
          entityId: runId,
          details: { triggeredBy: trigger },
          at,
          requestId: ctx.requestId,
        });
      });
    } catch {
      throw error; // The database itself is failing: surface the original error.
    }
    throw new AgentRunError(agentKey, runId, error);
  }
  results.run_id = runId;
  return results;
}

/** Runs every agent in order; one agent failing does not stop the others. */
function runAllAgents(db, options = {}) {
  return AGENTS.map(agent => {
    try {
      return runAgent(db, agent.key, options);
    } catch (error) {
      if (!(error instanceof AgentRunError)) throw error;
      options.logger?.error('agent_run_failed', { agent: agent.key, runId: error.runId, err: error.cause?.message });
      return {
        agent: agent.key,
        status: 'failed',
        run_id: error.runId,
        findings: [],
        proposals: [],
        reused_proposal_ids: [],
        tasks: [],
        briefing: null,
      };
    }
  });
}

/**
 * Human review of a proposal. Approval, the allowlisted internal operation (creating the
 * proposed task) and the audit events commit in one transaction. Rejection has no side effect.
 */
function reviewProposal(db, proposalId, { decision, reviewer, note = '', requestId = null, now } = {}) {
  if (!['approved', 'rejected'].includes(decision)) throw new ValidationError('decision must be approved or rejected');
  if (!reviewer || typeof reviewer !== 'string') throw new ValidationError('reviewer is required');
  if (reviewer.startsWith('agent:')) throw new ValidationError('agents cannot review proposals');
  const store = storeFor(db);
  const at = now ? new Date(now).toISOString() : new Date().toISOString();
  return store.tx(() => {
    const current = store.getProposal(proposalId);
    if (!current) throw new NotFoundError('proposal not found');
    if (current.status !== 'pending') throw new ConflictError(`proposal is already ${current.status}`);
    const hash = payloadHash(current.action_type, current.payload);
    if (current.payload_hash && current.payload_hash !== hash)
      throw new ConflictError('proposal payload changed after it was proposed; a new proposal is required');
    if (!store.reviewProposal({ id: proposalId, status: decision, at, reviewer, note }))
      throw new ConflictError('proposal was reviewed concurrently');

    let task = null;
    const spec = current.payload?.task;
    if (decision === 'approved' && spec && typeof spec.title === 'string' && typeof spec.owner === 'string') {
      task = createTask(store, {
        findingId: current.finding_id,
        proposalId,
        title: spec.title.slice(0, 180),
        owner: spec.owner.slice(0, 120),
        actor: reviewer,
        at,
        requestId,
        reason: 'proposal.approved',
      });
    }
    store.appendAudit({
      actor: reviewer,
      eventType: `proposal.${decision}`,
      entityType: 'action_proposal',
      entityId: proposalId,
      details: { note, payloadHash: hash, taskId: task?.id ?? null, externalEffect: false },
      at,
      requestId,
    });
    return { ...store.getProposal(proposalId), task };
  });
}

const listAgents = () => AGENTS.map(agent => ({ ...agent, domains: [...agent.domains] }));

module.exports = { AGENTS, AgentRunError, listAgents, runAgent, runAllAgents, reviewProposal, payloadHash };
