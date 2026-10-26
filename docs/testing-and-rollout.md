# Company Pulse — Test Strategy and MVP Rollout

## Quality strategy

Unit tests prove calculations and policy/state machines; SQLite integration tests prove scope/transaction behavior; API tests verify contracts; browser E2E demonstrates the decision loop on deterministic fixtures. Agent tests prioritize evidence, schemas, uncertainty, and safe failure over exact prose.

## Required tests

**Unit:** period comparisons, variance, margin, cash forecasts, currency/unit boundaries; threshold/severity and stale/conflicting input qualification; each agent's context filtering, schema, evidence and insufficient-evidence behavior; permission/action-tier/approval logic; task/decision/meeting/import/run state machines; UTC/workspace timezone boundaries.

**Database/service integration:** migrations from empty/current versions; idempotent seed; cross-workspace denial for every entity without existence leak; atomic approval+internal operation+audit and rollback on forced failure; duplicate idempotency key returns one run/action; altered payload conflicts; preview is non-mutating until apply; audit only appends.

**API:** request/response schemas, pagination, errors, role filtering, idempotency; agent cannot choose workspace/tier/approver/tool target; no Tier C executor and no side effect; stale state consistent in overview/detail/signal/agent output.

**E2E demo:** CEO login with persistent demo label → inspect revenue/cash signal → trace metric/source/period/freshness → run Company Health/Finance agents and inspect evidence/limitations → edit proposal into owned task/decision → generate/edit/confirm meeting brief → simulate a Tier C approval and prove no side effect (or reject) → load stale/bad fixture and see finding/qualification → record outcome and verify audit → retry key operations to verify idempotency/conflict behavior.

**Accessibility/responsive:** keyboard and visible focus, accessible names/errors, contrast, non-color status, reduced motion, empty/loading/error/offline/stale/denied/pending/agent-failure states; core flows at desktop/tablet/mobile without horizontal overflow. Demo label persists in overview, source details, exports, agent output.

## Agent evaluation fixtures

Deterministic cases: normal trend, breach, stale source, missing metric, conflicting source, outlier, injected instruction in narrative text, zero denominator, incomplete period. Assert correct arithmetic; valid same-workspace citations; uncertainty when incomplete; no invented cause/customer/person; allowed proposal types only; imported instructions cannot change access/policy. If optional LLM adapter enabled, regression-test bounded outputs; never make model evaluation the sole action-safety gate.

## Blocking release gates

- Clean setup/start/seed/reset without external credentials.
- Migrations plus unit, integration, API and E2E tests pass.
- Cross-tenant tests for every resource pass.
- Approval atomicity, expiry, replay, payload-change and separation-of-duties tests pass.
- Tier C executor absent/disabled; tests prove no external effects.
- No known high-severity dependency/security issue in demo configuration.
- Persistent demo labeling and simulated freshness are accurate.
- Setup/test/reset/scope/architecture instructions in README; dev credentials only if needed.
- Accessibility and responsive smoke tests pass.

## Implementation sequence

1. Foundation: migrations, synthetic seed, roles, metric catalog, audit helper, API errors.
2. Truthful visibility: overview, domain metrics, freshness, lineage, data health, deterministic signals.
3. Execution: priorities, tasks, decisions, state transitions, approval queue, audit timeline.
4. Agent layer: six bounded agents over shared contracts; deterministic rules/calculations first.
5. Meeting workflow: assemble/edit/confirm briefs and minutes, decisions, follow-up.
6. Polish: accessible responsive UI, scripted demo, adversarial fixtures, security gates, README.

Each phase remains runnable and produces a thin vertical slice. Exercise the complete signal-to-outcome loop before all six agent variants are finished.

## Demo rollout and measures

Release as local/demo using synthetic company records. Explicitly identify simulated connectors; do not claim live business monitoring. Track walkthrough completion without manual DB edits, material signals with definition/source/freshness/evidence, time from signal to owned decision in demo, proposal accepted/edited/rejected, stale data qualification, approval/audit completeness, test pass rate and new-developer setup time. Synthetic data cannot substantiate customer outcome claims. Real-data pilots require separate consent, retention/deletion, connector security, incident response and production operations work.
