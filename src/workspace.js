'use strict';

const { storeFor, newId } = require('./store');
const { listAgents, runAllAgents } = require('./agents');
const { describeMetric, domainHealth } = require('./domain/metrics');
const { previewScenario } = require('./domain/scenario');
const { PERSONAS } = require('./domain/permissions');
const { ValidationError, NotFoundError, ConflictError } = require('./domain/errors');
const { seedDemoData } = require('./seed');

const COMPANY = Object.freeze({ name: 'Northstar Systems', period: 'Week of October 26', demoMode: true });

/** Application services: each command validates references, writes and audits in one transaction. */
function createWorkspace(db) {
  const store = storeFor(db);
  const now = () => new Date().toISOString();

  function dashboard(viewer = null) {
    const metrics = store.listMetrics().map(m => ({ ...m, ...describeMetric(m) }));
    const runs = new Map(store.latestRuns().map(r => [r.agent_key, r]));
    return {
      company: { ...COMPANY, updatedAt: store.lastCompletedAt() },
      viewer,
      personas: PERSONAS.map(p => ({ ...p })),
      metrics,
      findings: store.currentFindings(),
      proposals: store.listProposals(),
      tasks: store.listTasks(),
      briefings: store.latestBriefings(),
      decisions: store.listDecisions(),
      meetings: store.listMeetings(),
      agents: listAgents().map(a => ({ ...a, lastRun: runs.get(a.key) ?? null })),
      domainHealth: domainHealth(metrics),
      counts: {
        findings: store.findingCount(),
        pending: store.pendingCount(),
        openTasks: store.openTaskCount(),
        auditEvents: store.auditCount(),
      },
    };
  }

  function createMeeting(input, { actor, requestId }) {
    return store.tx(() => {
      if (input.briefingId && !store.briefingExists(input.briefingId)) throw new ValidationError('Briefing does not exist.');
      const id = newId();
      const at = now();
      store.insertMeeting({ id, ...input, scheduledAt: at, createdBy: actor, at });
      store.appendAudit({
        actor,
        eventType: 'meeting.confirmed',
        entityType: 'meeting',
        entityId: id,
        details: { title: input.title, briefingId: input.briefingId },
        at,
        requestId,
      });
      return store.getMeeting(id);
    });
  }

  function recordDecision(input, { actor, requestId }) {
    return store.tx(() => {
      if (input.findingId && !store.findingExists(input.findingId)) throw new ValidationError('Finding does not exist.');
      if (input.meetingId && !store.getMeeting(input.meetingId)) throw new ValidationError('Meeting does not exist.');
      const id = newId();
      const at = now();
      store.insertDecision({ id, ...input, createdBy: actor, at });
      store.appendAudit({
        actor,
        eventType: 'decision.recorded',
        entityType: 'decision',
        entityId: id,
        details: { title: input.title, owner: input.owner, meetingId: input.meetingId, findingId: input.findingId, dueDate: input.dueDate },
        at,
        requestId,
      });
      return store.getDecision(id);
    });
  }

  function recordDecisionOutcome(id, { actualOutcome, status }, { actor, requestId }) {
    return store.tx(() => {
      const decision = store.getDecision(id);
      if (!decision || decision.status !== 'in_progress') throw new NotFoundError('Open decision not found.');
      const at = now();
      if (!store.recordOutcome({ id, actualOutcome, status, at })) throw new ConflictError('Decision was updated concurrently.');
      store.appendAudit({
        actor,
        eventType: 'decision.outcome_recorded',
        entityType: 'decision',
        entityId: id,
        details: { status, actualOutcome, expectedOutcome: decision.expected_outcome },
        at,
        requestId,
      });
      return store.getDecision(id);
    });
  }

  function completeTask(id, { outcome }, { actor, requestId }) {
    return store.tx(() => {
      const task = store.getTask(id);
      if (!task || task.status !== 'open') throw new NotFoundError('Open task not found.');
      const at = now();
      if (!store.completeTask({ id, at, outcome, actor })) throw new ConflictError('Task was updated concurrently.');
      store.appendAudit({
        actor,
        eventType: 'task.completed',
        entityType: 'task',
        entityId: id,
        details: { outcome, before: 'open', after: 'completed' },
        at,
        requestId,
      });
      return store.getTask(id);
    });
  }

  function scenario(assumptions) {
    const revenue = store.getMetric('revenue');
    const margin = store.getMetric('gross_margin');
    const cash = store.getMetric('cash_runway');
    if (!revenue || !margin || !cash)
      throw new ConflictError('Scenario baseline is unavailable: revenue, gross margin and cash runway are required.');
    return previewScenario({ revenue: revenue.value, grossMargin: margin.value, cashRunway: cash.value }, assumptions);
  }

  /** First boot: seed the fictional company and run every agent once. Idempotent. */
  function ensureDemo({ logger } = {}) {
    if (!store.metricCount()) seedDemoData(db);
    if (!store.runCount()) runAllAgents(db, { actor: 'system:seed', logger });
  }

  return {
    store,
    dashboard,
    createMeeting,
    recordDecision,
    recordDecisionOutcome,
    completeTask,
    scenario,
    ensureDemo,
    audit: limit => store.listAudit(limit),
  };
}

module.exports = { createWorkspace, COMPANY };
