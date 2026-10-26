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
