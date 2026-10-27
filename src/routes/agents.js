'use strict';

const { runAgent, runAllAgents, reviewProposal } = require('../agents');
const { parseReview } = require('../http/validation');
const { HttpError } = require('../http/errors');

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

/** Replays the stored result for a repeated Idempotency-Key instead of running agents again. */
function idempotent(req, store, { scope, actor }, compute) {
  const key = req.headers['idempotency-key'];
  if (key === undefined) return compute();
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY.test(key))
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8–128 safe characters.');
  return store.tx(() => {
    const existing = store.getIdempotency(key);
    if (existing) {
      if (existing.scope !== scope || existing.actor !== actor)
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used for a different request.');
      return { status: existing.status_code, body: JSON.parse(existing.response_json), headers: { 'Idempotent-Replayed': 'true' } };
    }
    const result = compute();
    store.putIdempotency({ key, scope, actor, statusCode: result.status, response: result.body, at: new Date().toISOString() });
    return result;
  });
}

function agentRoutes(router, { workspace }) {
  const { store } = workspace;
  const runOptions = (actor, req) => ({ actor: actor.actor, requestId: req.id, logger: req.log });

  router.add('POST', '/api/agents/run', { permission: 'agents.run', write: true, limiter: 'agents' }, ({ req, actor }) => {
    const result = idempotent(req, store, { scope: 'agents.run:all', actor: actor.actor }, () => ({
      status: 201,
      body: { results: runAllAgents(store.db, runOptions(actor, req)) },
    }));
    return { ...result, body: { ...result.body, dashboard: workspace.dashboard(actor) } };
  });

  router.add(
    'POST',
    '/api/agents/:agentKey/run',
    { permission: 'agents.run', write: true, limiter: 'agents' },
    ({ req, actor, params }) => {
      const result = idempotent(req, store, { scope: `agents.run:${params.agentKey}`, actor: actor.actor }, () => ({
        status: 201,
        body: { result: runAgent(store.db, params.agentKey, runOptions(actor, req)) },
      }));
      return { ...result, body: { ...result.body, dashboard: workspace.dashboard(actor) } };
    },
  );

  router.add('POST', '/api/proposals/:id/review', { permission: 'proposals.review', write: true }, ({ req, actor, params, body }) => {
    const input = parseReview(body);
    const proposal = reviewProposal(store.db, params.id, { ...input, reviewer: actor.actor, requestId: req.id });
    return { status: 200, body: { proposal, dashboard: workspace.dashboard(actor) } };
  });
}

module.exports = { agentRoutes };
