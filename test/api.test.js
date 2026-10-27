'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer } = require('./helpers');

const asPersona = async (api, personaId) => {
  const res = await api('/api/session', { method: 'POST', body: { personaId } });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get('set-cookie').split(';')[0] };
};

test('health reports status, version and schema', async () => {
  await withServer({}, async ({ api }) => {
    const res = await api('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.schemaVersion, res.body.expectedSchemaVersion);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('security headers and CSP without unsafe-inline on pages and API', async () => {
  await withServer({}, async ({ base }) => {
    for (const route of ['/', '/api/health', '/missing']) {
      const res = await fetch(base + route);
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
    }
  });
});

test('static files: served with ETag revalidation, no traversal', async () => {
  await withServer({}, async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Good morning, Elena/);
    const etag = page.headers.get('etag');
    assert.equal((await fetch(`${base}/`, { headers: { 'if-none-match': etag } })).status, 304);
    for (const route of ['/../package.json', '/%2e%2e/package.json', '/%2Fetc%2Fpasswd', '/%E0%A4%A']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
    assert.equal((await fetch(`${base}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  });
});

test('errors are JSON with code and request id; unknown routes and methods are explicit', async () => {
  await withServer({}, async ({ api }) => {
    const missing = await api('/api/nope', { headers: { 'x-request-id': 'req-abcdef12' } });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'API route not found.', code: 'NOT_FOUND', requestId: 'req-abcdef12' });
    const wrongMethod = await api('/api/dashboard', { method: 'DELETE' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    const malformed = await api('/api/meetings', { method: 'POST', body: '{"title":' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'INVALID_JSON');
    const array = await api('/api/meetings', { method: 'POST', body: '[]' });
    assert.equal(array.status, 400);
    const big = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(70 * 1024) }) });
    assert.equal(big.status, 413);
    const form = await api('/api/meetings', { method: 'POST', body: 'title=hello', headers: { 'content-type': 'text/plain' } });
    assert.equal(form.status, 415);
  });
});

test('cross-origin writes are refused (CSRF), same-origin writes pass', async () => {
  await withServer({}, async ({ api, base }) => {
    const evil = await api('/api/agents/run', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.body.code, 'CROSS_ORIGIN_REJECTED');
    assert.equal((await api('/api/agents/run', { method: 'POST', body: {}, headers: { origin: 'null' } })).status, 403);
    assert.equal((await api('/api/agents/run', { method: 'POST', body: {}, headers: { origin: base } })).status, 201);
  });
});

test('rate limits writes and agent runs with 429 + Retry-After; reads are not limited', async () => {
  await withServer({ rateLimitPerMinute: 3, agentRunsPerMinute: 1 }, async ({ api }) => {
    assert.equal((await api('/api/agents/finance/run', { method: 'POST', body: {} })).status, 201);
    const agentLimited = await api('/api/agents/finance/run', { method: 'POST', body: {} });
    assert.equal(agentLimited.status, 429);
    assert.ok(Number(agentLimited.headers.get('retry-after')) > 0);
    assert.equal((await api('/api/meetings', { method: 'POST', body: {} })).status, 400);
    const limited = await api('/api/meetings', { method: 'POST', body: {} });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'RATE_LIMITED');
    assert.equal((await api('/api/dashboard')).status, 200);
  });
});

test('role-based access: server enforces permissions per persona', async () => {
  await withServer({}, async ({ api }) => {
    const viewer = await asPersona(api, 'jordan');
    const dash = await api('/api/dashboard', { headers: viewer });
    assert.equal(dash.status, 200);
    assert.equal(dash.body.viewer.role, 'viewer');
    assert.deepEqual(dash.body.viewer.permissions, ['workspace.read']);
    assert.equal((await api('/api/agents/run', { method: 'POST', body: {}, headers: viewer })).status, 403);
    assert.equal((await api('/api/audit', { headers: viewer })).status, 403);

    const analyst = await asPersona(api, 'sam');
    const pending = dash.body.proposals.find(p => p.status === 'pending');
    const denied = await api(`/api/proposals/${pending.id}/review`, { method: 'POST', body: { decision: 'approved' }, headers: analyst });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'FORBIDDEN');
    assert.equal((await api('/api/agents/data-quality/run', { method: 'POST', body: {}, headers: analyst })).status, 201);

    assert.equal((await api('/api/session', { method: 'POST', body: { personaId: 'root' } })).status, 400);
    const forged = await api('/api/dashboard', { headers: { cookie: 'cp_session=elena.9999999999.forged' } });
    assert.equal(forged.body.viewer.id, 'elena', 'invalid cookie falls back to the default persona, never to the claimed one');
  });
});

test('without a default persona, the API requires a demo session', async () => {
  await withServer({ defaultPersona: null }, async ({ api }) => {
    const anonymous = await api('/api/dashboard');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, 'UNAUTHENTICATED');
    assert.equal((await api('/api/health')).status, 200);
    const session = await asPersona(api, 'ana');
    assert.equal((await api('/api/dashboard', { headers: session })).body.viewer.name, 'Ana Ribeiro');
    const cleared = await api('/api/session', { method: 'DELETE', headers: session });
    assert.equal(cleared.status, 204);
    assert.match(cleared.headers.get('set-cookie'), /Max-Age=0/);
  });
});

test('audit actor comes from the session, never from the request body', async () => {
  await withServer({}, async ({ api }) => {
    const cfo = await asPersona(api, 'ana');
    const { body } = await api('/api/dashboard', { headers: cfo });
    const task = body.tasks.find(t => t.status === 'open');
    const done = await api(`/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { outcome: 'Verified', reviewer: 'Someone Else' },
      headers: cfo,
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.task.completed_by, 'user:ana');
    const audit = await api('/api/audit', { headers: cfo });
    const event = audit.body.find(e => e.event_type === 'task.completed');
    assert.equal(event.actor, 'user:ana');
    assert.ok(event.request_id);
  });
});

test('approval creates the proposed internal task atomically; rejection has no side effect', async () => {
  await withServer({}, async ({ api }) => {
    const { body } = await api('/api/dashboard');
    const [first, second] = body.proposals.filter(p => p.status === 'pending');
    assert.ok(
      body.tasks.every(t => t.proposal_id === null),
      'no task exists before approval',
    );

    const approved = await api(`/api/proposals/${first.id}/review`, { method: 'POST', body: { decision: 'approved', note: 'Go' } });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.proposal.reviewed_by, 'user:elena');
    assert.equal(approved.body.proposal.task.title, first.payload.task.title);
    assert.ok(approved.body.dashboard.tasks.some(t => t.proposal_id === first.id && t.owner === first.payload.task.owner));

    const rejected = await api(`/api/proposals/${second.id}/review`, { method: 'POST', body: { decision: 'rejected' } });
    assert.equal(rejected.body.proposal.status, 'rejected');
    assert.equal(rejected.body.proposal.task, null);
    assert.ok(!rejected.body.dashboard.tasks.some(t => t.proposal_id === second.id));

    const replay = await api(`/api/proposals/${first.id}/review`, { method: 'POST', body: { decision: 'approved' } });
    assert.equal(replay.status, 409);
    assert.equal((await api('/api/proposals/proposal_missing/review', { method: 'POST', body: { decision: 'approved' } })).status, 404);
    assert.equal((await api(`/api/proposals/${second.id}/review`, { method: 'POST', body: { decision: 'execute' } })).status, 400);
  });
});

test('re-running agents does not duplicate pending proposals or agenda tasks', async () => {
  await withServer({}, async ({ api }) => {
    const before = (await api('/api/dashboard')).body;
    const rerun = await api('/api/agents/run', { method: 'POST', body: {} });
    assert.equal(rerun.status, 201);
    const after = rerun.body.dashboard;
    assert.equal(after.counts.pending, before.counts.pending);
    assert.equal(after.counts.openTasks, before.counts.openTasks);
    assert.ok(rerun.body.results.every(r => r.status === 'succeeded'));
    assert.deepEqual(
      after.findings.map(f => f.title).sort(),
      before.findings.map(f => f.title).sort(),
      'current findings reflect the latest run, not an accumulation',
    );
  });
});

test('findings expose rule, facts, evidence and data limitations', async () => {
  await withServer({}, async ({ api }) => {
    const { body } = await api('/api/dashboard');
    for (const f of body.findings) {
      assert.ok(f.rule_id);
      assert.ok(Array.isArray(f.limitations));
      if (f.rule_id !== 'data_quality.metric_missing') assert.ok(f.evidence.length > 0);
    }
    const attrition = body.findings.find(f => f.rule_id === 'people.attrition_above_target');
    assert.ok(attrition.limitations.some(l => /stale/.test(l)));
    const revenue = body.metrics.find(m => m.metric_key === 'revenue');
    assert.equal(revenue.status, 'off_track');
    assert.ok(revenue.definition);
    assert.ok(body.agents.every(a => a.lastRun?.status === 'succeeded'));
  });
});

test('idempotency key replays an agent run instead of repeating it', async () => {
  await withServer({}, async ({ api, db }) => {
    const headers = { 'idempotency-key': 'demo-finance-week-2026-10-26' };
    const runs = () => db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE agent_key = 'finance'").get().n;
    const start = runs();
    const first = await api('/api/agents/finance/run', { method: 'POST', body: {}, headers });
    const second = await api('/api/agents/finance/run', { method: 'POST', body: {}, headers });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal(second.body.result.run_id, first.body.result.run_id);
    assert.equal(runs(), start + 1);
    const reused = await api('/api/agents/commercial/run', { method: 'POST', body: {}, headers });
    assert.equal(reused.status, 409);
    assert.equal((await api('/api/agents/run', { method: 'POST', body: {}, headers: { 'idempotency-key': 'bad key!' } })).status, 400);
  });
});

test('unknown agent is 404; a failing agent is recorded as failed without partial output', async () => {
  await withServer({}, async ({ api, db }) => {
    assert.equal((await api('/api/agents/unknown/run', { method: 'POST', body: {} })).status, 404);
    db.exec('DROP TABLE briefings');
    const failed = await api('/api/agents/meeting-prep/run', { method: 'POST', body: {} });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.code, 'AGENT_RUN_FAILED');
    assert.doesNotMatch(failed.body.error, /briefings|SQLITE/i, 'no internal details leak');
    const run = db.prepare("SELECT * FROM agent_runs WHERE agent_key = 'meeting-prep' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(run.status, 'failed');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event_type = 'agent.failed'").get().n, 1);
  });
});

test('decision validation: dates, references and types', async () => {
  await withServer({}, async ({ api }) => {
    const base = { title: 'Review revenue gap', decision: 'Prepare a recovery plan', owner: 'CFO', expectedOutcome: 'Return to plan' };
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, dueDate: '2026-02-30' } })).status, 400);
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, dueDate: 'tomorrow' } })).status, 400);
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, findingId: 'finding_missing' } })).status, 400);
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, findingId: { $ne: 1 } } })).status, 400);
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, title: ['x'] } })).status, 400);
    assert.equal((await api('/api/decisions', { method: 'POST', body: { ...base, owner: 'x'.repeat(1001) } })).status, 400);
    const ok = await api('/api/decisions', { method: 'POST', body: { ...base, dueDate: '2026-11-30' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.decision.created_by, 'user:elena');
    const outcome = `/api/decisions/${ok.body.decision.id}/outcome`;
    assert.equal((await api(outcome, { method: 'POST', body: { actualOutcome: 'Done', status: 'archived' } })).status, 400);
    assert.equal((await api(outcome, { method: 'POST', body: { actualOutcome: 'Recovered' } })).status, 200);
    assert.equal((await api(outcome, { method: 'POST', body: { actualOutcome: 'Again' } })).status, 404);
  });
});

test('meetings validate the source briefing; scenario rejects malformed numbers', async () => {
  await withServer({}, async ({ api }) => {
    assert.equal(
      (await api('/api/meetings', { method: 'POST', body: { title: 'Weekly review', briefingId: 'briefing_missing' } })).status,
      400,
    );
    assert.equal((await api('/api/meetings', { method: 'POST', body: { title: 'Weekly review', agenda: 'x'.repeat(20001) } })).status, 400);
    const meeting = await api('/api/meetings', { method: 'POST', body: { title: 'Weekly review' } });
    assert.equal(meeting.status, 201);
    assert.equal(meeting.body.meeting.created_by, 'user:elena');
    for (const body of [{ revenueChangePct: 'abc' }, { revenueChangePct: true }, { additionalHeadcount: 2.5 }]) {
      assert.equal((await api('/api/scenarios/preview', { method: 'POST', body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await api('/api/scenarios/preview', { method: 'POST', body: { revenueChangePct: '5' } })).status, 200);
  });
});
