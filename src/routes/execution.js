'use strict';

const { parseMeeting, parseDecision, parseOutcome, parseTaskCompletion, parseScenario } = require('../http/validation');

function executionRoutes(router, { workspace }) {
  const ctx = (actor, req) => ({ actor: actor.actor, requestId: req.id });

  router.add('POST', '/api/meetings', { permission: 'meetings.manage', write: true }, ({ req, actor, body }) => {
    const meeting = workspace.createMeeting(parseMeeting(body), ctx(actor, req));
    return { status: 201, body: { meeting, dashboard: workspace.dashboard(actor) } };
  });

  router.add('POST', '/api/decisions', { permission: 'decisions.manage', write: true }, ({ req, actor, body }) => {
    const decision = workspace.recordDecision(parseDecision(body), ctx(actor, req));
    return { status: 201, body: { decision, dashboard: workspace.dashboard(actor) } };
  });

  router.add('POST', '/api/decisions/:id/outcome', { permission: 'decisions.manage', write: true }, ({ req, actor, body, params }) => {
    const decision = workspace.recordDecisionOutcome(params.id, parseOutcome(body), ctx(actor, req));
    return { status: 200, body: { decision, dashboard: workspace.dashboard(actor) } };
  });

  router.add('POST', '/api/tasks/:id/complete', { permission: 'tasks.manage', write: true }, ({ req, actor, body, params }) => {
    const task = workspace.completeTask(params.id, parseTaskCompletion(body), ctx(actor, req));
    return { status: 200, body: { task, dashboard: workspace.dashboard(actor) } };
  });

  // Read-only calculation: rate limited like a write because it is a POST with a body.
  router.add('POST', '/api/scenarios/preview', { permission: 'scenarios.run', write: true }, ({ body }) => ({
    status: 200,
    body: workspace.scenario(parseScenario(body)),
  }));
}

module.exports = { executionRoutes };
