# Company Pulse — Security, Privacy, and Agent Guardrails

## Objectives and boundaries

Protect workspace confidentiality/integrity; prevent cross-workspace access; verify authority for actions; preserve trustworthy history; distinguish demo from live data; prevent model output becoming executable authority. MVP contains synthetic records only and is not a production certification.

Assets include sessions, memberships, company records, metric lineage, agent outputs, approvals, decisions, imports, audit, and optional provider secrets. Boundaries are browser/API, actor/workspace, route/domain, service/database, orchestrator/provider, fixture/validator, proposal/executor. Treat client input, imports, notes, generated/model output as untrusted; notes are data, not agent instructions.

## Threat model and controls

| Threat                                    | Control                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Broken object authorization / tenant leak | Derive workspace from session membership; scope every query; test cross-tenant denial without existence leak.             |
| Role escalation                           | Central server-side permissions; deny by default; validate approver and state transitions in service layer.               |
| Prompt injection in imported text         | Context minimization, delimit text as data, no arbitrary tools, strict schema and independent policy checks.              |
| Hallucinated metric or cause              | Deterministic calculations, valid evidence references, stale/conflict qualification, no unsupported causal claims.        |
| Approval replay/tampering                 | Immutable canonical payload hash, one-time approval, expiry, atomic policy recheck; changed payload requires new request. |
| CSRF/session theft                        | Secure HttpOnly SameSite cookies, CSRF token/origin checks, HTTPS when hosted.                                            |
| SQL/HTML injection                        | Parameterized SQL, validated input, escaping/sanitization, CSP.                                                           |
| Data poisoning                            | Preview, provenance, reconciliation, quarantine, audit applied rows.                                                      |
| Agent cost/DoS                            | Auth and per-user/workspace rate limits, concurrency/time/output bounds, cancellation.                                    |
| Sensitive logging                         | Allowlisted structured events; redact secrets; avoid raw prompt/context logs.                                             |
| Misleading demo state                     | Persistent `DEMO DATA` mark, simulated source labels/timestamps; no live monitoring claims.                               |
| Self approval                             | Separate requester and approver for consequential future execution.                                                       |

## Agent contract

1. Typed task context only, no DB credentials or unrestricted query access.
2. Server retrieves data after actor/workspace authorization.
3. Agent declares input/output schemas and allowed proposals.
4. Validate every output and evidence reference against same workspace/run snapshot.
5. Model cannot choose tenant, permissions, tier, approver or arbitrary target.
6. Output is a proposal. Policy service creates approval; allowlisted handler executes internal action.
7. No external-effect tools exist in MVP. Tier C cannot execute.
8. Keep rule/template/provider version, evidence IDs, status and timestamps; never persist secrets.
9. Minimize context; people data aggregated only.
10. Timeout, invalid output, unavailable evidence or unclear scope fails closed.

## Action policy

- **A prepare:** summaries/calculations; may run on explicit schedule or request, always a visible cited draft.
- **B internal/reversible:** internal task/note/assignment; confirmation required by default. Any enabled rule must constrain template, threshold, internal target and audit.
- **C consequential/external:** external communications, payments, accounting writeback, compensation/HR, permissions, budget-of-record, production change. Disabled in MVP. UI may create a simulated approval; executor always returns `not_supported_in_demo`, even if approved. Future live operation requires authenticated integration, exact payload approval, a distinct authorized approver, expiry/replay protections and renewed security review.

## Authorization and audit

Suggested permissions: `workspace.read/manage_members/manage_demo_data`; `metrics.read.company/read.finance/read.department/manage_catalog`; `signals.read/manage`; `agents.run/read_runs`; `decisions.read/create/update/approve`; `tasks.read/manage`; `meetings.manage`; `audit.read`. Map centrally to roles. UI visibility is never the security boundary. Restricted finance values are omitted for unauthorized callers; people data remains aggregate.

Audit fields: actor type/ID (user or schedule), workspace, action, resource, timestamp, correlation ID, outcome, reason, safe before/after summary, run/approval IDs and payload hash if relevant. Exclude credentials, full prompts and unnecessary personal/financial details. Append corrections as new events; gate audit reads.

## Implementation checklist / production gate

Use maintained auth/session; modern password KDF if passwords are implemented. CSRF, secure cookies in hosted environment, headers/CSP. Validate payloads and sizes; parameterize DB; escape text. Secrets outside source and placeholder-only env example. Auth throttles and bounded agent runs. Dependency checks in CI. Synthetic data only. Reset explains records cleared; never silently erase audit.

Local SQLite demo does not prove production tenant isolation, uptime, backup or compliance. Real data/live integrations require security review/testing, privacy retention/deletion plan, production DB/secret management, encryption and restore drills, connector scope/webhook review, monitoring/incident response, and legal review for target markets.

## Implementation status (current slice)

Implemented and covered by automated tests:

- **Server-side authorization:** central deny-by-default permission map (`src/domain/permissions.js`) for the six documented roles; every API route declares its permission. Analysts and viewers cannot review proposals; viewers are read-only and cannot read the audit log.
- **Actor integrity:** the acting user comes from a signed demo-persona cookie (HMAC-SHA256, `HttpOnly`, `SameSite=Strict`, `Secure` in production, 12 h expiry). Body fields such as `reviewer` or `createdBy` are ignored; audit rows record `user:<id>` / `agent:<key>` plus the request id. _Selecting a persona is not authentication_; `DEMO_DEFAULT_PERSONA` (default `elena`) applies when no session exists and can be disabled to require a choice.
- **CSRF:** writes must come from the same origin (or `PUBLIC_ORIGIN`), `Origin: null` is refused, and bodies must be `application/json`.
- **Injection and XSS:** parameterized SQL only; the UI builds DOM nodes with `textContent` (no data in `innerHTML`); CSP `default-src 'self'` without `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`; `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, COOP/CORP, `Permissions-Policy`.
- **Input validation:** types, lengths, calendar dates, identifier format and referenced records are checked; JSON bodies are capped at 64 KB (413); invalid JSON is 400. Unexpected errors return a generic message with `code` and `requestId`; details go only to the log.
- **Abuse limits:** per-IP fixed-window limits on writes (`RATE_LIMIT_PER_MINUTE`) and agent runs (`AGENT_RUNS_PER_MINUTE`), 429 with `Retry-After`; HTTP header/request timeouts.
- **Approvals:** single use (conditional update), payload hash re-checked, agents cannot review, approval and its internal task and audit event commit atomically; Tier C executors do not exist.
- **Audit:** append-only via database triggers; events carry actor, action, resource, request id, safe details and payload hash where relevant.
- **Logging:** one JSON line per event with request id, method, path (no query string), status, duration and actor; no bodies, secrets or prompts.
- **Supply chain:** no runtime dependencies; `npm audit --audit-level=high` and Dependabot in CI; container runs as non-root.

Not implemented (still required before real data): real authentication and sessions, multi-workspace tenant isolation, field-level restriction of finance metrics per role, approval expiry and separation of duties between requester and approver for future Tier C execution, secret management beyond `SESSION_SECRET`, shared rate-limit store for multiple instances, TLS termination (expected at a reverse proxy; set `TRUST_PROXY`, `COOKIE_SECURE=1` and `PUBLIC_ORIGIN`).
