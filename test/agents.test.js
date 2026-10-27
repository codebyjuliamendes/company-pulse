const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, seedDemoData } = require('../src/db');
const { listAgents, runAllAgents, runAgent, reviewProposal } = require('../src/agents');

function setup() {
  const db = createDatabase();
  seedDemoData(db, new Date('2026-10-26T12:00:00Z'));
  return db;
}

test('demo seed is deterministic in shape and all six agents execute', () => {
  const db = setup();
  assert.equal(seedDemoData(db, new Date('2026-10-26T12:00:00Z')), 12);
  assert.equal(listAgents().length, 6);
  const results = runAllAgents(db, { now: '2026-10-26T12:00:00Z' });
  assert.equal(results.length, 6);
  for (const result of results) assert.ok(result.run_id);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM findings').get().n > 0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM evidence').get().n > 0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM briefings').get().n > 0);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM agent_runs WHERE status='succeeded'").get().n === 6);
  db.close();
});

test('consequential proposals always wait for a human and review is audited', () => {
  const db = setup();
  const result = runAgent(db, 'finance', { now: '2026-10-26T12:00:00Z' });
  assert.ok(result.proposals.length > 0);
  const p = result.proposals[0];
  assert.equal(p.requires_approval, true);
  assert.equal(p.status, 'pending');
  const reviewed = reviewProposal(db, p.id, { decision: 'approved', reviewer: 'ceo@example.test', note: 'Reviewed in demo' });
  assert.equal(reviewed.status, 'approved');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE event_type='proposal.approved'").get().n, 1);
  assert.throws(() => reviewProposal(db, p.id, { decision: 'rejected', reviewer: 'ceo@example.test' }), /already approved/);
  db.close();
});

test('agent output does not execute external or financial actions', () => {
  const db = setup();
  seedDemoData(db, new Date('2026-10-26T12:00:00Z'));
  runAllAgents(db, { now: '2026-10-26T12:00:00Z' });
  const writes = db
    .prepare(
      "SELECT COUNT(*) n FROM audit_log WHERE event_type LIKE '%payment%' OR event_type LIKE '%sent%' OR event_type LIKE '%executed%'",
    )
    .get().n;
  assert.equal(writes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM action_proposals WHERE requires_approval=0').get().n, 0);
  db.close();
});

test('unknown agent and invalid approval decisions fail clearly', () => {
  const db = setup();
  assert.throws(() => runAgent(db, 'unknown'), /Unknown agent/);
  assert.throws(() => reviewProposal(db, 'missing', { decision: 'execute', reviewer: 'x' }), /decision must/);
  db.close();
});

test('one failing agent does not stop the others and leaves no partial output', () => {
  const db = setup();
  db.exec('DROP TABLE briefings');
  const results = runAllAgents(db, { now: '2026-10-26T12:00:00Z' });
  assert.deepEqual(
    results.map(r => r.status),
    ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed', 'succeeded'],
  );
  const failed = results.find(r => r.status === 'failed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 0, 'meeting-prep tasks rolled back');
  assert.equal(db.prepare('SELECT status FROM agent_runs WHERE id=?').get(failed.run_id).status, 'failed');
  db.close();
});

test('approval executes only the allowlisted internal task; agents cannot review', () => {
  const db = setup();
  const {
    proposals: [p],
  } = runAgent(db, 'finance', { now: '2026-10-26T12:00:00Z' });
  assert.throws(() => reviewProposal(db, p.id, { decision: 'approved', reviewer: 'agent:finance' }), /agents cannot review/);
  const reviewed = reviewProposal(db, p.id, { decision: 'approved', reviewer: 'user:elena' });
  assert.equal(reviewed.task.title, p.payload.task.title);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks WHERE proposal_id=?').get(p.id).n, 1);
  db.close();
});

test('tampered proposal payload cannot be approved', () => {
  const db = setup();
  const {
    proposals: [p],
  } = runAgent(db, 'finance', { now: '2026-10-26T12:00:00Z' });
  db.prepare('UPDATE action_proposals SET payload_json=? WHERE id=?').run(
    JSON.stringify({ ...p.payload, task: { title: 'Wire funds', owner: 'CFO' } }),
    p.id,
  );
  assert.throws(() => reviewProposal(db, p.id, { decision: 'approved', reviewer: 'user:elena' }), /payload changed/);
  assert.equal(db.prepare('SELECT status FROM action_proposals WHERE id=?').get(p.id).status, 'pending');
  db.close();
});
