'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Each migration runs once, in order, tracked by PRAGMA user_version.
// Never edit a published migration: append a new one.
const migrations = [
  // v1: the original MVP schema. IF NOT EXISTS keeps databases created before versioning compatible.
  `CREATE TABLE IF NOT EXISTS metric_snapshots (
     id TEXT PRIMARY KEY, metric_key TEXT NOT NULL, domain TEXT NOT NULL,
     label TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
     target REAL, prior_value REAL, period TEXT NOT NULL,
     source TEXT NOT NULL, observed_at TEXT NOT NULL, freshness_hours INTEGER NOT NULL DEFAULT 0,
     confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
     metadata_json TEXT NOT NULL DEFAULT '{}'
   );
   CREATE INDEX IF NOT EXISTS idx_metrics_domain ON metric_snapshots(domain, metric_key);
   CREATE TABLE IF NOT EXISTS agent_runs (
     id TEXT PRIMARY KEY, agent_key TEXT NOT NULL, status TEXT NOT NULL,
     started_at TEXT NOT NULL, completed_at TEXT, summary TEXT NOT NULL DEFAULT '',
     input_digest TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE IF NOT EXISTS findings (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
     agent_key TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('info','watch','critical')),
     title TEXT NOT NULL, explanation TEXT NOT NULL, facts_json TEXT NOT NULL,
     hypotheses_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
     created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS evidence (
     id TEXT PRIMARY KEY, finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
     metric_id TEXT NOT NULL REFERENCES metric_snapshots(id), role TEXT NOT NULL,
     captured_value REAL NOT NULL, captured_source TEXT NOT NULL, captured_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS action_proposals (
     id TEXT PRIMARY KEY, finding_id TEXT REFERENCES findings(id), agent_key TEXT NOT NULL,
     title TEXT NOT NULL, rationale TEXT NOT NULL, action_type TEXT NOT NULL,
     payload_json TEXT NOT NULL DEFAULT '{}', requires_approval INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
     created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT, review_note TEXT
   );
   CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY, finding_id TEXT REFERENCES findings(id), proposal_id TEXT REFERENCES action_proposals(id),
     title TEXT NOT NULL, owner TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'open',
     created_at TEXT NOT NULL, completed_at TEXT, outcome TEXT
   );
   CREATE TABLE IF NOT EXISTS briefings (
     id TEXT PRIMARY KEY, period TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
     finding_ids_json TEXT NOT NULL, decision_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS audit_log (
     id TEXT PRIMARY KEY, actor TEXT NOT NULL, event_type TEXT NOT NULL,
     entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
     occurred_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS meetings (
     id TEXT PRIMARY KEY, briefing_id TEXT REFERENCES briefings(id), title TEXT NOT NULL,
     scheduled_at TEXT NOT NULL, agenda TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL, created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS decision_records (
     id TEXT PRIMARY KEY, meeting_id TEXT REFERENCES meetings(id), finding_id TEXT REFERENCES findings(id),
     title TEXT NOT NULL, decision TEXT NOT NULL, owner TEXT NOT NULL, due_date TEXT,
     expected_outcome TEXT NOT NULL DEFAULT '', actual_outcome TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','reversed')),
     created_by TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_decision_status ON decision_records(status, due_date);
   CREATE INDEX IF NOT EXISTS idx_meeting_created ON meetings(created_at DESC);`,
  // v2: run provenance, explainability, approval integrity, idempotency and an append-only audit log.
  `ALTER TABLE agent_runs ADD COLUMN actor TEXT NOT NULL DEFAULT 'system';
   ALTER TABLE agent_runs ADD COLUMN rule_version TEXT NOT NULL DEFAULT '';
   ALTER TABLE agent_runs ADD COLUMN error TEXT;
   UPDATE agent_runs SET status = 'succeeded' WHERE status = 'completed';
   ALTER TABLE findings ADD COLUMN rule_id TEXT;
   ALTER TABLE findings ADD COLUMN limitations_json TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE action_proposals ADD COLUMN tier TEXT NOT NULL DEFAULT 'B';
   ALTER TABLE action_proposals ADD COLUMN dedupe_key TEXT;
   ALTER TABLE action_proposals ADD COLUMN payload_hash TEXT;
   ALTER TABLE tasks ADD COLUMN created_by TEXT NOT NULL DEFAULT 'system';
   ALTER TABLE tasks ADD COLUMN completed_by TEXT;
   ALTER TABLE audit_log ADD COLUMN request_id TEXT;
   CREATE TABLE idempotency_keys (
     key TEXT PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL,
     status_code INTEGER NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at TEXT NOT NULL
   );
   CREATE INDEX idx_findings_run ON findings(run_id);
   CREATE INDEX idx_evidence_finding ON evidence(finding_id);
   CREATE INDEX idx_runs_agent ON agent_runs(agent_key, status, completed_at);
   CREATE INDEX idx_proposals_status ON action_proposals(status, created_at);
   CREATE INDEX idx_proposals_dedupe ON action_proposals(dedupe_key, status);
   CREATE INDEX idx_tasks_status ON tasks(status, due_date);
   CREATE INDEX idx_audit_time ON audit_log(occurred_at);
   CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
   CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;`,
];

const SCHEMA_VERSION = migrations.length;
const depth = new WeakMap();

/**
 * Runs fn atomically. Nested calls become savepoints, so services can compose
 * without knowing whether a caller already opened a transaction.
 */
function transaction(db, fn) {
  const level = depth.get(db) || 0;
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp_${level}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(level === 0 ? 'COMMIT' : `RELEASE sp_${level}`);
    return result;
  } catch (error) {
    if (level === 0) db.exec('ROLLBACK');
    else db.exec(`ROLLBACK TO sp_${level}; RELEASE sp_${level}`);
    throw error;
  } finally {
    depth.set(db, level);
  }
}

const schemaVersion = db => db.prepare('PRAGMA user_version').get().user_version;

function migrate(db) {
  const current = schemaVersion(db);
  if (current > SCHEMA_VERSION) throw new Error(`Database schema v${current} is newer than this build (v${SCHEMA_VERSION}).`);
  for (let version = current; version < SCHEMA_VERSION; version++) {
    transaction(db, () => {
      db.exec(migrations[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/** Opens (and migrates) the SQLite database. No network or external integrations are used. */
function openDatabase(filename = ':memory:') {
  const memory = filename === ':memory:';
  if (!memory) fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!memory) {
    // WAL: readers never block the writer; NORMAL sync is crash-safe in WAL mode.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  migrate(db);
  return db;
}

// Seed lives in its own module; re-exported for the original public API.
const createDatabase = openDatabase;
const seedDemoData = (...args) => require('./seed').seedDemoData(...args);

module.exports = { openDatabase, createDatabase, migrate, migrations, schemaVersion, transaction, seedDemoData, SCHEMA_VERSION };
