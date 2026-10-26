# Company Pulse — Data Model and API Contracts

## Conventions

Base `/api/v1`; JSON UTF-8; opaque UUID IDs; UTC ISO-8601; tenant scope derived from authenticated membership. Money is integer minor units plus currency; use decimal-safe ratio storage. Lists return `{items,nextCursor}` (default 25, max 100). Errors: `{error:{code,message,requestId,details?}}`; never disclose cross-tenant existence. Mutations use `Idempotency-Key` where retries can duplicate work; agent triggers require it.

## Logical entities

| Entity | Essential fields / constraints |
|---|---|
| `Workspace` | id, name, timezone, `demoMode`, createdAt; demo mode visibly true. |
| `User`, `Membership` | user profile/auth; membership workspaceId/userId/role/status; unique workspace+user. |
| `DataSource` | workspace, kind, label, mode/status, lastObservedAt, fixtureVersion; MVP mode=`simulated`. |
| `ImportBatch` | workspace/source, status, timestamps/counts, actor; provenance root. |
| `DataQualityFinding` | batch, severity/code, entityRef, affected metric keys, message/status. |
| `MetricDefinition` | workspace/key/name/unit/definition/owner/grain/source/staleAfter; key unique per workspace. |
| `MetricObservation` | workspace/metric/period/value/valueKind/currency/observedAt/batch/dimensions; kind actual/target/forecast/scenario; lineage preserved. |
| `Signal` | workspace/rule/severity/title/summary/status/values/evidence refs/freshness/timestamps. |
| `AgentRun` | workspace/agent/actor/trigger/status/idempotency key/rule & model version/times/summary/limitations; unique workspace+key. |
| `AgentEvidence` | run/resource type+ID/snapshot hash/relevance; validated references. |
| `Proposal` | workspace/run/action type/tier/title/payload/hash/rationale/status; immutable after approval request. |
| `ApprovalRequest` | proposal/requester/required role/status/expiry/approver/time/payload hash; single use. |
| `Priority`, `Initiative` | workspace/title/status/owner/due date/metric and signal links. |
| `Decision` | workspace/title/rationale/expected outcome/owner/due/status/signal refs/meeting/creator; outcome captured at completion. |
| `Task` | workspace/title/description/owner/due/status/source type+ID/creator; agent origin explicit. |
| `Meeting`, `MeetingNote` | workspace/time/status/date range/facilitator; notes kind/body/confirmer/time/evidence; draft distinct from confirmed. |
| `AuditEvent` | workspace/actor/action/resource/outcome/reason/payload hash/correlation/time; append-only, no secrets/prompts. |

Normalize core records; version/schema-check JSON metadata. Foreign keys, tenant-scoped indexes. Uniqueness for observations by metric/period/kind/dimensions/source; agent idempotency. State changes use optimistic `version` checks.

## API endpoints

### Overview, metrics, signals

- `GET /overview?from=&to=` — health components, changes, priority signals, pending work, source freshness.
- `GET /metrics?domain=&from=&to=&cursor=` and `GET /metrics/:key` — permission-filtered values, definitions, targets/forecast, lineage, freshness, validation.
- `GET /signals?status=&severity=&cursor=`; `POST /signals/:id/acknowledge` `{reason?}`; `POST /signals/:id/dismiss` `{reason}`.

### Data quality/demo ingestion

- `GET /data-sources`; `GET /data-quality/findings?status=&severity=`.
- `POST /demo/refresh` — data-manager permission + idempotency key; creates preview batch.
- `GET /import-batches/:id`; `POST /import-batches/:id/apply` — explicit apply of valid demo rows.

### Agents

- `GET /agents` — metadata and allowed proposal types.
- `POST /agents/:agentKey/runs` — `{scope:{from,to,domain?},options?}`; `agents.run` + idempotency key; returns 202.
- `GET /agent-runs/:id`; `GET /agent-runs?agentKey=&status=&cursor=`; `POST /agent-runs/:id/cancel` if safely cancellable.

### Execution/meetings/approvals

- `GET|POST /decisions`; `PATCH /decisions/:id` with `expectedVersion`; `POST /decisions/:id/outcome` `{observedOutcome,comparisonFrom,comparisonTo,notes?}`.
- `GET|POST /tasks`; `PATCH /tasks/:id` with version. `GET|POST /priorities`; `PATCH /priorities/:id`.
- `GET|POST /meetings`; `POST /meetings/:id/brief` creates editable cited draft; `POST /meetings/:id/confirm` persists only reviewed minutes/decisions.
- `GET /approvals?status=pending`; `POST /approvals/:id/approve` `{comment?}`; `POST /approvals/:id/reject` `{reason}`. Recheck permission, separation of duties, expiry, payload hash, policy atomically.
- `GET /audit-events?resourceType=&resourceId=&cursor=` permission-gated.

All paths above are relative to `/api/v1`.

## Example contracts

```http
POST /api/v1/agents/finance/runs
Idempotency-Key: demo-finance-week-2026-10-26
Content-Type: application/json

{"scope":{"from":"2026-10-01","to":"2026-10-26"}}
```

```json
{"data":{"id":"run_opaque_id","agentKey":"finance","status":"queued","demoMode":true}}
```

```json
{"data":{"id":"run_opaque_id","status":"succeeded","summary":"Cash is 6% below plan.","confidence":"medium","limitations":["Simulated source last refreshed 2 hours ago."],"evidence":[{"type":"metric_observation","id":"obs_opaque_id","metricKey":"cash_balance","observedAt":"2026-10-26T12:00:00Z"}],"proposals":[{"id":"proposal_opaque_id","tier":"B","actionType":"create_internal_task","status":"draft"}]}}
```

```json
{"error":{"code":"FORBIDDEN","message":"You do not have access to this action.","requestId":"req_opaque_id"}}
```

## Invariants

Recompute critical figures server-side. Validate dates, role, workspace, action allowlist, size and evidence. Approval operation plus audit event are one DB transaction. Retries are idempotent; stale versions conflict. Never return restricted metrics because caller requests broad overview. Freshness is metric-specific. Agent cannot set workspace/tier/approver/target. Tier C executor is disabled and responds `not_supported_in_demo` without side effects.
