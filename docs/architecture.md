# Company Pulse — System Architecture and ADRs

## Summary

Use a **modular monolith**: one Node.js HTTP application, one SQLite database, the existing frontend, explicit domain service boundaries, and a small background-job abstraction. Deploy together for a runnable MVP; preserve interfaces for later extraction.

```text
Browser → HTTP API
  ├─ Identity/workspace authorization
  ├─ Metrics, signals, data quality, simulated ingestion
  ├─ Agent orchestrator + bounded adapters
  ├─ Priorities, tasks, decisions, meetings, approvals
  ├─ Audit and in-app demo notifications
  └─ SQLite repositories + migrations + synthetic fixtures
```

Core is provider-independent. Agent adapters accept typed context and return validated proposals. Deterministic code computes figures and thresholds; an optional model may phrase cited facts only. Its output is never authority.

## Modules and boundaries

- Identity/workspaces: users, sessions, membership, role resolution, scope.
- Catalog: metric definitions, units, owners, targets, time conventions.
- Ingestion: fixture-backed adapters, batches, freshness, validation; no live integration.
- Metrics: actual/target/forecast/scenario read models, aggregation, lineage.
- Signals: deterministic rules, severity, evidence, lifecycle.
- Agents: trigger/run lifecycle, scoped context, adapter registry, schema validation, cancellation/idempotency.
- Execution: priorities, initiatives, tasks, decisions, meetings, approvals and state machines.
- Audit: append-only auth-sensitive, agent, approval, data and decision events.
- API/presentation: DTO validation and response shaping, no business rules in routes.

Modules call public services, not each other's tables. Shared transaction service supports atomic state changes plus audit event.

## Data flows

### Demo refresh

1. Authorized steward requests refresh; simulated adapter creates batch with fixture version and simulated observation time.
2. Data Quality checks schema, required fields, duplicate IDs, reconciliation, freshness.
3. Preview reports valid/rejected counts and affected metrics; user confirms apply.
4. Transaction applies valid rows, provenance, metric read models, deterministic signal rules and audit entries.
5. UI exposes source status/freshness/findings and qualifies dependent signals.

### Agent to decision

1. User or configured demo schedule triggers an allowlisted agent. Check actor role, workspace, action policy, limits, idempotency.
2. Orchestrator retrieves minimum necessary context through authorized services, preserving source IDs/freshness.
3. Adapter returns strict schema; server validates bounds, evidence refs and proposed action. Invalid output fails safely.
4. Persist run/evidence. Tier A is a cited draft; Tier B a proposal until confirmation; Tier C a pending simulated approval only.
5. Human reviews exact payload. Only an allowlisted internal operation can execute; transition and audit commit atomically.
6. Owner records outcome; dashboard compares expectation to observed result.

### Meeting

Selected period fetches open signals, priorities, pending approvals, overdue tasks and previous commitments. Agent drafts cited agenda. Facilitator edits and confirms; only confirmation creates confirmed minutes and linked actions.

## Persistence

SQLite with foreign keys, WAL for local reads, prepared statements, migrations, busy timeout. UTC timestamps; workspace timezone for display. Store money as integer minor units/currency; ratios decimal-safe. Opaque UUID public IDs. Every tenant row includes `workspace_id`; tenant-scoped repository methods, indexes and foreign keys. Audit is append-only through services. Job records have idempotency key/status/attempts/times; in-process worker suffices for local MVP. Document demo reset; production backup/availability is not promised.

## State machines

- AgentRun: `queued → running → succeeded|failed|cancelled`; retry is a linked new run; duplicate key returns original.
- Approval: `pending → approved|rejected|expired|cancelled`; immutable payload; changed proposal means new approval; expiry checked at execution.
- Decision: `draft → proposed → accepted → in_progress → completed|cancelled`; proposal may be rejected; corrections are reasoned/audited transitions.
- Task: `open → in_progress → blocked|completed|cancelled`; reopening is audited.

## ADRs

### ADR-001 Modular monolith — accepted

One deployable Node.js service with domain modules. It minimizes setup and test burden while keeping extraction seams. Trade-off: coupled scaling/deploy. Revisit if measured independent availability/scaling or separate team ownership warrants it.

### ADR-002 SQLite — accepted for synthetic local MVP only

SQLite plus migrations/repository interfaces gives zero-service setup and transactional demos. It is not the production multi-tenant database commitment; write concurrency/operations are limited. Before real data, multiple instances, sustained writes or availability commitment, design PostgreSQL migration, operations and security.

### ADR-003 Deterministic facts, optional model narrative — accepted

Code owns arithmetic and thresholds; optional model may produce constrained wording from cited facts. This supports correctness, reproducibility and provider independence; flexibility is lower. Revisit model reasoning only with evaluation evidence and controls.

### ADR-004 Simulated connectors — accepted

Fixture adapter behind connector interface, visibly labeled simulated. Supports end-to-end demo without credentials/privacy exposure or false live-monitoring claims. Real source integration requires separate scopes, sync semantics, deletion policy, and security design.

### ADR-005 Policy/approval external to agents — accepted

Agents propose; independent policy/approval service controls operations. More workflow states, but model output cannot grant itself authority. Consequential actions retain human approval invariant.

## Evolution

Preserve service contracts and provenance when moving DB/adding connectors. Extract adapters/jobs before considering microservices. Production gate includes PostgreSQL design, secrets, tenant isolation review, monitoring, rate limiting, backup/restore, retention policy, incident response and connector-specific threat analysis.

## Implementation status (current slice)

The running code follows ADR-001 to ADR-005 within a single demo workspace. Layers, from the outside in:

```text
src/server.js        entry: config, logger, database, HTTP server, graceful shutdown (SIGTERM/SIGINT, 10 s cap)
src/app.js           createApp(db, options) → http.Server (testable, nothing listens until .listen)
src/http/            router, JSON body limits, errors, security headers/CSP, origin check, request id + access log,
                     rate limits, signed demo-persona session, static files with ETag
src/routes/          workspace (health, session, dashboard, audit), agents (runs, proposal review), execution
                     (meetings, decisions, tasks, scenarios); routes only parse input and call services
src/workspace.js     application services: each command validates references, writes and audits in one transaction
src/agents.js        agent orchestrator: run lifecycle, persistence of findings/evidence/proposals, human review
src/domain/          pure modules (no I/O): metric catalog, threshold rules, briefing, scenario, permissions, errors
src/store.js         all SQL, prepared once per connection
src/db.js, seed.js   node:sqlite connection, migrations (PRAGMA user_version), transaction helper, demo fixtures
```

- **Rules and explainability:** `src/domain/rules.js` holds every threshold with a stable rule id and `RULESET_VERSION` (stored on each run). A signal carries the compared values (value, target, threshold, variance), the metric evidence that triggered it, hypotheses and explicit _limitations_; stale (>24 h) or low-confidence (<80 %) sources lower confidence and state why. The evaluation is pure and deterministic, so tests pin outputs without a database.
- **Run lifecycle:** `running → succeeded | failed`. A run's output and audit events commit atomically; on failure everything rolls back and a `failed` run plus `agent.failed` audit event are recorded. `queued`/`cancelled` are not needed while runs are synchronous.
- **Proposals:** a pending proposal with the same action and metric is reused (no duplicates on re-run). Approval executes only the allowlisted internal operation — creating the proposed task — in the same transaction as the audit event; rejection has no side effect. A SHA-256 hash of the canonical payload is stored at creation and re-checked at review.
- **Current findings:** the dashboard shows findings from each agent's latest successful run, deduplicated by title, so it reflects the current state rather than accumulated history.
- **Idempotency:** agent-run endpoints accept `Idempotency-Key`; a repeated key replays the stored result, a key reused for another scope or actor conflicts (409).
- **Persistence:** WAL, `synchronous=NORMAL`, `busy_timeout=5000`, foreign keys, migrations from empty or from the unversioned MVP schema, append-only audit enforced by triggers. Amounts are still stored as REAL whole BRL in the demo fixtures; integer minor units remain a requirement before real data.

### ADR-006 Zero third-party runtime dependencies — accepted

The MVP runs on Node.js built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:test`); ESLint and Prettier are development dependencies. This keeps setup to `npm start`, removes supply-chain exposure at runtime and makes the Docker image a copy of `src/` and `public/`. `node:sqlite` is flagged _experimental_ (stability 1.1) but unflagged since Node 22.13 and present in Node 24; its use is isolated in `src/db.js` and `src/store.js`, and the API surface used (prepare/get/all/run/exec) is small. The experimental warning is silenced in `npm start` and the image. Trade-off: hand-written routing and validation instead of a framework. Revisit (Express + better-sqlite3 or PostgreSQL) together with ADR-002 before real data or multiple instances.
