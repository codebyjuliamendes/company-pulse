const { DatabaseSync } = require('node:sqlite');

/** Create the local demo database. No network or external integrations are used. */
function createDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS metric_snapshots (
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
    CREATE INDEX IF NOT EXISTS idx_meeting_created ON meetings(created_at DESC);
  `);
  return db;
}

function seedDemoData(db, now = new Date()) {
  const day = (offset) => new Date(now.getTime() - offset * 86400000).toISOString();
  const rows = [
    ['revenue','finance','Net revenue',920000,'BRL',1000000,1010000,'2026-W43','Demo ERP',.99,0],
    ['cash_runway','finance','Cash runway',4.2,'months',6,5.4,'2026-10','Demo ERP',.98,1],
    ['gross_margin','finance','Gross margin',.34,'ratio',.36,.35,'2026-W43','Demo ERP',.98,0],
    ['pipeline_coverage','commercial','Pipeline coverage',2.1,'x',3,2.6,'2026-W43','Demo CRM',.96,0],
    ['win_rate','commercial','Qualified opportunity win rate',.22,'ratio',.25,.27,'2026-W43','Demo CRM',.96,0],
    ['customer_concentration','commercial','Top customer revenue share',.31,'ratio',.25,.28,'2026-10','Demo Billing',.94,1],
    ['sla_attainment','operations','SLA attainment',.91,'ratio',.95,.96,'2026-W43','Demo Operations',.97,0],
    ['open_incidents','operations','Open high-priority incidents',7,'count',3,4,'2026-10-26','Demo Operations',.99,0],
    ['headcount','people','Active headcount',84,'people',88,82,'2026-10','Demo HRIS',.75,26],
    ['attrition','people','Quarterly voluntary attrition',.08,'ratio',.06,.05,'2026-Q3','Demo HRIS',.75,26],
    ['arr','finance','Annual recurring revenue',5400000,'BRL',5700000,5300000,'2026-10','Demo Billing',.97,1],
    ['data_quality_missing','data_quality','Records missing owner',18,'count',0,12,'2026-10-26','Demo CRM',.99,0],
  ];
  const insert = db.prepare(`INSERT OR REPLACE INTO metric_snapshots
    (id,metric_key,domain,label,value,unit,target,prior_value,period,source,observed_at,freshness_hours,confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  try {
    rows.forEach((r, i) => {
      const [key,domain,label,value,unit,target,prior,period,source,confidence,freshness]=r;
      insert.run(`demo-${key}`,key,domain,label,value,unit,target,prior,period,source,day(i%3),freshness,confidence);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return rows.length;
}

module.exports = { createDatabase, seedDemoData };
