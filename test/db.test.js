'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, migrations, schemaVersion, transaction, SCHEMA_VERSION } = require('../src/db');
const { seedDemoData } = require('../src/seed');
const { runAllAgents } = require('../src/agents');

const NOW = new Date('2026-10-26T12:00:00Z');

test('migrations: empty database reaches the current schema version', () => {
  const db = openDatabase(':memory:');
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  const columns = db
    .prepare('PRAGMA table_info(findings)')
    .all()
    .map(c => c.name);
  assert.ok(columns.includes('limitations_json') && columns.includes('rule_id'));
  db.close();
});

test('migrations: a database created by the unversioned MVP is upgraded in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-pulse-db-'));
  const file = path.join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(migrations[0]);
  legacy.exec(
    "INSERT INTO agent_runs (id, agent_key, status, started_at) VALUES ('run_old', 'finance', 'completed', '2026-10-01T00:00:00Z')",
  );
  legacy.close();

  const db = openDatabase(file);
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT status FROM agent_runs WHERE id = 'run_old'").get().status, 'succeeded');
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  db.close();
  // Reopening is a no-op.
  const again = openDatabase(file);
  assert.equal(schemaVersion(again), SCHEMA_VERSION);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrations: refuses a database from a newer build', () => {
  const db = openDatabase(':memory:');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  const { migrate } = require('../src/db');
  assert.throws(() => migrate(db), /newer than this build/);
  db.close();
});

test('seed is idempotent after agents have cited the metrics', () => {
  const db = openDatabase(':memory:');
  seedDemoData(db, NOW);
  runAllAgents(db, { now: NOW.toISOString() });
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n > 0);
  assert.equal(seedDemoData(db, NOW), 12);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metric_snapshots').get().n, 12);
  db.close();
});

test('seeded freshness matches observed_at', () => {
  const db = openDatabase(':memory:');
  seedDemoData(db, NOW);
  for (const m of db.prepare('SELECT * FROM metric_snapshots').all()) {
    const hours = (NOW.getTime() - new Date(m.observed_at).getTime()) / 3600000;
    assert.equal(hours, m.freshness_hours, m.metric_key);
  }
  db.close();
});

test('audit log is append-only', () => {
  const db = openDatabase(':memory:');
  db.exec(
    "INSERT INTO audit_log (id, actor, event_type, entity_type, entity_id, occurred_at) VALUES ('a1', 'x', 'y', 'z', 'e', '2026-10-26')",
  );
  assert.throws(() => db.exec("UPDATE audit_log SET actor = 'forged'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM audit_log'), /append-only/);
  db.close();
});

test('transaction rolls back every write on failure, including nested savepoints', () => {
  const db = openDatabase(':memory:');
  const insert = id =>
    db
      .prepare("INSERT INTO audit_log (id, actor, event_type, entity_type, entity_id, occurred_at) VALUES (?, 'x', 'y', 'z', 'e', 'now')")
      .run(id);
  assert.throws(() =>
    transaction(db, () => {
      insert('outer');
      transaction(db, () => insert('inner'));
      throw new Error('boom');
    }),
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 0);
  transaction(db, () => {
    insert('kept');
    assert.throws(() => transaction(db, () => (insert('nested'), insert('nested'))));
  });
  assert.deepEqual(
    db
      .prepare('SELECT id FROM audit_log')
      .all()
      .map(r => r.id),
    ['kept'],
  );
  db.close();
});
