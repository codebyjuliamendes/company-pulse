# Company Pulse — MVP Product Requirements

**Status:** implementation baseline. **Audience:** product, design, engineering, QA.

## Product thesis

Help a leadership team see what changed, understand the evidence, decide what to do, and verify whether the decision worked. CEOs and functional leaders at small/mid-sized companies currently assemble a company picture from spreadsheets, ERP/CRM exports, project tools, and meetings. That produces delayed visibility, inconsistent definitions, context-free alerts, and decisions without owners or follow-up.

Company Pulse is a decision and operating-review workspace, not a passive chart wall or an autonomous executive. Primary user: CEO/founder. Secondary users: finance, commercial, operations, meeting facilitator, analyst/data steward. MVP environment: one synthetic demo company, one workspace, several departments, role-based access.

## Outcomes and success criteria

1. Leaders find important changes and trace metrics/signals to definition, source, and freshness.
2. They inspect evidence and uncertainty, compare against plan/period, and understand why a signal fired.
3. Recommendations become owned decisions/tasks with due date, approval state, and expected outcome.
4. Meeting briefs bring open signals and prior commitments into an agenda; confirmed decisions have owners and follow-up.
5. Agents prepare safe work automatically while policy gates consequential actions behind an authorized human.
6. Stale/inconsistent data is visible and qualifies dependent insights.

**Demo acceptance:** go from revenue/cash variance to evidence, review an agent recommendation, approve a bounded internal task, record a meeting decision, and later see its outcome. A stale-source case visibly qualifies its insight. All material state changes appear in the audit timeline.

## Product surfaces

- **Company overview:** period/comparison selector, component health, important changes, priority risks/opportunities, pending decisions, data freshness. Avoid a black-box composite score. Every number opens definition, lineage, update time, comparison, and relevant records.
- **Finance:** revenue, expenses, margin, cash, runway/forecast, plan variance, transparent scenario assumptions.
- **Commercial/customers:** pipeline/stages, conversion, bookings, customer concentration, renewal/churn signals and comparisons.
- **Operations:** SLA attainment, backlog/throughput, overdue work, capacity constraints, operational risks.
- **People (MVP-lite):** aggregated headcount/capacity/hiring assumptions only; no individual performance ranking, sensitive inference, or surveillance.
- **Execution:** priorities, initiatives, metric links, owners, due dates, blockers, progress.
- **Decisions:** originating signal/evidence, alternatives, expected result, approver, owner, due date, state, observed outcome.
- **Meetings:** generated editable brief/agenda, prior commitments, confirmed minutes/decisions, follow-up.
- **Data health:** source status, freshness, validation failures, metric coverage/definitions, affected views.

Core loop: `signal → evidence/freshness → recommendation → human review/edit → approval/rejection → owned action → outcome comparison`. A generated recommendation is never itself a completed decision.

## Six MVP agents

All agents are bounded workers with declared inputs, output schema, read scope, proposed actions, evidence citations, confidence/limitations, run history, and policy enforcement. No unrestricted tool access.

1. **Company Health:** detects material metric changes using deterministic thresholds plus optional summarization; groups related signals; drafts cited executive digest.
2. **Finance:** summarizes revenue/cost/margin/cash variance and calculates scenarios from explicit assumptions; drafts actions. Never initiates payments, accounting entries, transfers, or budget changes.
3. **Commercial:** surfaces pipeline movement, conversion change, renewal/churn risk, concentration using demo records; suggests follow-up without contacting customers.
4. **Operations:** checks SLA/backlog/throughput and drafts internal work with proposed owner/date; no external dispatch or production change.
5. **Meeting:** drafts brief/agenda/minutes from signals, decisions, initiatives and user notes; humans confirm minutes and decisions.
6. **Data Quality:** validates freshness, required fields, duplicate keys, reconciliation and coverage; identifies impacted metrics/provenance; may quarantine a demo import, never silently overwrite.

Shared behavior: on-demand or explicit demo schedule; only actor-authorized workspace context; status `queued|running|succeeded|failed|cancelled`; initiating actor, timestamps, rule/model version and audit record; evidence IDs resolve to accessible records. Missing/stale/conflicting evidence lowers confidence and is stated. Users can inspect, edit, reject, or regenerate. No agent approves its own proposal.

## Autonomy tiers and approvals

| Tier | Example | MVP behavior |
|---|---|---|
| A — prepare | summarize metrics, brief, scenario calculation | May run on demand or controlled schedule; always visible as cited draft. |
| B — internal/reversible | create/update internal task or attach note | User confirmation by default; optional narrowly configured rule; record actor and before/after. |
| C — consequential/external | customer message, budget-of-record, permissions, payment/refund, production change | Never executes in MVP. Can be shown as simulated approval request; future execution must require explicit authorized human approval. |

Approval binds exact payload, rationale/evidence, target, reversibility, requester, required role, expiry, state and payload hash. Single-use; payload changes require new approval; rejected/expired request creates no side effect. Consequential approval requires a different authorized person than requester in any future live executor.

## Included scope

Synthetic company and coherent seeded records; metric catalog with definitions/source/freshness/lineage; explicitly labeled simulated connectors and demo import/refresh; all six agents and run history; deterministic calculations/rules first and optional replaceable narrative model; alert inbox, decisions, priorities/initiatives/tasks, approval queue, meeting workflow, data health, audit; roles (`owner`, `executive`, `finance`, `department_lead`, `analyst`, `viewer`); responsive and accessible core flows.

## Out of scope

Production connectors/OAuth/sync, live monitoring claims, external messages, payment/payroll/accounting writeback, budget-of-record changes, production actions, autonomous consequential execution, unrestricted agent tools, real employee-level monitoring, sensitive personal data, enterprise SSO/SCIM, billing, warehouse-scale architecture, custom model training, native mobile, unvalidated causal claims, black-box company score.

## Roles and requirements

- `owner`: workspace/membership/demo configuration; cannot override hard safety controls.
- `executive`: company overview, decisions, meetings and allowed internal actions.
- `finance`: finance detail and workflow, no restricted people records.
- `department_lead`: department details and own execution work; aggregated company summary.
- `analyst`: metric definitions/data quality/imports; cannot self-approve consequential action.
- `viewer`: explicitly granted read-only access.

Authorization is enforced server-side; workspace derives from authenticated membership, never arbitrary request values. Metrics distinguish actual/target/forecast/scenario. Signals expose rule, threshold, values, period, evidence, freshness, severity, status. Stale/conflicting sources qualify dependent insights. Decision/task state transitions are validated and audited. Meeting confirmation is explicit. Import validation previews before apply.

## Non-functional targets

Parameterized DB access, server-side authorization, safe rendering, CSRF/security headers, auth/agent throttles, secrets outside source. Agent failure does not block dashboard; jobs are idempotent. Seeded common reads under 500 ms p95 and simulated agent run under 5 s p95 on developer machine. Semantic, keyboard-accessible core flows target WCAG 2.2 AA; status never color-only. Correlation IDs and privacy-minimized logs. Local setup requires no paid service.

## Risks

Avoid generic dashboard positioning by emphasizing evidence→ownership→decision→outcome. Avoid AI overclaim with deterministic math, citations and uncertainty. Persistent DEMO labeling prevents simulated data being mistaken for live. Six agents share common primitives to control scope. Synthetic and aggregate data limit privacy risk.

## Release definition

All blocking checks in `testing-and-rollout.md` pass; a reviewer completes the demo without DB edits; demo status is unmistakable; no consequential agent side effect can occur. Production integrations require a separate security/privacy/operations design.
